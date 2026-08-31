'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { launch, Version, MinecraftFolder, createMinecraftProcessWatcher, DEFAULT_EXTRA_JVM_ARGS } = require('@xmcl/core');
const installer = require('@xmcl/installer');
const { Agent, interceptors } = require('undici');
const msauth = require('./msauth');
const mods = require('./mods');
const rpc = require('./discordrpc');
const respack = require('./respack');
const cosmeticpack = require('./cosmeticpack');
const cosmeticassets = require('./cosmeticassets');
const migrate = require('./migrate');
const translate = require('./translate');
const community = require('./community');
const site = require('./site');
const buildSecret = require('./build-secret');
const filelog = require('./filelog');

// Файловый лог — раньше всего остального: падения на старте должны попасть
// в журнал, даже если окно так и не открылось.
filelog.init(app.getPath('userData'));
filelog.line('════ Запуск Mist MC Launcher ' + app.getVersion()
  + ' · Electron ' + process.versions.electron
  + ' · ' + process.platform + ' ' + require('os').release()
  + (app.isPackaged ? '' : ' · DEV'));
filelog.line('exe: ' + process.execPath);
if (process.argv.length > 1) filelog.line('argv: ' + process.argv.slice(1).join(' '));

process.on('uncaughtException', (err) => {
  filelog.crash('Необработанная ошибка главного процесса', err);
  try {
    dialog.showErrorBox('Mist MC Launcher — ошибка',
      'Лаунчер упал: ' + ((err && err.message) || err) + '\n\nЛог: ' + filelog.file());
  } catch (_) {}
  process.exit(1);
});
process.on('unhandledRejection', (err) => filelog.crash('Промис без catch', err));
app.on('render-process-gone', (_e, _wc, details) => filelog.crash('Упал процесс окна (render-process-gone)', details));
let gpuCrashes = 0;
app.on('child-process-gone', (_e, details) => {
  // GPU-процесс на битых видеодрайверах умирает молча — это главный
  // подозреваемый в «окно мелькнуло и закрылось». reason=clean-exit — норма.
  if (details && details.reason !== 'clean-exit') {
    filelog.crash('Упал служебный процесс (' + (details.type || '?') + ')', details);
    if (details.type === 'GPU' && ++gpuCrashes >= 2) enterGpuFallback('GPU-процесс упал ' + gpuCrashes + ' раза');
  }
});

// На Linux при распаковке из архива chrome-sandbox не получает setuid-root →
// стандартный sandbox падает. Отключаем его (безопасно для лаунчера в домашней папке).
// Там же — «чёрное окно»: на части систем (NVIDIA+Wayland, виртуалки, старые Mesa)
// GPU-композитинг отдаёт пустой кадр либо GPU-процесс падает. Лечится программным
// рендером; включаем его по маркеру от прошлого неудачного запуска (см.
// scheduleBlackFrameCheck) или флагом --safe-gpu. Сброс маркера: --reset-gpu.
const GPU_MARKER = path.join(app.getPath('userData'), 'gpu-fallback');
let gpuFallback = false;
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  // Seccomp-фильтр Chromium на части систем возвращает мусорные errno (ESRCH,
  // «No such process») на shared memory: «невозможные» ошибки /dev/shm при
  // честных правах 1777 и FATAL до первого кадра (кейс 17.08, лечение
  // подтверждено игроком). Песочница и так выключена — снимаем и seccomp-слой.
  app.commandLine.appendSwitch('disable-seccomp-filter-sandbox');
  // /dev/shm недоступен (кейс 17.08: access(W_OK|X_OK) → FATAL, до того — чёрное
  // окно): Chromium гоняет кадры рендерера через shared memory. Переводим shmem
  // на файлы в /tmp — тот же приём, каким лечат Chromium в докере.
  try { fs.accessSync('/dev/shm', fs.constants.W_OK | fs.constants.X_OK); }
  catch (_) {
    app.commandLine.appendSwitch('disable-dev-shm-usage');
    filelog.line('/dev/shm недоступен — включаю disable-dev-shm-usage');
  }
  if (process.argv.includes('--reset-gpu')) { try { fs.unlinkSync(GPU_MARKER); } catch (_) {} }
  gpuFallback = process.argv.includes('--safe-gpu') || fs.existsSync(GPU_MARKER);
  if (gpuFallback) {
    app.disableHardwareAcceleration();
    filelog.line('GPU: программный рендер (маркер gpu-fallback / --safe-gpu)');
  }
}

// Единственный перезапуск в программный рендер. Повторно не срабатывает:
// если чёрное окно и в фолбэке — дело не в GPU, разбираемся по логу.
function enterGpuFallback(why) {
  if (gpuFallback || process.platform !== 'linux') return;
  gpuFallback = true;
  filelog.line('GPU: ' + why + ' — перезапуск в программном рендере');
  try { fs.writeFileSync(GPU_MARKER, why + '\n'); } catch (_) {}
  app.relaunch();
  app.exit(0);
}

// Свой протокол для фона окна. Через него отдаём картинку/видео из папки
// настроек: renderer не имеет доступа к file://, а гнать видео в base64 —
// это лишние мегабайты в памяти и никакой перемотки. Регистрировать нужно
// ДО готовности приложения. stream: true обязателен для <video>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mistbg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

// ─── Константы проекта ────────────────────────────────────────────────
const MC_VERSION = '1.21.11';
const FABRIC_LOADER = '0.19.3';   // последний стабильный loader под 1.21.11
const FORGE_VERSION = '61.1.0';   // recommended Forge под 1.21.11
const SERVER_HOST = 'mistmc.gg';  // Java SRV → connect.mistmc.gg:25584
// Автоподключение идёт по фактическому эндпоинту: по хосту в хендшейке сервер
// отличает вход через лаунчер от ручного входа по mistmc.gg (метрика в админке)
const JOIN_HOST = 'connect.mistmc.gg:25584';
// MISTMC_SITE_URL — для локальной отладки против dev-сервера сайта
const SITE_URL = process.env.MISTMC_SITE_URL || 'https://mistmc.gg';
const MS_CLIENT_ID = 'fc39a138-e8b8-4d93-9fb9-c86f7c3d8e56'; // Azure App (MistMC Launcher)
const DISCORD_RPC_APP_ID = '1531346124374409299'; // приложение «MistMC» (отдельное, только для Rich Presence)

const VERSION_INFO = { mc: MC_VERSION, fabric: FABRIC_LOADER, forge: FORGE_VERSION, server: SERVER_HOST };

// Зеркала на случай, если официальные CDN Mojang недоступны/режутся (актуально для РФ).
// xmcl пробует хосты по порядку [0]→[n], поэтому официальный первый, bmclapi — запасной.
const ASSETS_HOSTS = ['https://resources.download.minecraft.net', 'https://bmclapi2.bangbang93.com/assets'];
const MAVEN_HOSTS = ['https://libraries.minecraft.net', 'https://bmclapi2.bangbang93.com/maven'];

// Piston-хосты Mojang (version.json, client.jar, индекс ассетов) зеркалируются
// на bmclapi с тем же путём — только хост другой. Официальный URL идёт первым,
// зеркало запасным; sha1-проверка xmcl отсеивает битый ответ зеркала. Это
// закрывает ПЕРВИЧНУЮ установку у игроков с полностью зарезанным Mojang
// (у них раньше падала скачка client.jar с piston-data).
function withMirror(url) {
  try {
    const u = new URL(url);
    if (/^(piston-meta|piston-data|launchermeta|launcher)\.mojang\.com$/.test(u.host)) {
      return [url, 'https://bmclapi2.bangbang93.com' + u.pathname];
    }
  } catch (_) { /* нестандартный URL — без зеркала */ }
  return [url];
}

