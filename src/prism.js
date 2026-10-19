'use strict';

// Перенос сборок из Prism Launcher (и MultiMC — формат тот же): находим
// установку, читаем инстансы (instance.cfg + mmc-pack.json), копируем папку
// игры каждого в новую сборку нашего лаунчера. Prism после переноса работает
// как раньше — мы только читаем его файлы.
//
// Моды копируются как есть (checkMod в copyInstance позволяет отсеять
// часть — сейчас не используется).
// Аккаунты: переносим только ники офлайн-аккаунтов; токены Microsoft чужого
// лаунчера не трогаем — с ними вход заново.
// От Electron модуль не зависит — гоняется тестами в чистом node.

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── где искать ──────────────────────────────────────────────────────────
function candidateRoots() {
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const out = [];
  if (process.platform === 'win32') {
    out.push([path.join(appdata, 'PrismLauncher'), 'Prism Launcher']);
    out.push([path.join(home, 'scoop', 'persist', 'prismlauncher'), 'Prism Launcher (Scoop)']);
    out.push([path.join(appdata, 'PolyMC'), 'PolyMC']);
    out.push([path.join(appdata, 'MultiMC'), 'MultiMC']);
    out.push([path.join(home, 'MultiMC'), 'MultiMC']);
  } else if (process.platform === 'darwin') {
    out.push([path.join(home, 'Library', 'Application Support', 'PrismLauncher'), 'Prism Launcher']);
  } else {
    out.push([path.join(home, '.local', 'share', 'PrismLauncher'), 'Prism Launcher']);
    out.push([path.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'), 'Prism Launcher (Flatpak)']);
    out.push([path.join(home, '.local', 'share', 'multimc'), 'MultiMC']);
  }
  return out;
}

// ── разбор файлов Prism ─────────────────────────────────────────────────
/** INI Prism/MultiMC (QSettings): key=value, секции игнорируем. */
function parseIni(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*([^=#;[\s][^=]*?)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    out[m[1]] = v;
  }
  return out;
}
function readIni(file) {
  try { return parseIni(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; }
}

/** Похоже ли на установку Prism/MultiMC: есть конфиг лаунчера или папка инстансов. */
function isRoot(dir) {
  try {
    return ['prismlauncher.cfg', 'polymc.cfg', 'multimc.cfg'].some((f) => fs.existsSync(path.join(dir, f)))
      || fs.existsSync(path.join(dir, 'instances'));
  } catch (_) { return false; }
}

function rootConfig(root) {
  return readIni(path.join(root, 'prismlauncher.cfg'))
    || readIni(path.join(root, 'polymc.cfg'))
    || readIni(path.join(root, 'multimc.cfg')) || {};
}

function instancesDir(root, cfg) {
  const d = cfg.InstanceDir || 'instances';
  return path.isAbsolute(d) ? d : path.join(root, d);
}

/** Загрузчик и версии из mmc-pack.json. */
function parsePack(pack) {
  const comps = Array.isArray(pack && pack.components) ? pack.components : [];
  const ver = (uid) => {
    const c = comps.find((x) => x && x.uid === uid);
    return c ? String(c.version || c.cachedVersion || '') : null;
  };
  const mc = ver('net.minecraft');
  let loader = 'vanilla';
  let loaderVersion = null;
  for (const [uid, name] of [
    ['net.fabricmc.fabric-loader', 'fabric'],
    ['org.quiltmc.quilt-loader', 'quilt'],
    ['net.neoforged', 'neoforge'],
    ['net.minecraftforge', 'forge'],
  ]) {
    const v = ver(uid);
    if (v !== null) { loader = name; loaderVersion = v || null; break; }
  }
  // OptiFine/LiteLoader и прочее, что мы не ставим, — для честного предупреждения
  const extras = comps.map((c) => c && c.uid).filter((u) => u && /optifine|liteloader/i.test(u));
  return { mc, loader, loaderVersion, extras };
}

/** Папка игры инстанса: у новых Prism — minecraft, у старых и MultiMC — .minecraft. */
function gameDirOf(instDir) {
  const cands = ['minecraft', '.minecraft'].map((n) => path.join(instDir, n)).filter((d) => fs.existsSync(d));
  if (cands.length <= 1) return cands[0] || null;
  // обе есть — берём ту, где больше всего лежит
  const size = (d) => { try { return fs.readdirSync(d).length; } catch (_) { return 0; } };
  return cands.sort((a, b) => size(b) - size(a))[0];
}

function countFiles(dir, re) {
  try { return fs.readdirSync(dir).filter((n) => re.test(n)).length; } catch (_) { return 0; }
}

// Встроенные значки Prism → наши; свои картинки (icons/<ключ>.png) копируем
const ICON_MAP = {
  grass: 'grass', default: 'grass', dirt: 'grass', planks: 'chest', brick: 'chest',
  diamond: 'diamond', gold: 'diamond', iron: 'pickaxe', coal: 'pickaxe', stone: 'pickaxe',
  creeper: 'creeper', skeleton: 'sword', squarecreeper: 'creeper', enderpearl: 'enderpearl',
  enderman: 'enderpearl', flame: 'flame', herobrine: 'flame', netherstar: 'star', chicken: 'star',
  steve: 'sword', meat: 'star', bee: 'star', tnt: 'flame', gear: 'book', ftb_logo: 'book',
};
function iconOf(root, key) {
  const k = String(key || '').trim();
  for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp']) {
    const f = path.join(root, 'icons', k + ext);
    if (k && fs.existsSync(f)) return { icon: null, iconFile: f };
  }
  const base = k.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.\w+$/, '');
  return { icon: ICON_MAP[base] || 'grass', iconFile: null };
}

function groupsOf(root, instDir) {
  const j = readJson(path.join(instDir, 'instgroups.json')) || readJson(path.join(root, 'instgroups.json'));
  const map = new Map();
  const groups = (j && j.groups) || {};
  for (const [name, g] of Object.entries(groups)) {
    for (const id of (g && Array.isArray(g.instances) ? g.instances : [])) map.set(id, name);
  }
  return map;
}

/** Инстансы одной установки Prism. */
function readInstances(root) {
  const cfg = rootConfig(root);
  const dir = instancesDir(root, cfg);
  const groups = groupsOf(root, dir);
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return out; }
  for (const folder of names) {
    const instDir = path.join(dir, folder);
    const ic = readIni(path.join(instDir, 'instance.cfg'));
    if (!ic) continue;
    const pack = parsePack(readJson(path.join(instDir, 'mmc-pack.json')));
    if (!pack.mc) continue;
    const game = gameDirOf(instDir);
    const ramOverride = String(ic.OverrideMemory).toLowerCase() === 'true';
    const ram = parseInt(ramOverride ? ic.MaxMemAlloc : cfg.MaxMemAlloc, 10) || null;
    const joinAddr = String(ic.JoinServerOnLaunchAddress || '');
    out.push({
      id: folder,
      dir: instDir,
      gameDir: game,
      name: ic.name || folder,
      mc: pack.mc,
      loader: pack.loader,
      loaderVersion: pack.loaderVersion,
      extras: pack.extras,
      ram,
      group: groups.get(folder) || null,
      ...iconOf(root, ic.iconKey),
      lastPlayed: parseInt(ic.lastLaunchTime, 10) || null,
      playTimeMs: (parseInt(ic.totalTimePlayed, 10) || 0) * 1000,
      joinMist: String(ic.JoinServerOnLaunch).toLowerCase() === 'true' && /mistmc/i.test(joinAddr),
      stats: game ? {
        mods: countFiles(path.join(game, 'mods'), /\.jar(\.disabled)?$/i),
        saves: countFiles(path.join(game, 'saves'), /^[^.]/),
        resourcepacks: countFiles(path.join(game, 'resourcepacks'), /^[^.]/),
        shaderpacks: countFiles(path.join(game, 'shaderpacks'), /\.zip$/i),
        screenshots: countFiles(path.join(game, 'screenshots'), /\.png$/i),
      } : null,
    });
  }
  out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));
  return out;
}

