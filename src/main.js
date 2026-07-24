'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { launch, Version, MinecraftFolder, createMinecraftProcessWatcher } = require('@xmcl/core');
const installer = require('@xmcl/installer');
const { Agent, interceptors } = require('undici');

// Unpacked chrome-sandbox has no setuid bit, so the sandbox refuses to start.
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

const MC_VERSION = '1.21.11';
const FABRIC_LOADER = '0.19.3';
const FORGE_VERSION = '61.1.0';
const SERVER_HOST = 'mistmc.gg';
const SITE_URL = 'https://mistmc.gg';

const VERSION_INFO = { mc: MC_VERSION, fabric: FABRIC_LOADER, forge: FORGE_VERSION, server: SERVER_HOST };

// Mojang CDNs get throttled in some regions; bmclapi is a fallback tried after the official host.
const ASSETS_HOSTS = ['https://resources.download.minecraft.net', 'https://bmclapi2.bangbang93.com/assets'];
const MAVEN_HOSTS = ['https://libraries.minecraft.net', 'https://bmclapi2.bangbang93.com/maven'];

function makeDownloadOptions() {
  // Longer connect timeout + redirects. No undici retry interceptor: it does its own
  // range resume and clashes with xmcl (content-range mismatch); the mirror list covers failures.
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

// xmcl throws AggregateError with the real causes in .errors; flatten them into a readable string.
function describeError(err) {
  const seen = new Set();
  const msgs = [];
  (function walk(e) {
    if (!e) return;
    if (Array.isArray(e.errors)) e.errors.forEach(walk);
    if (e.cause) walk(e.cause);
    const m = (e.message || e.code || e.name || '').toString().trim();
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

function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
}
function javaExeName() {
  return process.platform === 'win32' ? 'javaw.exe' : 'java';
}
function bundledJavaPath() {
  // Packaged builds get resources/jre; dev keeps per-platform jre-win / jre-linux.
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
    } catch (_) { /* no dir */ }
  }
  return path.join(bases[0], 'bin', exe);
}
function ensureExecutable(javaPath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(javaPath, 0o755);
    const binDir = path.dirname(javaPath);
    for (const f of fs.readdirSync(binDir)) {
      try { fs.chmodSync(path.join(binDir, f), 0o755); } catch (_) { /* skip */ }
    }
  } catch (e) {
    logLine('не удалось выставить права на java: ' + e.message);
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

function loadConfig() {
  const defaults = {
    username: '',
    ram: 4096,
    loader: 'fabric',
    joinServer: true,
    gameDir: defaultGameDir(),
  };
  try {
    return Object.assign(defaults, JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch (_) {
    return defaults;
  }
}
function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  } catch (_) { /* ignore */ }
}

// Offline UUID matches the server's offline scheme: MD5 name-based UUID of "OfflinePlayer:<name>".
function offlineUUID(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 600,
    resizable: false,
    frame: false,
    backgroundColor: '#141414',
    title: 'Mist MC Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function status(text) { send('status', text); }
function logLine(text) { send('log', text); }

async function runTask(label, taskObj) {
  status(label);
  logLine(label);
  return taskObj.startAndWait({
    onUpdate() {
      const p = taskObj.progress || 0;
      const t = taskObj.total || 0;
      send('progress', { label, percent: t ? Math.min(100, Math.round((p / t) * 100)) : -1 });
    },
    onFailed(_t, err) {
      logLine('ошибка: ' + (err && err.message ? err.message : String(err)));
    },
  });
}

function copyFabricMods(gameDir) {
  const src = modsResourceDir();
  if (!fs.existsSync(src)) return;
  const dest = path.join(gameDir, 'mods');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    if (!file.toLowerCase().endsWith('.jar')) continue;
    try {
      fs.copyFileSync(path.join(src, file), path.join(dest, file));
      logLine('мод: ' + file);
    } catch (e) {
      logLine('не удалось скопировать ' + file + ': ' + e.message);
    }
  }
}

ipcMain.handle('get-config', () => ({ config: loadConfig(), versionInfo: VERSION_INFO }));
ipcMain.handle('save-config', (_e, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url || SITE_URL));
ipcMain.on('window-min', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-close', () => app.quit());

ipcMain.handle('pick-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

let launching = false;

ipcMain.handle('launch-game', async (_e, opts) => {
  if (launching) return { ok: false, error: 'Уже идёт запуск' };
  const username = (opts.username || '').trim();
  const loader = opts.loader || 'fabric';
  const ram = Math.max(1024, Math.min(32768, parseInt(opts.ram, 10) || 4096));
  const joinServer = !!opts.joinServer;
  const gameDir = opts.gameDir || defaultGameDir();

  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Ник: 3–16 символов, только латиница, цифры и _' };
  }

  launching = true;
  send('state', { state: 'working' });
  try {
    fs.mkdirSync(gameDir, { recursive: true });
    const mc = MinecraftFolder.from(gameDir);
    const javaPath = bundledJavaPath();
    if (!fs.existsSync(javaPath)) {
      throw new Error('Не найден Java runtime (' + javaPath + '). Пересоберите лаунчер с JRE.');
    }
    ensureExecutable(javaPath);

    const dl = makeDownloadOptions();

    const list = await installer.getVersionList({ dispatcher: dl.dispatcher });
    const meta = list.versions.find((v) => v.id === MC_VERSION);
    if (!meta) throw new Error('Версия ' + MC_VERSION + ' не найдена в манифесте Mojang');
    await runTask('Загрузка Minecraft ' + MC_VERSION, installer.installTask(meta, mc, dl));

    let versionId = MC_VERSION;
    if (loader === 'fabric') {
      status('Установка Fabric ' + FABRIC_LOADER);
      logLine('Установка Fabric ' + FABRIC_LOADER);
      versionId = await installer.installFabric({
        minecraftVersion: MC_VERSION,
        version: FABRIC_LOADER,
        minecraft: mc,
        dispatcher: dl.dispatcher,
      });
      const resolved = await Version.parse(gameDir, versionId);
      await runTask('Загрузка библиотек Fabric', installer.installDependenciesTask(resolved, dl));
      copyFabricMods(gameDir);
    } else if (loader === 'forge') {
      versionId = await runTask(
        'Установка Forge ' + FORGE_VERSION + ' (может занять пару минут)',
        installer.installForgeTask({ mcversion: MC_VERSION, version: FORGE_VERSION }, mc, { ...dl, java: javaPath })
      );
      const resolved = await Version.parse(gameDir, versionId);
      await runTask('Загрузка библиотек Forge', installer.installDependenciesTask(resolved, dl));
    }

    status('Запуск игры…');
    logLine('Запуск версии ' + versionId + ' от имени ' + username);
    const uuid = offlineUUID(username);
    const proc = await launch({
      gamePath: gameDir,
      javaPath,
      version: versionId,
      gameProfile: { name: username, id: uuid },
      accessToken: uuid,
      userType: 'legacy',
      minMemory: Math.min(1024, ram),
      maxMemory: ram,
      launcherName: 'MistMC',
      launcherBrand: 'MistMC',
      versionType: 'Mist MC',
      quickPlayMultiplayer: joinServer ? SERVER_HOST : undefined,
    });

    if (proc.stdout) proc.stdout.on('data', (d) => logLine(d.toString().trimEnd()));
    if (proc.stderr) proc.stderr.on('data', (d) => logLine(d.toString().trimEnd()));

    const watcher = createMinecraftProcessWatcher(proc);
    watcher.on('error', (err) => {
      logLine(err && err.message ? err.message : String(err));
      launching = false;
      send('state', { state: 'idle' });
      send('launch-error', String(err && err.message ? err.message : err));
    });
    watcher.on('minecraft-window-ready', () => {
      status('Игра запущена');
      send('state', { state: 'running' });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    });
    watcher.on('minecraft-exit', ({ code, crashReport, crashReportLocation }) => {
      launching = false;
      logLine('Игра закрыта (код ' + code + ')');
      if (code !== 0 && crashReport) logLine('Крэш-репорт: ' + crashReportLocation);
      send('state', { state: 'idle' });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.restore();
    });

    return { ok: true };
  } catch (err) {
    launching = false;
    send('state', { state: 'idle' });
    const msg = describeError(err);
    logLine('Ошибка:');
    msg.split('\n').forEach((l) => logLine('   ' + l));
    return { ok: false, error: msg.split('\n')[0] };
  }
});
