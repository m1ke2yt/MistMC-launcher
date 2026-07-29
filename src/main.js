'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { launch, Version, MinecraftFolder, createMinecraftProcessWatcher } = require('@xmcl/core');
const installer = require('@xmcl/installer');
const { Agent, interceptors } = require('undici');
const msauth = require('./msauth');
const mods = require('./mods');
const rpc = require('./discordrpc');
const respack = require('./respack');
const migrate = require('./migrate');

// На Linux при распаковке из архива chrome-sandbox не получает setuid-root →
// стандартный sandbox падает. Отключаем его (безопасно для лаунчера в домашней папке).
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

// ─── Константы проекта ────────────────────────────────────────────────
const MC_VERSION = '1.21.11';
const FABRIC_LOADER = '0.19.3';   // последний стабильный loader под 1.21.11
const FORGE_VERSION = '61.1.0';   // recommended Forge под 1.21.11
const SERVER_HOST = 'mistmc.gg';  // Java SRV → connect.mistmc.gg:25584
// Автоподключение идёт по фактическому эндпоинту: по хосту в хендшейке сервер
// отличает вход через лаунчер от ручного входа по mistmc.gg (метрика в админке)
const JOIN_HOST = 'connect.mistmc.gg:25584';
const SITE_URL = 'https://mistmc.gg';
const MS_CLIENT_ID = 'fc39a138-e8b8-4d93-9fb9-c86f7c3d8e56'; // Azure App (MistMC Launcher)
const DISCORD_RPC_APP_ID = '1531346124374409299'; // приложение «MistMC» (отдельное, только для Rich Presence)

const VERSION_INFO = { mc: MC_VERSION, fabric: FABRIC_LOADER, forge: FORGE_VERSION, server: SERVER_HOST };

// Зеркала на случай, если официальные CDN Mojang недоступны/режутся (актуально для РФ).
// xmcl пробует хосты по порядку [0]→[n], поэтому официальный первый, bmclapi — запасной.
const ASSETS_HOSTS = ['https://resources.download.minecraft.net', 'https://bmclapi2.bangbang93.com/assets'];
const MAVEN_HOSTS = ['https://libraries.minecraft.net', 'https://bmclapi2.bangbang93.com/maven'];

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
  };
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
  if (/CONNECT_TIMEOUT|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|fetch failed|socket/i.test(joined)) {
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
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ─── Автообновление ───────────────────────────────────────────────────
// electron-updater по generic-каналу: сверяет версию с https://mistmc.gg/downloads/latest.yml,
// тихо качает установщик в фоне и ставит при выходе (или по кнопке «Перезапустить»).
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
  autoUpdater.autoInstallOnAppQuit = true; // тихо доставится при закрытии
  autoUpdater.on('update-available', (info) => {
    logLine('⬆ Доступно обновление ' + info.version + ' — скачиваю в фоне…');
  });
  autoUpdater.on('update-downloaded', (info) => {
    logLine('⬆ Обновление ' + info.version + ' готово — установится при закрытии лаунчера.');
    send('update-ready', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    // обновление — не повод мешать играть: только строка в лог
    logLine('⬆ автообновление: ' + (err && err.message ? err.message.split('\n')[0] : err));
  });
  ipcMain.on('update-restart', () => autoUpdater.quitAndInstall());
  autoUpdater.checkForUpdates().catch(() => {});
  // и раз в 4 часа, если лаунчер живёт долго
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600e3);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  const cfg = loadConfig();
  if (cfg.discordRpc !== false) {
    rpc.init(DISCORD_RPC_APP_ID, logLine);
    rpc.setIdle(resolveAccount(cfg)?.name);
  }
});
app.on('will-quit', () => rpc.disable());
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Хелперы прогресса ────────────────────────────────────────────────
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function status(text) { send('status', text); }
function logLine(text) { send('log', text); }