// Диспетчер undici: увеличенный таймаут соединения (дефолтные 10с рвутся на медленных
// CDN под нагрузкой) + следование редиректам. Retry-интерцептор НЕ используем —
// он конфликтует с докачкой xmcl (content-range mismatch); отказоустойчивость даёт
// список зеркал + сам xmcl. Строим лениво (undici недоступен до app ready — но модуль есть).
function makeDownloadOptions() {
  const dispatcher = new Agent({
    connect: { timeout: 60000 },
    headersTimeout: 60000,
    bodyTimeout: 600000,
    connections: 8,
  }).compose(interceptors.redirect({ maxRedirections: 5 }));
  return {
    dispatcher,
    assetsDownloadConcurrency: 8,
    assetsHost: ASSETS_HOSTS,
    mavenHost: MAVEN_HOSTS,
    // resolveDownloadUrls ставит наши URL первыми и дописывает оригинал в конец,
    // если его нет в списке — поэтому возвращаем [оригинал, зеркало]: официальный
    // хост остаётся приоритетным, дубля не будет.
    json: (v) => withMirror(v.url),
    client: (v) => withMirror(v.downloads.client.url),
    assetsIndexUrl: (v) => withMirror(v.assetIndex.url),
  };
}

// Сессионные сервисы Mojang: клиент проверяет подписи скинов ДРУГИХ игроков
// ключами с api.minecraftservices.com/publickeys. У провайдеров, режущих
// Mojang, ключи не скачиваются и клиент молча бракует все чужие скины
// («Profile contained invalid signature for textures property» — живой кейс
// 30.08, у игрока все вокруг стивы). Перед запуском пробуем достучаться до
// Mojang; срезано — переводим session/services/profiles-хосты клиента на
// реверс-прокси зеркала (JVM-флаги authlib, ответы 1:1 от Mojang).
// profiles.host обязателен: EnvironmentParser authlib 7 читает все три.
const MOJANG_SESSION_PROBE = 'https://api.minecraftservices.com/publickeys';
const MOJANG_PROXY = 'https://files.mistmc.gg/mojang';
async function mojangSessionJvmArgs() {
  try {
    const res = await fetch(MOJANG_SESSION_PROBE, { signal: AbortSignal.timeout(6000) });
    if (res.ok) return [];
    throw new Error('HTTP ' + res.status);
  } catch (e) {
    logLine('ⓘ Сервисы Mojang недоступны (' + describeError(e).split('\n')[0] + ') — скины пойдут через зеркало');
  }
  try {
    // прокси тоже может быть недоступен — тогда штатные хосты (хуже не станет)
    const res = await fetch(MOJANG_PROXY + '/services/publickeys', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    logLine('ⓘ Зеркало Mojang-сервисов тоже недоступно (' + describeError(e).split('\n')[0] + ') — запускаю со штатными хостами');
    return [];
  }
  return [
    '-Dminecraft.api.session.host=' + MOJANG_PROXY + '/session',
    '-Dminecraft.api.services.host=' + MOJANG_PROXY + '/services',
    '-Dminecraft.api.profiles.host=' + MOJANG_PROXY + '/profiles',
  ];
}

// Манифест версий: getVersionList из xmcl игнорирует dispatcher (принимает
// только options.fetch/remote) и ходит глобальным fetch с дефолтными 10с —
// у игроков, чей провайдер режет Mojang, запуск падал на первом же шаге
// (живой кейс 30.08). Качаем сами: официальный хост → зеркало bmclapi →
// кэш последнего удачного ответа. Кэш даёт уже установленным игрокам
// запускаться вообще без доступа к Mojang.
const VERSION_MANIFEST_URLS = [
  'https://launchermeta.mojang.com/mc/game/version_manifest.json',
  'https://bmclapi2.bangbang93.com/mc/game/version_manifest.json',
];
function manifestCachePath() {
  return path.join(app.getPath('userData'), 'version_manifest.json');
}
async function fetchVersionList(dispatcher) {
  const errors = [];
  for (const url of VERSION_MANIFEST_URLS) {
    const host = new URL(url).host;
    try {
      // Свой таймаут короче 60с диспетчера: заблокированный хост висит до
      // упора, а игроку ещё ждать зеркало — 20с на попытку достаточно.
      const res = await fetch(url, { dispatcher, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      if (!Array.isArray(list.versions)) throw new Error('ответ без списка версий');
      try { fs.writeFileSync(manifestCachePath(), JSON.stringify(list)); } catch (_) {}
      return list;
    } catch (e) {
      errors.push(e);
      logLine('ⓘ Манифест версий: ' + host + ' недоступен (' + describeError(e).split('\n')[0] + ')');
    }
  }
  try {
    const cached = JSON.parse(fs.readFileSync(manifestCachePath(), 'utf8'));
    if (Array.isArray(cached.versions)) {
      logLine('ⓘ Хосты манифеста недоступны — использую сохранённый с прошлого запуска');
      return cached;
    }
  } catch (_) { /* кэша ещё нет */ }
  throw new AggregateError(errors, 'Не удалось получить манифест версий Mojang');
}

// AggregateError от xmcl прячет реальные причины в .errors — разворачиваем в понятный текст.
function describeError(err) {
  const seen = new Set();
  const msgs = [];
  (function walk(e) {
    if (!e) return;
    if (Array.isArray(e.errors)) e.errors.forEach(walk);
    if (e.cause) walk(e.cause);
    const m = (e.message || e.code || e.name || '').toString().trim();
    // пропускаем пустой AggregateError и вторичные «checksum» (следствие обрыва связи)
    if (m && m !== 'AggregateError' && !/checksum not match/i.test(m) && !seen.has(m)) {
      seen.add(m);
      msgs.push(m.length > 160 ? m.slice(0, 160) + '…' : m);
    }
  })(err);
  const joined = msgs.join(' | ');
  let hint = '';
  if (/CONNECT_TIMEOUT|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|fetch failed|socket|timeout/i.test(joined)) {
    hint = '\nПохоже на блокировку/обрыв сети у провайдера. Попробуйте включить VPN и запустить снова.';
  }
  return (msgs.slice(0, 3).join('\n') || (err && err.name) || 'неизвестная ошибка') + hint;
}

// ─── Пути ─────────────────────────────────────────────────────────────
function resourcesDir() {
  // В упакованном виде extraResources лежат в process.resourcesPath,
  // в dev — в ./resources
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
}
function javaExeName() {
  return process.platform === 'win32' ? 'javaw.exe' : 'java';
}
function bundledJavaPath() {
  // packaged: resources/jre (extraResources кладёт jre-<plat> → jre).
  // dev: resources/jre-win | resources/jre-linux.
  const exe = javaExeName();
  const bases = [
    path.join(resourcesDir(), 'jre'),
    path.join(resourcesDir(), process.platform === 'win32' ? 'jre-win' : 'jre-linux'),
  ];
  for (const base of bases) {
    const direct = path.join(base, 'bin', exe);
    if (fs.existsSync(direct)) return direct;
    try {
      for (const entry of fs.readdirSync(base)) {
        const cand = path.join(base, entry, 'bin', exe);
        if (fs.existsSync(cand)) return cand;
      }
    } catch (_) { /* нет папки */ }
  }
  return path.join(bases[0], 'bin', exe); // ожидаемый путь — ошибка всплывёт при запуске
}
// На Linux/macOS распакованный из архива java может потерять бит +x — выставляем.
function ensureExecutable(javaPath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(javaPath, 0o755);
    const binDir = path.dirname(javaPath);
    for (const f of fs.readdirSync(binDir)) {
      try { fs.chmodSync(path.join(binDir, f), 0o755); } catch (_) { /* пропускаем */ }
    }
  } catch (e) {
    logLine('! не удалось выставить права на java: ' + e.message);
  }
}
function modsResourceDir() {
  return path.join(resourcesDir(), 'mods');
}
function configPath() {
  return path.join(app.getPath('userData'), 'launcher-config.json');
}
function defaultGameDir() {
  return path.join(app.getPath('appData'), '.mistmc');
}

// ─── Шифрование секретов конфига ──────────────────────────────────────
// refreshToken Microsoft — долгоживущий ключ к аккаунту; в открытом виде на диске
// его мог бы забрать любой процесс/бэкап/сосед по ПК. Шифруем через безопасное
// хранилище ОС (DPAPI на Windows, keyring на Linux). Если шифрование недоступно
// (например Linux без keyring) — честно пишем как есть, поведение не ломаем.
function encryptSecret(plain) {
  if (!plain) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plain).toString('base64');
    }
  } catch (_) { /* fall through */ }
  return null;
}
function decryptSecret(b64) {
  if (!b64) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch (_) {
    return null; // сменился профиль ОС/ключ — токен нечитаем, потребуется повторный вход
  }
}