/** Офлайн-ники из accounts.json (без токенов; Microsoft — только имя для подсказки). */
function readAccounts(root) {
  const j = readJson(path.join(root, 'accounts.json'));
  const list = Array.isArray(j && j.accounts) ? j.accounts : [];
  const out = [];
  for (const a of list) {
    const name = a && a.profile && a.profile.name;
    if (typeof name !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(name)) continue;
    const type = String(a.type || '').toLowerCase() === 'offline' ? 'offline' : 'msa';
    if (!out.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.type === type)) out.push({ name, type });
  }
  return out;
}

function describeRoot(root, label) {
  const cfg = rootConfig(root);
  return {
    root,
    label,
    instances: readInstances(root),
    accounts: readAccounts(root),
    defaultRam: parseInt(cfg.MaxMemAlloc, 10) || null,
  };
}

/** Все найденные установки Prism/MultiMC (+ extra — выбранная руками папка). */
function scan(extra) {
  const seen = new Set();
  const out = [];
  const roots = candidateRoots();
  if (extra) roots.unshift([extra, 'Папка: ' + extra]);
  for (const [root, label] of roots) {
    let key;
    try { key = fs.realpathSync(root).toLowerCase(); } catch (_) { continue; }
    if (seen.has(key) || !isRoot(root)) continue;
    seen.add(key);
    const d = describeRoot(root, label);
    if (d.instances.length || d.accounts.length) out.push(d);
  }
  return out;
}