// Хартбит на сайт: «играю за <ник>» при запуске игры. Сайт склеит это с входом
// на сервер (ловит вход через лаунчер любым способом). Fire-and-forget, 5с таймаут,
// ошибки молчим — метрика не должна мешать запуску игры.
function sendLauncherHeartbeat(nick) {
  if (!nick) return;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    fetch(SITE_URL + '/api/bridge/launcher/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick, version: app.getVersion() }),
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
ipcMain.handle('get-config', () => {
  const config = loadConfig();
  return { config, versionInfo: VERSION_INFO, account: resolveAccount(config) };
});
// Renderer шлёт только игровые настройки — мержим по белому списку, иначе
// каждое сохранение затирало бы аккаунт (accountType/offlineName/msAccount).
ipcMain.handle('save-config', (_e, patch) => {
  const cfg = loadConfig();
  const rpcWas = cfg.discordRpc !== false;
  for (const k of ['ram', 'loader', 'joinServer', 'gameDir', 'discordRpc']) {
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
ipcMain.on('window-close', () => app.quit());

ipcMain.handle('pick-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
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
ipcMain.handle('mods-search', async (_e, { query, type, loader }) => {
  try {
    return { ok: true, hits: await mods.searchContent(query, type, loader, MC_VERSION) };
  } catch (e) {
    return {
      ok: false,
      error: 'Поиск Modrinth сейчас недоступен (' + e.message + ') — попробуй ещё раз через минуту. Подборка ниже работает.',
      hits: [],
    };
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
    return await mods.installContent(currentGameDir(), project, type, loader, MC_VERSION, logLine);
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

let launching = false;

ipcMain.handle('launch-game', async (_e, opts) => {
  if (launching) return { ok: false, error: 'Уже идёт запуск' };
  const loader = opts.loader || 'fabric';
  const ram = Math.max(1024, Math.min(32768, parseInt(opts.ram, 10) || 4096));
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
      throw new Error('Не найден Java runtime (' + javaPath + '). Пересоберите лаунчер с JRE.');
    }
    ensureExecutable(javaPath);

    const dl = makeDownloadOptions();

    // 1) Ванильный клиент 1.21.11
    const list = await installer.getVersionList({ dispatcher: dl.dispatcher });
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

    // 3.5) Серверный ресурспак (петы) с автообновлением по sha1 — запасной
    // канал к раздаче пака сервером; сбои сети запуску не мешают
    status('Проверка ресурспака…');
    await respack.syncResourcePack(gameDir, logLine);

    // 4) Запуск
    status('Запуск игры…');
    sendLauncherHeartbeat(account.name); // метка «через лаунчер» для админки
    logLine('▶ Запуск версии ' + versionId + ' от имени ' + account.name
      + (account.userType === 'msa' ? ' (Microsoft)' : ' (по нику)'));
    const proc = await launch({
      gamePath: gameDir,
      javaPath,
      version: versionId,
      gameProfile: { name: account.name, id: account.uuid },
      accessToken: account.accessToken,
      userType: account.userType,
      minMemory: Math.min(1024, ram),
      maxMemory: ram,
      launcherName: 'MistMC',
      launcherBrand: 'MistMC',
      versionType: 'Mist MC',
      quickPlayMultiplayer: joinServer ? JOIN_HOST : undefined,
    });

    // Логи процесса (кратко)
    if (proc.stdout) proc.stdout.on('data', (d) => logLine(d.toString().trimEnd()));
    if (proc.stderr) proc.stderr.on('data', (d) => logLine(d.toString().trimEnd()));

    const watcher = createMinecraftProcessWatcher(proc);
    watcher.on('error', (err) => {
      logLine('✖ ' + (err && err.message ? err.message : String(err)));
      launching = false;
      send('state', { state: 'idle' });
      send('launch-error', String(err && err.message ? err.message : err));
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
      launching = false;
      logLine('■ Игра закрыта (код ' + code + ')');
      if (code !== 0 && crashReport) {
        logLine('Крэш-репорт: ' + crashReportLocation);
      }
      if (loadConfig().discordRpc !== false) {
        rpc.setIdle(account.name);
      }
      send('state', { state: 'idle' });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.restore();
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
