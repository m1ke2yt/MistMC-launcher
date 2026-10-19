'use strict';

// Сборки (как инстансы в Prism): у каждой своя папка игры, версия, загрузчик,
// память и моды. Главная сборка «Mist MC» — это поля верхнего уровня конфига
// (gameDir/mcVersion/loader/ram/joinServer), как и до появления сборок, так что
// старый конфиг работает без миграции. Остальные лежат в cfg.profiles.
//
// Выбранная сборка у каждого окна лаунчера своя (как и аккаунт): main.js держит
// её id в памяти и накладывает поля сборки на конфиг при чтении (overlay), а
// при записи раскладывает обратно (strip). Поэтому весь остальной код — запуск,
// моды, ресурспак — работает с cfg.gameDir/cfg.mcVersion, не зная о сборках.
// От Electron модуль не зависит — гоняется тестами в чистом node.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAIN_ID = 'mistmc';
const FIELDS = ['gameDir', 'mcVersion', 'loader', 'ram', 'joinServer'];
const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'];
// значки сборок: ключи совпадают с картинками в renderer/icons/
const ICONS = ['grass', 'diamond', 'pickaxe', 'sword', 'creeper', 'enderpearl', 'book', 'flame', 'chest', 'star'];

function listOf(cfg) {
  return Array.isArray(cfg && cfg.profiles) ? cfg.profiles.filter((p) => p && p.id && p.id !== MAIN_ID) : [];
}

function find(cfg, id) {
  return listOf(cfg).find((p) => p.id === id) || null;
}

/**
 * Наложить выбранную сборку на конфиг. Для главной — только метки. Поля главной
 * сохраняются в cfg.mainFields, общая папка библиотек/ассетов — cfg.resourceDir.
 */
function overlay(cfg, id) {
  const main = {};
  for (const k of FIELDS) main[k] = cfg[k];
  cfg.resourceDir = cfg.gameDir;
  const p = id && id !== MAIN_ID ? find(cfg, id) : null;
  if (!p) {
    cfg.profileId = MAIN_ID;
    return cfg;
  }
  cfg.mainFields = main;
  cfg.profileId = p.id;
  cfg.gameDir = p.dir;
  cfg.mcVersion = p.mcVersion;
  cfg.loader = LOADERS.includes(p.loader) ? p.loader : 'vanilla';
  cfg.ram = p.ram || main.ram;
  cfg.joinServer = !!p.joinServer;
  return cfg;
}

/** Обратная раскладка перед записью: правки полей уходят в сборку, главная — как была. */
function strip(cfg) {
  const out = Object.assign({}, cfg);
  delete out.resourceDir;
  delete out.profileId;
  delete out.mainFields;
  if (!cfg.mainFields || !cfg.profileId || cfg.profileId === MAIN_ID) return out;
  for (const k of FIELDS) out[k] = cfg.mainFields[k];
  out.profiles = listOf(cfg).map((p) => {
    if (p.id !== cfg.profileId) return p;
    // папку сборки «Обзором» не меняем — она её собственная
    return Object.assign({}, p, {
      mcVersion: cfg.mcVersion,
      loader: cfg.loader,
      ram: cfg.ram,
      joinServer: !!cfg.joinServer,
    });
  });
  return out;
}

/** Имя папки из названия: латиница/кириллица/цифры, без запрещённых в Windows символов. */
function folderName(name) {
  const s = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '').slice(0, 48);
  return s && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? s : 'Сборка';
}

function uniqueDir(root, name) {
  const base = folderName(name);
  let dir = path.join(root, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, base + ' (' + i + ')');
  return dir;
}

function uniqueName(cfg, name) {
  const taken = new Set(['mist mc', ...listOf(cfg).map((p) => String(p.name).toLowerCase())]);
  const base = String(name || 'Сборка').trim().slice(0, 40) || 'Сборка';
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const n = base + ' (' + i + ')';
    if (!taken.has(n.toLowerCase())) return n;
  }
}

/**
 * Новая сборка (без записи конфига). root — папка, где живут папки сборок.
 * opts: name, mcVersion, loader, loaderVersion, ram, icon, iconFile, group, joinServer,
 * mistMods, source, playTime, lastPlayed, dir (готовая папка — при переносе на месте).
 */
function create(cfg, root, opts) {
  const name = uniqueName(cfg, opts.name);
  const p = {
    id: 'p' + crypto.randomBytes(5).toString('hex'),
    name,
    icon: ICONS.includes(opts.icon) ? opts.icon : ICONS[listOf(cfg).length % ICONS.length],
    iconFile: opts.iconFile || undefined,
    group: opts.group ? String(opts.group).slice(0, 40) : undefined,
    dir: opts.dir || uniqueDir(root, name),
    mcVersion: String(opts.mcVersion),
    loader: LOADERS.includes(opts.loader) ? opts.loader : 'vanilla',
    loaderVersion: opts.loaderVersion || undefined,
    ram: Number(opts.ram) || Number(cfg.ram) || 4096,
    joinServer: !!opts.joinServer,
    // моды Mist MC (плащи, друзья, модели) — только Fabric; выключаются в настройках сборки
    mistMods: opts.mistMods !== false,
    source: opts.source || undefined,
    createdAt: Date.now(),
    lastPlayed: opts.lastPlayed || undefined,
    playTime: opts.playTime || 0,
  };
  fs.mkdirSync(p.dir, { recursive: true });
  cfg.profiles = [...listOf(cfg), p];
  return p;
}

/** Правка сборки по белому списку полей. Возвращает обновлённую или null. */
function update(cfg, id, patch) {
  const p = find(cfg, id);
  if (!p || !patch) return null;
  if (typeof patch.name === 'string' && patch.name.trim() && patch.name.trim() !== p.name) {
    p.name = uniqueName(cfg, patch.name.trim());
  }
  if (ICONS.includes(patch.icon)) { p.icon = patch.icon; delete p.iconFile; }
  if ('group' in patch) p.group = patch.group ? String(patch.group).slice(0, 40) : undefined;
  if (typeof patch.mcVersion === 'string' && patch.mcVersion) p.mcVersion = patch.mcVersion;
  if (LOADERS.includes(patch.loader)) {
    if (patch.loader !== p.loader) delete p.loaderVersion;
    p.loader = patch.loader;
  }
  if ('loaderVersion' in patch) p.loaderVersion = patch.loaderVersion || undefined;
  if (patch.ram) {
    const total = Math.max(2048, Math.floor(os.totalmem() / 1048576));
    p.ram = Math.max(1024, Math.min(total, Math.round(Number(patch.ram)) || p.ram));
  }
  if ('joinServer' in patch) p.joinServer = !!patch.joinServer;
  if ('mistMods' in patch) p.mistMods = !!patch.mistMods;
  return p;
}

function remove(cfg, id) {
  const before = listOf(cfg).length;
  cfg.profiles = listOf(cfg).filter((p) => p.id !== id);
  return cfg.profiles.length !== before;
}

/** Учёт игрового времени (как в Prism): сколько всего и когда последний раз. */
function addPlayTime(cfg, id, ms) {
  const p = find(cfg, id);
  if (!p) {
    cfg.mainPlayTime = (Number(cfg.mainPlayTime) || 0) + Math.max(0, ms);
    cfg.mainLastPlayed = Date.now();
    return;
  }
  p.playTime = (Number(p.playTime) || 0) + Math.max(0, ms);
  p.lastPlayed = Date.now();
}

module.exports = {
  MAIN_ID, LOADERS, ICONS,
  listOf, find, overlay, strip, create, update, remove, addPlayTime,
  folderName, uniqueDir,
};
