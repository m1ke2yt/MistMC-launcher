'use strict';

// Версии Minecraft в лаунчере: какие предлагаем и что каждой нужно для запуска
// (Java, Forge, примет ли её сервер). От Electron модуль не зависит — пути,
// сеть и журнал получает через init, поэтому гоняется тестами в чистом node.

const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns');

// Версия сервера Mist MC: под неё вшитая сборка модов, она же выбрана по умолчанию
const SERVER_MC = '1.21.11';
// На случай, когда манифест Mojang недоступен и ещё ни разу не скачивался
const FALLBACK_VERSIONS = ['26.3', '26.2', '26.1.2', '26.1.1', '26.1', SERVER_MC];
// Forge, проверенный с лаунчером; для остальных версий берём рекомендованный
// (а пока его нет — свежий) из списка самого Forge
const FORGE_PINNED = { '1.21.11': '61.1.0' };
const FORGE_PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
// Вшитая в лаунчер Java. Версиям игры новее нужна своя — её качаем у Mojang
const BUNDLED_JAVA_MAJOR = 21;
const JAVA_INDEX_URLS = [
  'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
  'https://bmclapi2.bangbang93.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
];

const ctx = {
  dataDir: null,
  log: () => {},
  fetch: (...a) => fetch(...a),
};
function init(opts) { Object.assign(ctx, opts); }

function cachePath(name) { return path.join(ctx.dataDir, name); }
function readCache(name) {
  try { return JSON.parse(fs.readFileSync(cachePath(name), 'utf8')); } catch (_) { return null; }
}
function writeCache(name, data) {
  try { fs.writeFileSync(cachePath(name), JSON.stringify(data)); } catch (_) { /* кэш не обязателен */ }
}