// ─── Конфиг ───────────────────────────────────────────────────────────
function loadConfig() {
  const defaults = {
    ram: 4096,
    loader: 'fabric',
    joinServer: true,
    gameDir: defaultGameDir(),
    msAccount: null, // { refreshToken, name, uuid }
    accountType: null, // 'offline' | 'msa' | null
    offlineName: null,
    discordRpc: true, // статус «Играет за <ник>» в Discord
    // внешний вид: null = стандартная тема лаунчера
    theme: { accent: null, bg: null, bgImage: null, bgOpacity: 45 },
  };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const cfg = Object.assign(defaults, raw);
    // Расшифровываем зашифрованный refreshToken в рабочее поле refreshToken.
    if (cfg.msAccount && cfg.msAccount.refreshTokenEnc && !cfg.msAccount.refreshToken) {
      const dec = decryptSecret(cfg.msAccount.refreshTokenEnc);
      cfg.msAccount = dec
        ? { name: cfg.msAccount.name, uuid: cfg.msAccount.uuid, refreshToken: dec }
        : null; // не расшифровался → просим войти заново
    }
    return cfg;
  } catch (_) {
    return defaults;
  }
}
function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    // На диск — копия без плейнтекст-токена: заменяем refreshToken на refreshTokenEnc.
    const toWrite = Object.assign({}, cfg);
    if (cfg.msAccount && cfg.msAccount.refreshToken) {
      const enc = encryptSecret(cfg.msAccount.refreshToken);
      toWrite.msAccount = enc
        ? { name: cfg.msAccount.name, uuid: cfg.msAccount.uuid, refreshTokenEnc: enc }
        : Object.assign({}, cfg.msAccount); // шифрование недоступно — пишем как есть
    }
    fs.writeFileSync(configPath(), JSON.stringify(toWrite, null, 2));
  } catch (e) { /* ignore */ }
}

// ─── Аккаунты ─────────────────────────────────────────────────────────
// Оффлайн-UUID = name-based v3 от "OfflinePlayer:<ник>" (алгоритм ванильного
// сервера и FastLogin) — данные игрока стабильны между запусками.
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

// Активный аккаунт для renderer/запуска: {type, name, uuid} | null
function resolveAccount(cfg) {
  if (cfg.accountType === 'msa' && cfg.msAccount && cfg.msAccount.name) {
    return { type: 'msa', name: cfg.msAccount.name, uuid: cfg.msAccount.uuid };
  }
  if (cfg.accountType === 'offline' && cfg.offlineName) {
    return { type: 'offline', name: cfg.offlineName, uuid: offlineUuid(cfg.offlineName) };
  }
  // миграция со старого конфига 1.1.0: был только msAccount без accountType
  if (!cfg.accountType && cfg.msAccount && cfg.msAccount.name) {
    return { type: 'msa', name: cfg.msAccount.name, uuid: cfg.msAccount.uuid };
  }
  return null;
}

// ─── Окно ─────────────────────────────────────────────────────────────
let mainWindow = null;

// Процесс запущенной игры. Пока он жив, лаунчер можно «закрыть» отдельно от
// Minecraft: окно исчезает, а сам процесс остаётся ждать выхода игры в фоне
// (лог, Discord RPC и авто-починка модов продолжают работать) и завершается
// сам, как только игра закрылась.
let gameProc = null;
function gameRunning() { return !!(gameProc && gameProc.exitCode === null && !gameProc.killed); }

// Одиночная блокировка нужна только для одного: разбудить лаунчер, который
// ждёт игру В ФОНЕ без окна (см. window-close). Осознанный второй запуск при
// ОТКРЫТОМ окне — легальный сценарий (мультиаккаунт: два лаунчера, два ника),
// он работает как до 1.7.0 — независимым процессом. Отличаем случаи маркером:
// фоновый держатель блокировки пишет свой pid в background.pid.
const BG_MARKER = path.join(app.getPath('userData'), 'background.pid');
function setBackgroundMarker(on) {
  try {
    if (on) fs.writeFileSync(BG_MARKER, String(process.pid));
    else clearOwnMarker();
  } catch (_) {}
}
function clearOwnMarker() {
  try {
    if (parseInt(fs.readFileSync(BG_MARKER, 'utf8'), 10) === process.pid) fs.unlinkSync(BG_MARKER);
  } catch (_) {}
}
function backgroundInstanceAlive() {
  try {
    const pid = parseInt(fs.readFileSync(BG_MARKER, 'utf8'), 10);
    if (!pid || pid === process.pid) return false;
    process.kill(pid, 0); // жив ли процесс; сигнал не шлётся
    return true;
  } catch (_) {
    return false;
  }
}
// true = мы «второй лаунчер» мультиаккаунта: без блокировки и без фонового маркера
let multiInstance = false;
// Маркер читаем ДО запроса блокировки: сам запрос будит фонового держателя,
// тот пересоздаёт окно и стирает маркер — прочитав после, мы бы решили,
// что это мультиаккаунт, и открыли второе окно рядом с разбуженным.
const wasBackgroundAlive = backgroundInstanceAlive();
if (!app.requestSingleInstanceLock()) {
  if (wasBackgroundAlive) {
    filelog.line('Лаунчер уже ждёт игру в фоне — бужу его окно и выхожу.');
    app.exit(0);
  } else {
    multiInstance = true;
    filelog.line('Второй экземпляр (мультиаккаунт) — работаю независимо, без одиночной блокировки.');
  }
}
app.on('second-instance', () => {
  app.whenReady().then(() => {
    // Будим только фоновый режим. Если окно открыто — ничего не делаем:
    // новый процесс увидит это и запустится сам, отдельным лаунчером.
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      clearOwnMarker();
    }
  });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 920,
    minHeight: 600,
    resizable: true,
    frame: false,
    backgroundColor: '#0f0518',
    title: 'Mist MC Launcher',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('did-finish-load', () => {
    filelog.line('окно загружено');
    scheduleBlackFrameCheck();
    // окно могли открыть заново, пока игра работает в фоне — покажем это сразу
    if (gameRunning()) {
      send('state', { state: 'running' });
      send('status', 'Игра запущена');
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) =>
    filelog.crash('Окно не загрузилось', { code, desc }));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Запуск из исходников (npx electron .) помечаем прямо в окне: собранный
  // release-билд выглядит ТОЧНО так же, и правки «не видны» именно из-за
  // запуска не того лаунчера — метка снимает вопрос раз и навсегда.
  if (!app.isPackaged) {
    mainWindow.setTitle('Mist MC Launcher · DEV (исходники)');
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.executeJavaScript(`(() => {
        const b = document.createElement('div');
        b.textContent = 'DEV · исходники';
        b.style.cssText = 'position:fixed;top:6px;right:96px;z-index:9999;' +
          'background:#f59e0b;color:#000;font:600 11px sans-serif;' +
          'padding:2px 8px;border-radius:6px;pointer-events:none;';
        document.body.appendChild(b);
      })()`).catch(() => {});
    });
  }
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// Детектор «чёрного окна» (Linux): через 4с после загрузки снимаем кадр и ищем
// хоть несколько пикселей заметно ярче фона #0f0518. В UI всегда есть светлый
// текст и кнопки, поэтому полностью тёмный кадр = GPU не отрисовал страницу →
// уходим в программный рендер через enterGpuFallback.
function scheduleBlackFrameCheck() {
  if (process.platform !== 'linux' || gpuFallback) return;
  setTimeout(async () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.isVisible() || mainWindow.isMinimized()) return; // кадр свёрнутого окна пуст — не повод
      const img = await mainWindow.webContents.capturePage();
      const { width, height } = img.getSize();
      if (!width || !height) return;
      const buf = img.getBitmap(); // BGRA
      let bright = 0;
      for (let i = 0; i < buf.length; i += 4 * 16) { // каждый 16-й пиксель
        if (buf[i] > 80 || buf[i + 1] > 80 || buf[i + 2] > 80) { if (++bright > 8) return; }
      }
      enterGpuFallback('окно загрузилось, но кадр полностью чёрный');
    } catch (_) {}
  }, 4000);
}