// ── копирование ─────────────────────────────────────────────────────────
// Верхний уровень папки игры, который не переносим: журналы, кэши, распакованные
// нативки. versions/libraries/assets у Prism общие и в инстансе не лежат, но
// если вдруг есть — у нас они свои, общие для всех сборок.
const SKIP_TOP = new Set(['logs', 'crash-reports', '.cache', 'natives', 'debug', '.fabric', '.quilt',
  'versions', 'libraries', 'assets', 'launcher-mods.json', 'usercache.json', 'command_history.txt']);
const SKIP_IN_MODS = new Set(['.index', '.connector']);

/** Опись файлов для копирования: [{ src, rel, size }] и отдельно — моды. */
function listFiles(gameDir) {
  const files = [];
  const modFiles = [];
  const walk = (dir, rel, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      const full = path.join(dir, e.name);
      if (depth === 0 && SKIP_TOP.has(e.name)) continue;
      if (depth === 0 && /\.log(\.gz)?$/i.test(e.name)) continue;
      if (rel === 'mods' && SKIP_IN_MODS.has(e.name)) continue;
      if (e.isDirectory()) { walk(full, r, depth + 1); continue; }
      if (!e.isFile()) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch (_) { continue; }
      const item = { src: full, rel: r, size };
      if (rel === 'mods' && /\.jar(\.disabled)?$/i.test(e.name)) modFiles.push(item);
      else files.push(item);
    }
  };
  walk(gameDir, '', 0);
  return { files, modFiles };
}

async function copyOne(src, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(src, dest);
}

/**
 * Скопировать один инстанс в папку новой сборки.
 *   inst      — запись из readInstances;
 *   destDir   — папка сборки (уже создана);
 *   checkMod  — (file) => null | 'название' — запрещён ли мод (mods.blockedJar);
 *   onProgress({ done, total, file }) — байты.
 * Возвращает { copied, mods, blocked: [названия], failed: [файлы] }.
 */
async function copyInstance(inst, destDir, { checkMod, onProgress } = {}) {
  const res = { copied: 0, mods: 0, blocked: [], failed: [] };
  if (!inst.gameDir) return res;
  const { files, modFiles } = listFiles(inst.gameDir);
  const allowedMods = [];
  for (const m of modFiles) {
    const why = checkMod ? checkMod(m.src) : null;
    if (why) res.blocked.push(why);
    else allowedMods.push(m);
  }
  const todo = [...allowedMods, ...files];
  const total = todo.reduce((a, f) => a + f.size, 0);
  let done = 0;
  let lastTick = 0;
  for (const f of todo) {
    try {
      await copyOne(f.src, path.join(destDir, ...f.rel.split('/')));
      res.copied++;
      if (allowedMods.includes(f)) res.mods++;
    } catch (e) {
      res.failed.push(f.rel);
    }
    done += f.size;
    const now = Date.now();
    if (onProgress && (now - lastTick > 150 || done === total)) {
      lastTick = now;
      onProgress({ done, total, file: f.rel });
    }
  }
  return res;
}

module.exports = {
  scan, describeRoot, readInstances, readAccounts, isRoot, copyInstance, listFiles,
  // чистые функции — для тестов
  parseIni, parsePack, iconOf,
};