/** JSON по первому ответившему адресу; все упали — бросаем последнюю ошибку. */
async function fetchJsonAny(urls, dispatcher, timeoutMs = 20000) {
  let last = null;
  for (const url of urls) {
    try {
      const res = await ctx.fetch(url, { dispatcher, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('нет адресов');
}

/** Зеркало bmclapi для хостов Mojang: тот же путь на другом хосте. */
function withMirror(url) {
  try {
    const u = new URL(url);
    if (/^(piston-meta|piston-data|launchermeta|launcher)\.mojang\.com$/.test(u.host)) {
      return [url, 'https://bmclapi2.bangbang93.com' + u.pathname];
    }
  } catch (_) { /* нестандартный URL — без зеркала */ }
  return [url];
}

// ── список версий ───────────────────────────────────────────────────────
function javaMajorGuess(mc) {
  return parseInt(String(mc).split('.')[0], 10) >= 26 ? 25 : BUNDLED_JAVA_MAJOR;
}

/** Ключ платформы в индексе Java-рантаймов Mojang (null — рантаймов нет). */
function runtimePlatform() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'x64' ? 'windows-x64' : arch === 'arm64' ? 'windows-arm64' : 'windows-x86';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  if (platform === 'linux') return arch === 'x64' ? 'linux' : arch === 'ia32' ? 'linux-i386' : null;
  return null;
}

/**
 * Запустится ли версия на этой машине. Java 25 для 32-битных систем Mojang не
 * выпускает, поэтому 26.x в 32-битной сборке лаунчера недоступны.
 */
function unsupportedReason(mc) {
  if (javaMajorGuess(mc) <= BUNDLED_JAVA_MAJOR) return '';
  const plat = runtimePlatform();
  if (!plat || plat === 'windows-x86' || plat === 'linux-i386') {
    return 'Minecraft ' + mc + ' работает только на 64-битной системе';
  }
  return '';
}

/** Релизы от версии сервера и новее, свежие сверху. */
function releasesFromManifest(list) {
  const versions = Array.isArray(list && list.versions) ? list.versions : [];
  const base = versions.find((v) => v.id === SERVER_MC);
  if (!base) return null;
  const from = Date.parse(base.releaseTime) || 0;
  const out = versions
    .filter((v) => v.type === 'release' && (Date.parse(v.releaseTime) || 0) >= from)
    .sort((a, b) => (Date.parse(b.releaseTime) || 0) - (Date.parse(a.releaseTime) || 0))
    .map((v) => v.id);
  return out.length ? out : null;
}

function describeVersions(ids, latest) {
  return ids.map((id) => {
    const reason = unsupportedReason(id);
    return {
      id,
      server: id === SERVER_MC,
      latest: id === latest,
      java: javaMajorGuess(id),
      supported: !reason,
      reason,
    };
  });
}

/**
 * Версии для выбора в окне. manifest — свежий манифест Mojang, если есть;
 * иначе берём сохранённый с прошлого раза, а на самом первом запуске без
 * сети — вшитый список.
 */
function gameVersions(manifest) {
  const list = manifest || readCache('version_manifest.json');
  const ids = releasesFromManifest(list) || FALLBACK_VERSIONS;
  const latest = (list && list.latest && list.latest.release) || ids[0];
  return describeVersions(ids, latest);
}

function isKnown(mc, manifest) {
  return gameVersions(manifest).some((v) => v.id === mc);
}

// ── Forge ───────────────────────────────────────────────────────────────
function forgeFromPromos(promos, mc) {
  const p = (promos && promos.promos) || {};
  return FORGE_PINNED[mc] || p[mc + '-recommended'] || p[mc + '-latest'] || null;
}
/** Версия Forge под игру без сети: по сохранённому списку (null — не знаем). */
function forgeVersionCached(mc) {
  return forgeFromPromos(readCache('forge-promos.json'), mc);
}
/** То же со свежим списком Forge; сеть упала — по сохранённому. */
async function forgeVersion(mc, dispatcher) {
  if (FORGE_PINNED[mc]) return FORGE_PINNED[mc];
  try {
    const promos = await fetchJsonAny([FORGE_PROMOS_URL], dispatcher, 15000);
    if (promos && promos.promos) writeCache('forge-promos.json', promos);
    return forgeFromPromos(promos, mc);
  } catch (e) {
    ctx.log('ⓘ Список версий Forge недоступен (' + (e && e.message) + ') — беру сохранённый');
    return forgeVersionCached(mc);
  }
}

// ── Java ────────────────────────────────────────────────────────────────
function javaExeName() { return process.platform === 'win32' ? 'javaw.exe' : 'java'; }
function runtimeDir(component) { return path.join(ctx.dataDir, 'runtime', component); }
function runtimeMarker(component) { return path.join(runtimeDir(component), '.mist-ok'); }

/** Путь к уже скачанной Java нужного компонента (null — ещё не ставилась). */
function installedRuntime(component) {
  const exe = path.join(runtimeDir(component), 'bin', javaExeName());
  return fs.existsSync(runtimeMarker(component)) && fs.existsSync(exe) ? exe : null;
}

/**
 * Java для версии игры. Вшитой хватает до Java 21 включительно; версиям новее
 * (26.x — Java 25) рантайм скачивается у Mojang в папку настроек лаунчера —
 * один раз, дальше берётся готовый.
 *   versionJson — version.json игры (поле javaVersion);
 *   bundledJava — путь к вшитой Java;
 *   installer / dl / runTask — @xmcl/installer, его опции загрузки и обёртка
 *   прогресса из main.js.
 * Возвращает { javaPath, major }.
 */
async function ensureJava({ versionJson, bundledJava, installer, dl, runTask }) {
  const jv = (versionJson && versionJson.javaVersion) || {};
  const major = Number(jv.majorVersion) || BUNDLED_JAVA_MAJOR;
  if (major <= BUNDLED_JAVA_MAJOR) return { javaPath: bundledJava, major: BUNDLED_JAVA_MAJOR };

  const component = String(jv.component || 'java-runtime-epsilon');
  const ready = installedRuntime(component);
  if (ready) return { javaPath: ready, major };

  const plat = runtimePlatform();
  let index;
  try {
    index = await fetchJsonAny(JAVA_INDEX_URLS, dl.dispatcher);
    writeCache('java-runtime-index.json', index);
  } catch (e) {
    index = readCache('java-runtime-index.json');
    if (!index) throw new Error('Не удалось получить список Java у Mojang: ' + ((e && e.message) || e));
  }
  const target = plat && index[plat] && index[plat][component] && index[plat][component][0];
  if (!target) {
    throw new Error('Для этой системы нет Java ' + major + ' — Minecraft ' + ((versionJson && versionJson.id) || '')
      + ' на ней не запустится. Выберите версию 1.21.11.');
  }
  const manifest = await fetchJsonAny(withMirror(target.manifest.url), dl.dispatcher);
  if (!manifest || !manifest.files) throw new Error('Mojang отдал пустой список файлов Java');

  const dest = runtimeDir(component);
  fs.mkdirSync(dest, { recursive: true });
  try { fs.unlinkSync(runtimeMarker(component)); } catch (_) { /* маркера ещё нет */ }
  await runTask('Загрузка Java ' + major + ' (нужна один раз)', installer.installJavaRuntimeTask({
    destination: dest,
    manifest: { files: manifest.files, target: component, version: target.version },
    // файлы лежат на piston-data; запасным — зеркало с тем же путём
    apiHost: ['piston-data.mojang.com', 'bmclapi2.bangbang93.com'],
    dispatcher: dl.dispatcher,
  }));
  if (process.platform !== 'win32') {
    // xmcl кладёт файлы без прав на запуск — выставляем по описи Mojang
    for (const [file, entry] of Object.entries(manifest.files)) {
      if (entry && entry.type === 'file' && entry.executable) {
        try { fs.chmodSync(path.join(dest, file), 0o755); } catch (_) { /* пропускаем */ }
      }
    }
  }
  const exe = path.join(dest, 'bin', javaExeName());
  if (!fs.existsSync(exe)) throw new Error('Java ' + major + ' скачалась не полностью — запустите ещё раз');
  fs.writeFileSync(runtimeMarker(component), String((target.version && target.version.name) || major));
  return { javaPath: exe, major };
}

// ── примет ли сервер эту версию ─────────────────────────────────────────
function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}
function readVarint(buf, pos) {
  let val = 0;
  let shift = 0;
  for (let i = pos; i < buf.length && shift < 35; i++) {
    val |= (buf[i] & 0x7f) << shift;
    if (!(buf[i] & 0x80)) return { val: val >>> 0, next: i + 1 };
    shift += 7;
  }
  return null;
}

/**
 * Статус-пинг сервера от имени клиента с протоколом `protocol`. Сервер с
 * ViaVersion отвечает тем же номером, если версию принимает, и своим родным,
 * если нет. Возвращает { protocol, name } либо null (не ответил за timeoutMs).
 * connectTo — адрес для соединения, если он отличается от имени в рукопожатии.
 */
function pingServer(host, port, protocol, timeoutMs = 5000, connectTo = host) {
  return new Promise((resolve) => {
    let done = false;
    let chunks = Buffer.alloc(0);
    const sock = new net.Socket();
    const finish = (v) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => finish(null));
    sock.on('error', () => finish(null));
    sock.on('close', () => finish(null)); // сервер закрыл соединение, не ответив
    sock.on('data', (d) => {
      chunks = Buffer.concat([chunks, d]);
      const len = readVarint(chunks, 0);
      if (!len || chunks.length < len.next + len.val) return;
      const id = readVarint(chunks, len.next);
      const strLen = id && readVarint(chunks, id.next);
      if (!strLen) return finish(null);
      try {
        const j = JSON.parse(chunks.toString('utf8', strLen.next, strLen.next + strLen.val));
        finish({ protocol: j.version && j.version.protocol, name: (j.version && j.version.name) || '' });
      } catch (_) { finish(null); }
    });
    sock.connect(port, connectTo, () => {
      const h = Buffer.from(host, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      const handshake = Buffer.concat([varint(0), varint(protocol), varint(h.length), h, portBuf, varint(1)]);
      sock.write(Buffer.concat([varint(handshake.length), handshake, varint(1), varint(0)]));
    });
  });
}

/** Номер сетевого протокола версии — из version.json внутри client.jar. */
function protocolOf(clientJarVersionJson) {
  try {
    const j = JSON.parse(clientJarVersionJson.toString('utf8'));
    return Number(j.protocol_version) || null;
  } catch (_) { return null; }
}

/**
 * Пускает ли сервер клиента этой версии: true / false, null — узнать не вышло
 * (сервер не ответил) — тогда не мешаем и подключаемся как обычно.
 */
async function serverAccepts(hostPort, protocol) {
  if (!protocol) return null;
  const [host, portStr] = String(hostPort).split(':');
  const port = parseInt(portStr, 10) || 25565;
  // две попытки: первая нередко упирается в медленный DNS или троттлинг пингов
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500));
    let addr = host;
    try { addr = (await dns.promises.lookup(host)).address; } catch (_) { /* пробуем по имени */ }
    // в рукопожатии — имя хоста (по нему прокси находит сервер), соединяемся по адресу
    const res = await pingServer(host, port, protocol, 4000, addr);
    if (res && typeof res.protocol === 'number') return res.protocol === protocol;
  }
  return null;
}

module.exports = {
  SERVER_MC,
  BUNDLED_JAVA_MAJOR,
  init,
  gameVersions,
  isKnown,
  javaMajorGuess,
  unsupportedReason,
  forgeVersion,
  forgeVersionCached,
  ensureJava,
  installedRuntime,
  protocolOf,
  serverAccepts,
  pingServer,
  withMirror,
  // чистые функции — наружу для тестов
  releasesFromManifest,
  forgeFromPromos,
};