// ─── Автообновление ───────────────────────────────────────────────────
// electron-updater по generic-каналу: сверяет версию с https://mistmc.gg/downloads/latest.yml
// и тихо качает новую версию в фоне. Установка «мягкая»: quitAndInstall(true, true) —
// NSIS запускается в silent-режиме (/S), без окон мастера, и сам перезапускает
// лаунчер. Renderer получает состояния update-state: available → downloading →
// ready (кнопка «Обновить» с прогрессом). Нажатие до конца загрузки просто
// ставит флаг «установить, как докачается».
// В dev-запуске и без app-update.yml (старые распаковки) молча выключено.
function setupAutoUpdate() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // не нажал кнопку — тихо доставится при закрытии
  let downloaded = false;
  let installWhenReady = false; // «Обновить» нажали, пока файл ещё качался
  let mirrorFeed = false;       // фид переключён на зеркало files.mistmc.gg/dl
  autoUpdater.on('update-available', (info) => {
    logLine('⬆ Доступно обновление ' + info.version + ' — скачиваю в фоне…');
    send('update-state', { state: 'available', version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    send('update-state', { state: 'downloading', percent: Math.round(p.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloaded = true;
    logLine('⬆ Обновление ' + info.version + ' скачано — жмите «Обновить» (поставится тихо, без установщика).');
    send('update-state', { state: 'ready', version: info.version });
    if (installWhenReady) autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on('error', (err) => {
    // обновление — не повод мешать играть: только строка в лог
    logLine('⬆ автообновление: ' + (err && err.message ? err.message.split('\n')[0] : err));
    send('update-state', { state: 'error' });
    // сайт не отвечает (например, RU IP заблокирован в стране игрока) —
    // одна перепроба через зеркало релизов на VPS раздачи
    if (!mirrorFeed) {
      mirrorFeed = true;
      try {
        autoUpdater.setFeedURL({ provider: 'generic', url: site.MIRROR_DOWNLOADS });
        logLine('⬆ пробую зеркало обновлений files.mistmc.gg…');
        autoUpdater.checkForUpdates().catch(() => {});
      } catch (_) {}
    }
  });
  ipcMain.on('update-restart', () => {
    if (downloaded) {
      autoUpdater.quitAndInstall(true, true); // silent NSIS + автоперезапуск
    } else {
      installWhenReady = true;
    }
  });
  autoUpdater.checkForUpdates().catch(() => {});
  // и раз в 4 часа, если лаунчер живёт долго
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600e3);
}

app.whenReady().then(() => {
  // Раздача фона окна: пускаем только файлы background.* из папки настроек —
  // произвольный путь из renderer открыть нельзя.
  protocol.handle('mistbg', (request) => {
    try {
      const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
      if (!/^background\.[a-z0-9]{2,5}$/i.test(name)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(bgImagePath(name)).toString());
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });
  createWindow();
  // ранняя проба базы сайта (mistmc.gg или зеркало) — к моменту первого
  // хартбита/каталога выбор уже сделан
  site.getBase().catch(() => {});
  setupAutoUpdate();
  translate.init(app.getPath('userData'));
  const cfg = loadConfig();
  if (cfg.discordRpc !== false) {
    rpc.init(DISCORD_RPC_APP_ID, logLine);
    rpc.setIdle(resolveAccount(cfg)?.name);
  }
});
app.on('will-quit', () => { filelog.line('════ Выход из лаунчера'); clearOwnMarker(); rpc.disable(); });
app.on('window-all-closed', () => {
  if (gameRunning()) {
    filelog.line('Окно закрыто при работающей игре — жду её завершения в фоне.');
    // маркер пишет только держатель блокировки: повторный запуск exe будит
    // именно его; мульти-экземпляры ждут молча, их relaunch не касается
    if (!multiInstance) setBackgroundMarker(true);
  } else {
    app.quit();
  }
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Хелперы прогресса ────────────────────────────────────────────────
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function status(text) { send('status', text); filelog.line('◆ ' + text); }
function logLine(text) { send('log', text); filelog.line(text); }

// Хартбит на сайт: «играю за <ник>» при запуске игры. Сайт склеит это с входом
// на сервер (ловит вход через лаунчер любым способом). Fire-and-forget, 5с таймаут,
// ошибки молчим — метрика не должна мешать запуску игры.
function sendLauncherHeartbeat(nick, client) {
  if (!nick) return;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const version = app.getVersion();
    const body = { nick, version };
    // инвентаризация клиента (моды/паки, включая закинутые руками) — для админки
    if (client) body.client = client;
    // Подпись запроса ключом официальной сборки: сайт отличает настоящий
    // лаунчер от подделки/ручного запроса. Без ключа (публичная сборка)
    // хартбит уходит неподписанным.
    if (buildSecret.HEARTBEAT_HMAC_KEY) {
      // ts по часам сервера — сбитые часы игрока не ломают подпись
      body.ts = site.serverNow();
      body.sig = crypto
        .createHmac('sha256', buildSecret.HEARTBEAT_HMAC_KEY)
        .update(nick + '|' + version + '|' + body.ts)
        .digest('hex');
    }
    // site.siteFetch: mistmc.gg, а при его недоступности (RU IP блокируют
    // из Украины) — зеркало files.mistmc.gg/site
    site.siteFetch('/api/bridge/launcher/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch(() => {}).finally(() => clearTimeout(timer));
  } catch (_) { /* ignore */ }
}

async function runTask(label, taskObj) {
  status(label);
  logLine('▶ ' + label);
  return taskObj.startAndWait({
    onUpdate() {
      const p = taskObj.progress || 0;
      const t = taskObj.total || 0;
      send('progress', {
        label,
        percent: t ? Math.min(100, Math.round((p / t) * 100)) : -1,
      });
    },
    onFailed(_t, err) {
      logLine('✖ ошибка: ' + (err && err.message ? err.message : String(err)));
    },
  });
}

// ─── IPC ──────────────────────────────────────────────────────────────
// ─── Фоновая картинка темы ────────────────────────────────────────────
// Файл кладём рядом с конфигом, а renderer получает его как data: URL —
// CSP запрещает ему тянуть file://, зато data: в img-src разрешён.
// Формат определяем по СОДЕРЖИМОМУ, а не по расширению: Windows сплошь и
// рядом сохраняет JPEG как .jfif, встречаются .jpe, .bmp, .avif — по списку
// расширений такие файлы отвергались, хотя открылись бы прекрасно.
const BG_EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/bmp': '.bmp', 'image/avif': '.avif',
  'image/x-icon': '.ico', 'image/svg+xml': '.svg',
};
// Видео фоном: transcode не делаем, отдаём как есть через свой протокол
const BG_VIDEO_MIME = { 'video/mp4': '.mp4', 'video/webm': '.webm' };
const BG_MAX_SOURCE = 80 * 1024 * 1024;  // исходник (видео бывает тяжёлым)
const BG_MAX_STORED = 8 * 1024 * 1024;   // картинка, которая ложится в интерфейс
const BG_MAX_VIDEO = 60 * 1024 * 1024;   // видео храним как есть
const BG_MAX_SIDE = 2560;                // больше на фон всё равно не нужно

function sniffImageMime(buf) {
  const ascii = (from, to) => buf.toString('latin1', from, to);
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /avif|avis|mif1/.test(ascii(8, 20))) return 'image/avif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01) return 'image/x-icon';
  if (/<svg[\s>]/i.test(ascii(0, Math.min(buf.length, 600)))) return 'image/svg+xml';
  // видео: mp4/mov опознаём по ftyp-бренду, webm — по сигнатуре Matroska
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 20);
    if (/isom|mp4|avc1|iso2|M4V|qt/i.test(brand)) return 'video/mp4';
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}
const isVideoMime = (m) => !!BG_VIDEO_MIME[m];

function bgImagePath(name) {
  return path.join(app.getPath('userData'), name);
}
/** Что показывать в фоне: { url, kind: 'image' | 'video' } или null. */
function bgMedia(name) {
  if (!name) return null;
  try {
    const p = bgImagePath(name);
    const st = fs.statSync(p);
    // сигнатуру читаем с начала файла — видео целиком в память не тянем
    const fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(Math.min(1024, st.size));
    fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const mime = sniffImageMime(head);
    if (!mime) return null;
    // ?v= — чтобы окно не показывало прежний файл из кэша после замены
    return {
      url: 'mistbg://media/' + encodeURIComponent(name) + '?v=' + st.mtimeMs,
      kind: isVideoMime(mime) ? 'video' : 'image',
    };
  } catch (_) {
    return null; // файл удалили руками — просто рисуем без фона
  }
}

/** Ужимаем тяжёлые картинки средствами Electron: иначе фото на 20 МБ
 *  раздувается в base64 до 27 МБ и тормозит окно. Что не по зубам
 *  (webp/avif/svg/анимации) — оставляем как есть, их рисует сам Chromium. */
function shrinkImage(buf, mime) {
  if (buf.length <= 1.5 * 1024 * 1024) return { buf, mime };
  try {
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return { buf, mime };
    const size = img.getSize();
    if (Math.max(size.width, size.height) > BG_MAX_SIDE) {
      img = size.width >= size.height
        ? img.resize({ width: BG_MAX_SIDE, quality: 'good' })
        : img.resize({ height: BG_MAX_SIDE, quality: 'good' });
    }
    const jpeg = img.toJPEG(88);
    return jpeg && jpeg.length && jpeg.length < buf.length
      ? { buf: jpeg, mime: 'image/jpeg' }
      : { buf, mime };
  } catch (_) {
    return { buf, mime };
  }
}

ipcMain.handle('pick-bg-image', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Картинки и видео', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'jpe', 'webp', 'gif', 'bmp', 'avif', 'ico', 'svg', 'mp4', 'webm'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const src = res.filePaths[0];
  try {
    const st = fs.statSync(src);
    if (st.size > BG_MAX_SOURCE) {
      return { ok: false, error: 'Файл больше 80 МБ — возьми полегче' };
    }
    // сигнатуру смотрим по началу файла, не читая целиком (видео бывает большим)
    const fd = fs.openSync(src, 'r');
    const head = Buffer.alloc(Math.min(1024, st.size));
    fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const mime = sniffImageMime(head);
    if (!mime) return { ok: false, error: 'Это не похоже на картинку или видео' };

    let outMime = mime;
    let buf;
    if (isVideoMime(mime)) {
      if (st.size > BG_MAX_VIDEO) {
        return { ok: false, error: 'Видео больше 60 МБ — возьми покороче' };
      }
      buf = fs.readFileSync(src);
    } else {
      const shrunk = shrinkImage(fs.readFileSync(src), mime);
      buf = shrunk.buf;
      outMime = shrunk.mime;
      if (buf.length > BG_MAX_STORED) {
        return { ok: false, error: 'Картинку не удалось ужать — попробуй другую' };
      }
    }

    const ext = BG_EXT_BY_MIME[outMime] || BG_VIDEO_MIME[outMime] || '.png';
    const name = 'background' + ext;
    // старые фоны других форматов убираем, иначе останутся мусором
    const allExt = new Set([...Object.values(BG_EXT_BY_MIME), ...Object.values(BG_VIDEO_MIME)]);
    for (const e of allExt) {
      if (e !== ext) { try { fs.unlinkSync(bgImagePath('background' + e)); } catch (_) { /* нет файла */ } }
    }
    fs.writeFileSync(bgImagePath(name), buf);
    const cfg = loadConfig();
    cfg.theme = Object.assign({}, cfg.theme, { bgImage: name });
    saveConfig(cfg);
    return { ok: true, name, media: bgMedia(name), kind: isVideoMime(outMime) ? 'video' : 'image' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('clear-bg-image', () => {
  const cfg = loadConfig();
  const name = cfg.theme && cfg.theme.bgImage;
  if (name) { try { fs.unlinkSync(bgImagePath(name)); } catch (_) { /* уже нет */ } }
  cfg.theme = Object.assign({}, cfg.theme, { bgImage: null });
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('get-config', () => {
  const config = loadConfig();
  // версию лаунчера отдаём отсюда, а не из VERSION_INFO: getVersion() доступен
  // только после инициализации app, а модуль читается раньше
  return {
    config,
    versionInfo: { ...VERSION_INFO, launcher: app.getVersion() },
    account: resolveAccount(config),
    bgMedia: bgMedia(config.theme && config.theme.bgImage),
    arch: process.arch, // ia32-сборке renderer урезает ползунок памяти
  };
});
// Renderer шлёт только игровые настройки — мержим по белому списку, иначе
// каждое сохранение затирало бы аккаунт (accountType/offlineName/msAccount).
ipcMain.handle('save-config', (_e, patch) => {
  const cfg = loadConfig();
  const rpcWas = cfg.discordRpc !== false;
  for (const k of ['ram', 'loader', 'joinServer', 'gameDir', 'discordRpc', 'theme']) {
    if (patch && k in patch) cfg[k] = patch[k];
  }
  saveConfig(cfg);
  const rpcNow = cfg.discordRpc !== false;
  if (rpcWas !== rpcNow) {
    if (rpcNow) {
      rpc.enable(DISCORD_RPC_APP_ID, logLine);
      rpc.setIdle(resolveAccount(cfg)?.name);
    } else {
      rpc.disable();
    }
  }
  return true;
});
ipcMain.handle('open-external', (_e, url) => {
  // Только https — не даём renderer открыть произвольную схему (file:, javascript: и т.п.).
  const target = typeof url === 'string' && /^https:\/\//i.test(url) ? url : SITE_URL;
  return shell.openExternal(target);
});
ipcMain.on('window-min', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-close', () => {
  // Игра идёт → закрываем только окно: убей мы процесс — вместе с ним умер бы
  // и Minecraft (дочерний процесс). Игра доиграет — процесс выйдет сам.
  if (gameRunning()) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  } else {
    app.quit();
  }
});

ipcMain.handle('pick-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

// Открыть папку игры в проводнике (создаём, если до первого запуска её ещё нет)
ipcMain.handle('open-game-dir', async () => {
  const dir = currentGameDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* покажет openPath */ }
  const err = await shell.openPath(dir);
  return { ok: !err, error: err || undefined };
});

// ── Перенос настроек из другого лаунчера ──
ipcMain.handle('migrate-scan', () => {
  try {
    return migrate.scanSources(currentGameDir());
  } catch (e) {
    return [];
  }
});
// ручной выбор папки: диалог + проверка «похоже на игровую папку» + статистика
ipcMain.handle('migrate-pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  const dir = res.filePaths[0];
  return {
    dir,
    label: 'Своя папка: ' + dir,
    looksLikeMinecraft: migrate.looksLikeMinecraftDir(dir),
    stats: migrate.statsFor(dir),
  };
});
ipcMain.handle('migrate-run', (_e, { dir, parts }) => {
  if (typeof dir !== 'string' || !dir) return ['✖ Папка не выбрана.'];
  try {
    return migrate.importFrom(dir, currentGameDir(), parts || {}, (l) => send('log', l));
  } catch (e) {
    return ['✖ Ошибка переноса: ' + (e && e.message ? e.message : e)];
  }
});

function authErrorText(err) {
  const m = err && err.message ? err.message : String(err);
  if (m === 'APP_NOT_APPROVED') {
    return 'Приложение ещё не одобрено Microsoft для входа в Minecraft (заявка aka.ms/mce-reviewappid). До одобрения вход недоступен (403).';
  }
  if (m === 'NO_MINECRAFT') return 'На этом аккаунте Microsoft нет купленного Minecraft.';
  if (/Окно входа закрыто/.test(m)) return 'Вход отменён.';
  return m;
}

ipcMain.handle('ms-login', async () => {
  try {
    const acc = await msauth.login(MS_CLIENT_ID, mainWindow);
    const cfg = loadConfig();
    cfg.msAccount = { refreshToken: acc.refreshToken, name: acc.name, uuid: acc.uuid };
    cfg.accountType = 'msa';
    saveConfig(cfg);
    return { ok: true, account: { type: 'msa', name: acc.name, uuid: acc.uuid } };
  } catch (err) {
    return { ok: false, error: authErrorText(err) };
  }
});

ipcMain.handle('offline-login', (_e, name) => {
  const nick = String(name || '').trim();
  if (!NICK_RE.test(nick)) {
    return { ok: false, error: 'Ник: 3–16 символов, латиница/цифры/подчёркивание' };
  }
  const cfg = loadConfig();
  cfg.accountType = 'offline';
  cfg.offlineName = nick;
  saveConfig(cfg);
  return { ok: true, account: { type: 'offline', name: nick, uuid: offlineUuid(nick) } };
});

ipcMain.handle('logout', () => {
  const cfg = loadConfig();
  cfg.accountType = null;
  cfg.msAccount = null;
  cfg.offlineName = null;
  saveConfig(cfg);
  return true;
});

// ─── Моды (Modrinth) ─────────────────────────────────────────────────
function currentGameDir() {
  return loadConfig().gameDir || defaultGameDir();
}
ipcMain.handle('mods-list', (_e, { type, loader }) => {
  try {
    return { ok: true, ...mods.listContent(currentGameDir(), type, loader, modsResourceDir()) };
  } catch (e) {
    return { ok: false, error: e.message, bundled: [], user: [] };
  }
});
// Перевод — с жёстким потолком по времени: не успел — показываем оригинал,
// а результат всё равно докэшируется и всплывёт при следующем запросе.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((r) => setTimeout(() => r(fallback), ms)),
  ]);
}

ipcMain.handle('mods-search', async (_e, { query, type, loader }) => {
  try {
    const hits = await mods.searchContent(query, type, loader, MC_VERSION);
    // описания результатов — на русский (одним пакетным запросом)
    const tr = await withTimeout(
      translate.batch(hits.map((h) => h.description), hits.map((h) => h.title)), 4000, null);
    if (tr) hits.forEach((h, i) => { h.description = tr[i]; });
    return { ok: true, hits };
  } catch (e) {
    return {
      ok: false,
      error: 'Поиск Modrinth сейчас недоступен (' + e.message + ') — попробуй ещё раз через минуту. Подборка ниже работает.',
      hits: [],
    };
  }
});
ipcMain.handle('mod-details', async (_e, { idOrSlug }) => {
  try {
    const project = await mods.projectDetails(idOrSlug);
    // полное описание и краткую строку — на русский; null = перевода нет,
    // модалка покажет оригинал (и переключатель не появится)
    const [bodyRu, descriptionRu] = await withTimeout(Promise.all([
      translate.markdown(project.body, [project.title]),
      translate.plain(project.description, [project.title]),
    ]), 12000, [null, null]);
    return {
      ok: true,
      project: {
        ...project,
        bodyRu: bodyRu && bodyRu !== project.body ? bodyRu : null,
        descriptionRu: descriptionRu && descriptionRu !== project.description ? descriptionRu : null,
      },
    };
  } catch (e) {
    return { ok: false, error: 'Не удалось загрузить страницу мода: ' + e.message };
  }
});
ipcMain.handle('mods-popular', async (_e, { type, loader }) => {
  try {
    return { ok: true, hits: await mods.popularContent(type, loader, MC_VERSION) };
  } catch (e) {
    return { ok: false, error: 'Modrinth недоступен: ' + e.message, hits: [] };
  }
});
ipcMain.handle('mod-install', async (_e, { project, type, loader }) => {
  try {
    const res = await mods.installContent(currentGameDir(), project, type, loader, MC_VERSION, logLine);
    // Совместимость проверяем СРАЗУ при установке, а не при запуске игры:
    // разруливатель подберёт версии по fabric.mod.json, а его рассказ о том,
    // что он сделал (заменил/выключил и почему), показываем игроку в карточке.
    if (res && res.ok && !res.already && type === 'mod' && loader === 'fabric') {
      const notes = [];
      try {
        await mods.enforceJarDeps(currentGameDir(), loader, MC_VERSION, (s) => {
          logLine(s);
          const line = String(s).trim();
          if (line.startsWith('⚑') || line.startsWith('−') || line.startsWith('→') || line.startsWith('!')) notes.push(line);
        });
      } catch (_) { /* без сети — разрулит проверка перед запуском */ }
      if (notes.length) return { ...res, notes };
    }
    return res;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('mod-toggle', (_e, { type, fileName, enabled, bundled }) => {
  return bundled
    ? mods.toggleBundledMod(currentGameDir(), fileName, enabled)
    : mods.toggleUserContent(currentGameDir(), type, fileName, enabled);
});
ipcMain.handle('mod-remove', (_e, { type, fileName }) => mods.removeUserContent(currentGameDir(), type, fileName));

// ─── Сообщество: оценки модов и коды сборок ──────────────────────────
function currentNick() {
  const acc = resolveAccount(loadConfig());
  return acc ? acc.name : null;
}

ipcMain.handle('community-vote', async (_e, { project, value }) => {
  const nick = currentNick();
  if (!nick) return { ok: false, error: 'Сначала войдите в аккаунт' };
  if (!project || !project.projectId) return { ok: false, error: 'Нет мода' };
  return community.vote(nick, project, value);
});
ipcMain.handle('community-ratings', (_e, { ids }) => community.ratings(ids, currentNick()));
ipcMain.handle('community-top', (_e, { type }) => community.top(type, 25));

ipcMain.handle('cosmetics-list', () => community.cosmetics(currentNick()));
ipcMain.handle('cosmetics-action', (_e, { action, id, slot }) => {
  const nick = currentNick();
  if (!nick) return { ok: false, error: 'Сначала войдите в аккаунт' };
  return community.cosmeticAction(nick, action, id, slot);
});

// Модели косметики для витрины: витрина показывает саму вещь на персонаже,
// а модели живут в паке — достаём их и отдаём окну.
ipcMain.handle('cosmetic-assets', async () => {
  const manifest = await community.cosmeticPack(currentNick());
  if (!manifest || !manifest.ok) return { ok: false, error: (manifest && manifest.error) || 'сайт недоступен' };
  return cosmeticassets.collect(app.getPath('userData'), manifest, logLine);
});
ipcMain.handle('cosmetic-drawn-model', async (_e, { kind, png }) => {
  const manifest = await community.cosmeticPack(currentNick());
  if (!manifest || !manifest.ok) return { ok: false, error: 'сайт недоступен' };
  const model = await cosmeticassets.drawnModel(app.getPath('userData'), manifest, kind, png, logLine);
  return model ? { ok: true, model } : { ok: false, error: 'модель не найдена' };
});

// Свой скин: заливаем на сайт, оттуда его берёт сервер (SkinsRestorer).
ipcMain.handle('skin-apply', (_e, { png, slim }) => {
  const nick = currentNick();
  if (!nick) return { ok: false, error: 'Сначала войдите в аккаунт' };
  return community.applySkin(nick, png, !!slim);
});
ipcMain.handle('skin-reset', () => {
  const nick = currentNick();
  if (!nick) return { ok: false, error: 'Сначала войдите в аккаунт' };
  return community.resetSkin(nick);
});
// Какой скин показывать в примерочной: свой с сайта, если поставлен
ipcMain.handle('skin-state', () => {
  const nick = currentNick();
  if (!nick) return { ok: true, url: null };
  return community.skinState(nick);
});

// Черновики рисунков (плащ/флаг): лежат локально в userData и переживают
// перезапуск лаунчера — можно бросить рисунок и вернуться к нему в любой момент.
function draftsFile() { return path.join(app.getPath('userData'), 'draw-drafts.json'); }
function loadDraftsAll() {
  try { return JSON.parse(fs.readFileSync(draftsFile(), 'utf8')) || {}; } catch (_) { return {}; }
}
function saveDraftsAll(all) {
  try { fs.writeFileSync(draftsFile(), JSON.stringify(all)); } catch (e) { logLine('черновик не сохранился: ' + e.message); }
}
const DRAFT_KINDS = new Set(['cape', 'flag']);
ipcMain.handle('draft-load', (_e, { kind }) => {
  const nick = currentNick();
  if (!nick || !DRAFT_KINDS.has(kind)) return null;
  return loadDraftsAll()[nick + ':' + kind] || null;
});
ipcMain.handle('draft-save', (_e, { kind, zones }) => {
  const nick = currentNick();
  if (!nick || !DRAFT_KINDS.has(kind) || !zones || typeof zones !== 'object') return false;
  const clean = {};
  for (const z of ['face', 'elytra']) {
    const v = zones[z];
    // зоны крошечные (20×40 максимум) — data:-строка больше 300 КБ означает мусор
    if (typeof v === 'string' && v.startsWith('data:image/png;base64,') && v.length < 300000) clean[z] = v;
  }
  if (!Object.keys(clean).length) return false;
  const all = loadDraftsAll();
  all[nick + ':' + kind] = { zones: clean, ts: Date.now() };
  saveDraftsAll(all);
  return true;
});
ipcMain.handle('draft-clear', (_e, { kind }) => {
  const nick = currentNick();
  if (!nick) return false;
  const all = loadDraftsAll();
  if (nick + ':' + kind in all) {
    delete all[nick + ':' + kind];
    saveDraftsAll(all);
  }
  return true;
});

// Рисованные плащи и флаги: состояние своих заявок и отправка на модерацию.
ipcMain.handle('drawings-list', () => community.drawings(currentNick()));
ipcMain.handle('drawing-submit', (_e, { kind, png }) => {
  const nick = currentNick();
  if (!nick) return { ok: false, error: 'Сначала войдите в аккаунт' };
  return community.submitDrawing(nick, kind, png);
});

ipcMain.handle('build-share', async (_e, { loader, parts }) => {
  const nick = currentNick();
  if (!nick) return { ok: false, error: 'Сначала войдите в аккаунт' };
  let build;
  try {
    build = mods.exportBuild(currentGameDir(), loader || 'fabric', parts);
  } catch (e) {
    return { ok: false, error: e.message }; // например, настройки не влезли
  }
  if (!build.items.length && !build.filesGz) {
    return { ok: false, error: 'Сборка пустая — поставь хотя бы один мод' };
  }
  const res = await community.shareBuild(nick, build);
  return res.ok ? { ...res, filesInfo: build.filesInfo || null } : res;
});

// Код смотрим ДО установки: получатель должен видеть, что в нём лежит, и сам
// решить, брать ли чужие настройки. Ответ держим в памяти, чтобы установка
// не дёргала сайт повторно (и не накручивала счётчик применений).
let pendingBuild = null;
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

ipcMain.handle('build-preview', async (_e, { code }) => {
  const res = await community.fetchBuild(code);
  if (!res.ok) return res;
  pendingBuild = { code: normCode(res.code), author: res.author, build: res.build };
  return {
    ok: true,
    code: res.code,
    author: res.author,
    items: (res.build && Array.isArray(res.build.items) ? res.build.items.length : 0),
    filesInfo: (res.build && res.build.filesInfo) || null,
  };
});

ipcMain.handle('build-apply', async (_e, { code, parts }) => {
  let data = pendingBuild && pendingBuild.code === normCode(code) ? pendingBuild : null;
  if (!data) {
    const res = await community.fetchBuild(code);
    if (!res.ok) return res;
    data = { code: normCode(res.code), author: res.author, build: res.build };
  }
  try {
    status('Применяю сборку…');
    send('state', { state: 'working' });
    const summary = await mods.applyBuild(currentGameDir(), data.build, MC_VERSION, logLine, parts);
    send('state', { state: 'idle' });
    status('Сборка применена');
    return { ok: true, author: data.author, summary };
  } catch (e) {
    send('state', { state: 'idle' });
    return { ok: false, error: e.message };
  }
});

let launching = false;

ipcMain.handle('launch-game', async (_e, opts) => {
  // Дев-проверка фонового режима БЕЗ реальной игры (в release-сборке инертно):
  //   MISTMC_FAKE_GAME=1 npx electron .  → «игра» = пустой node-процесс на 10 мин
  if (!app.isPackaged && process.env.MISTMC_FAKE_GAME) {
    if (gameRunning()) return { ok: false, error: 'фейк-игра уже идёт' };
    const cp = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });
    gameProc = cp;
    send('state', { state: 'running' });
    logLine('▶ [тест] фейк-игра pid ' + cp.pid);
    cp.on('exit', () => {
      gameProc = null;
      send('state', { state: 'idle' });
      if (!mainWindow || mainWindow.isDestroyed()) {
        filelog.line('[тест] фейк-игра вышла, окна нет — выходим.');
        app.quit();
      }
    });
    return { ok: true };
  }
  if (launching) return { ok: false, error: 'Уже идёт запуск' };
  const loader = opts.loader || 'fabric';
  // 32-битный процесс адресует ~2 ГБ на всё: больше ~1 ГБ кучи JVM не поднимет
  const ramCap = process.arch === 'ia32' ? 1024 : 32768;
  const ram = Math.max(process.arch === 'ia32' ? 512 : 1024, Math.min(ramCap, parseInt(opts.ram, 10) || 4096));
  const joinServer = !!opts.joinServer;
  const gameDir = opts.gameDir || defaultGameDir();

  const cfg0 = loadConfig();
  const active = resolveAccount(cfg0);
  if (!active) {
    return { ok: false, error: 'Сначала войдите в аккаунт' };
  }

  launching = true;
  send('state', { state: 'working' });
  try {
    if (process.arch === 'ia32' && (parseInt(opts.ram, 10) || 4096) > ram) {
      logLine('ⓘ 32-битная система: память игры ограничена ' + ram + ' МБ.');
    }
    // msa: обновляем токен Microsoft → свежий Minecraft-токен.
    // offline: играем по нику, токен не нужен (FastLogin на сервере разрулит).
    let account;
    if (active.type === 'msa') {
      status('Проверка входа Microsoft…');
      try {
        const fresh = await msauth.refresh(MS_CLIENT_ID, cfg0.msAccount.refreshToken);
        const cfg = loadConfig();
        cfg.msAccount = { refreshToken: fresh.refreshToken, name: fresh.name, uuid: fresh.uuid };
        cfg.accountType = 'msa';
        saveConfig(cfg);
        account = { name: fresh.name, uuid: fresh.uuid, accessToken: fresh.accessToken, userType: 'msa' };
      } catch (e) {
        launching = false;
        send('state', { state: 'idle' });
        const t = authErrorText(e);
        logLine('✖ ' + t);
        send('auth-expired');
        return { ok: false, error: 'Вход Microsoft истёк, войдите заново: ' + t };
      }
    } else {
      account = { name: active.name, uuid: active.uuid, accessToken: '0', userType: 'mojang' };
    }

    fs.mkdirSync(gameDir, { recursive: true });
    const mc = MinecraftFolder.from(gameDir);
    const javaPath = bundledJavaPath();
    if (!fs.existsSync(javaPath)) {
      // Путь вида C:\Temp\Rar$EX...rartemp\ = игрок запустил exe двойным кликом
      // ПРЯМО ИЗ ОКНА АРХИВАТОРА: во времянку распаковывается только сам exe,
      // а resources/jre остаётся в архиве (живой случай 04.08).
      if (/rar\$|rartemp|[\\/]7z[A-Za-z0-9]{4,}[\\/]|[\\/]wz[a-z0-9]+[\\/]/i.test(javaPath)) {
        throw new Error('Лаунчер запущен прямо из окна архиватора — так распаковывается ' +
          'только часть файлов. Распакуйте архив ЦЕЛИКОМ в отдельную папку и запустите ' +
          'оттуда, а лучше скачайте установщик с mistmc.gg/downloads.');
      }
      // Иначе такое у игроков = антивирус унёс javaw.exe в карантин или
      // установка оборвалась (мало места). Сборка без JRE — только у разработчика.
      throw new Error('Не найден Java runtime (' + javaPath + '). ' +
        'Обычно его удаляет антивирус — проверьте карантин и добавьте папку лаунчера ' +
        'в исключения, затем переустановите лаунчер с mistmc.gg/downloads.');
    }
    ensureExecutable(javaPath);

    const dl = makeDownloadOptions();

    // Проба Mojang — параллельно с установкой, к моменту launch() уже готова
    const mojangArgsPromise = mojangSessionJvmArgs();

    // 1) Ванильный клиент 1.21.11
    const list = await fetchVersionList(dl.dispatcher);
    const meta = list.versions.find((v) => v.id === MC_VERSION);
    if (!meta) throw new Error('Версия ' + MC_VERSION + ' не найдена в манифесте Mojang');
    await runTask('Загрузка Minecraft ' + MC_VERSION, installer.installTask(meta, mc, dl));

    // 2) Загрузчик модов
    let versionId = MC_VERSION;
    if (loader === 'fabric') {
      status('Установка Fabric ' + FABRIC_LOADER);
      logLine('▶ Установка Fabric ' + FABRIC_LOADER);
      versionId = await installer.installFabric({
        minecraftVersion: MC_VERSION,
        version: FABRIC_LOADER,
        minecraft: mc,
        dispatcher: dl.dispatcher,
      });
      const resolved = await Version.parse(gameDir, versionId);
      await runTask('Загрузка библиотек Fabric', installer.installDependenciesTask(resolved, dl));
    } else if (loader === 'forge') {
      versionId = await runTask(
        'Установка Forge ' + FORGE_VERSION + ' (может занять пару минут)',
        installer.installForgeTask({ mcversion: MC_VERSION, version: FORGE_VERSION }, mc, { ...dl, java: javaPath })
      );
      const resolved = await Version.parse(gameDir, versionId);
      await runTask('Загрузка библиотек Forge', installer.installDependenciesTask(resolved, dl));
    }

    // 3) Синхронизация модов под выбранный загрузчик (вшитые + установленные из лаунчера)
    status('Синхронизация модов…');
    mods.syncMods(gameDir, loader, modsResourceDir(), logLine);
    // жёсткие версии-зависимости из fabric.mod.json (напр. Replay Voice Chat
    // требует Replay Mod ровно 2.6.25) — чиним ДО запуска; сбой сети не мешает
    try {
      await mods.enforceJarDeps(gameDir, loader, MC_VERSION, logLine);
    } catch (_) { /* без сети играем как есть */ }
    // 3.2) Freecam: непатченные джарники (с пролётом сквозь стены) подменяются
    // честной сборкой Mist; без сети — усыпляются, играем без freecam
    try {
      await mods.enforceFairFreecam(gameDir, logLine);
    } catch (_) { /* запуск важнее */ }

    // 3.5) Серверный ресурспак (петы) с автообновлением по sha1 — запасной
    // канал к раздаче пака сервером; сбои сети запуску не мешают
    status('Проверка ресурспака…');
    await respack.syncResourcePack(gameDir, logLine);

    // 3.6) Косметика: свой пак игрока с плащами и флагами. Собирается локально
    // и обновляется по описи с сайта — одобренный чужой плащ приезжает сразу,
    // а не с общим паком по расписанию.
    await cosmeticpack.syncCosmeticPack(gameDir, account.name, community, logLine);

    // 3.7) Конфиг мода MistCapes: при отладке против локального прокси
    // (MISTMC_SITE_URL) мод плащей должен смотреть туда же; на проде
    // конфиг убираем — мод живёт на своём дефолте https://mistmc.gg.
    // Если прямой сайт недоступен (RU IP заблокирован в стране игрока) —
    // направляем мод на зеркало, иначе плащи не загрузятся.
    try {
      const capesCfg = path.join(gameDir, 'config', 'mistcapes.json');
      await site.getBase().catch(() => {});
      if (process.env.MISTMC_SITE_URL) {
        fs.mkdirSync(path.dirname(capesCfg), { recursive: true });
        fs.writeFileSync(capesCfg, JSON.stringify({ base: SITE_URL }));
        logLine('  + плащи MistCapes → ' + SITE_URL);
      } else if (site.isMirror()) {
        fs.mkdirSync(path.dirname(capesCfg), { recursive: true });
        fs.writeFileSync(capesCfg, JSON.stringify({ base: site.MIRROR }));
        logLine('  + плащи MistCapes → зеркало (сайт недоступен напрямую)');
      } else if (fs.existsSync(capesCfg)) {
        fs.unlinkSync(capesCfg);
      }
    } catch (_) { /* косметика не должна мешать запуску */ }

    // 4) Запуск
    status('Запуск игры…');
    // метка «через лаунчер» + инвентаризация модов/паков для админки
    sendLauncherHeartbeat(account.name,
      mods.collectClientInventory(gameDir, modsResourceDir(), loader));
    logLine('▶ Запуск версии ' + versionId + ' от имени ' + account.name
      + (account.userType === 'msa' ? ' (Microsoft)' : ' (по нику)'));
    const proc = await launch({
      gamePath: gameDir,
      javaPath,
      version: versionId,
      gameProfile: { name: account.name, id: account.uuid },
      accessToken: account.accessToken,
      userType: account.userType,
      minMemory: Math.min(process.arch === 'ia32' ? 512 : 1024, ram),
      maxMemory: ram,
      launcherName: 'MistMC',
      launcherBrand: 'MistMC',
      versionType: 'Mist MC',
      quickPlayMultiplayer: joinServer ? JOIN_HOST : undefined,
      // свои extraJVMArgs ЗАМЕНЯЮТ дефолтные xmcl — дефолт возвращаем сами;
      // -Xmx2G из дефолтов выкидываем, как делает xmcl при заданном maxMemory
      // (иначе он встал бы ПОСЛЕ нашего -Xmx и урезал память до 2 ГБ)
      extraJVMArgs: [
        ...DEFAULT_EXTRA_JVM_ARGS.filter((v) => v !== '-Xmx2G'),
        ...(await mojangArgsPromise),
      ],
    });
    gameProc = proc; // пока жив — закрытие окна не завершает лаунчер

    // Логи процесса (кратко) + хвост для разбора краша: если игра упала из-за
    // мижина стороннего мода, по этому хвосту находим виновника
    let gameLogTail = '';
    const keepTail = (chunk) => {
      gameLogTail = (gameLogTail + chunk).slice(-65536);
    };
    if (proc.stdout) proc.stdout.on('data', (d) => { const s = d.toString(); keepTail(s); logLine(s.trimEnd()); });
    if (proc.stderr) proc.stderr.on('data', (d) => { const s = d.toString(); keepTail(s); logLine(s.trimEnd()); });

    const watcher = createMinecraftProcessWatcher(proc);
    watcher.on('error', (err) => {
      gameProc = null;
      logLine('✖ ' + (err && err.message ? err.message : String(err)));
      launching = false;
      send('state', { state: 'idle' });
      send('launch-error', String(err && err.message ? err.message : err));
      if (!mainWindow || mainWindow.isDestroyed()) app.quit();
    });
    watcher.on('minecraft-window-ready', () => {
      status('Игра запущена');
      send('state', { state: 'running' });
      if (loadConfig().discordRpc !== false) {
        rpc.setPlaying(account.name, loader === 'fabric' ? 'Fabric' : loader === 'forge' ? 'Forge' : 'Vanilla');
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    });
    watcher.on('minecraft-exit', ({ code, crashReport, crashReportLocation }) => {
      gameProc = null;
      launching = false;
      logLine('■ Игра закрыта (код ' + code + ')');
      if (code !== 0 && crashReport) {
        logLine('Крэш-репорт: ' + crashReportLocation);
      }
      // Краш из-за мижина стороннего мода (типовое: мод-аддон не пережил
      // обновление мода-хозяина). Резолвер такое не поймает — depends "*",
      // поэтому выключаем виновника по факту и рассказываем игроку.
      if (code !== 0) {
        const m = /Mixin apply for mod ([a-z0-9_.-]+) failed/i.exec(gameLogTail)
          || /Mixin \[[^\]]+ from mod ([a-z0-9_.-]+)\][^\n]*FAILED during APPLY/i.exec(gameLogTail);
        if (m) {
          const badId = m[1];
          const off = mods.disableModById(gameDir, loader, badId, logLine);
          if (off) {
            logLine('⚑ Игра упала из-за мода «' + off + '» — он временно выключен.');
            logLine('  Запусти игру ещё раз; вернуть мод можно во вкладке «Мои моды».');
            send('launch-error', 'Игра упала из-за мода «' + off + '» — он выключен, запусти ещё раз.');
          }
        }
      }
      if (loadConfig().discordRpc !== false) {
        rpc.setIdle(account.name);
      }
      send('state', { state: 'idle' });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.restore();
      } else {
        // окно закрыли во время игры — фоновому процессу больше нечего ждать
        filelog.line('Игра закрыта, окна нет — выходим.');
        app.quit();
      }
    });

    return { ok: true };
  } catch (err) {
    launching = false;
    send('state', { state: 'idle' });
    const msg = describeError(err);
    logLine('✖ Ошибка:');
    msg.split('\n').forEach((l) => logLine('   ' + l));
    return { ok: false, error: msg.split('\n')[0] };
  }
});
