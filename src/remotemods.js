'use strict';
// Вшитые моды сборки без пересборки лаунчера. На сайте рядом с релизами лежит
// список mods/manifest.json: какие джарники входят в сборку (путь, sha256,
// размер) и какие из них необязательные. Лаунчер скачивает недостающие файлы в
// кэш userData/bundled-mods и берёт моды оттуда. Файл принимается, только если
// sha256 совпал со списком; список и файлы идут по HTTPS. Нет сети, сломанный
// список, недокачанный файл — остаётся прежний кэш или моды, вшитые в exe.
//
// Файлы на сайте лежат под именем <sha256>.jar и не перезаписываются, так что
// лаунчер, который в этот момент качает прошлый список, не получит чужой файл.
// В сборке из исходников адреса пустые — тогда работают только вшитые моды.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetch } = require('undici');
const { MAIN, MIRROR_DOWNLOADS } = require('./site');

const MANIFEST = 'manifest.json';
const LIST_TIMEOUT_MS = 8000;
const FILE_TIMEOUT_MS = 90_000;
// пауза между успешными проверками; для тестов — MISTMC_MODS_GAP_MS
const OK_GAP_MS = +process.env.MISTMC_MODS_GAP_MS || 2 * 60_000;
// путь джарника в сборке: корень или подпапка версии игры (26.1/…)
const SAFE_PATH = /^(?:\d+\.\d+(?:\.\d+)?\/)?[A-Za-z0-9][A-Za-z0-9._+-]*\.jar$/;

let cacheDir = null;
let builtinDir = null;
let appVersion = '';
let active = null;
let activeManifest = null;
let refreshing = null;
let lastOk = 0;
let lastFail = 0;

/** Откуда качать: сайт и зеркало релизов. Пусто — сборка из исходников. */
function bases() {
  if (!MIRROR_DOWNLOADS) return [];
  return [MAIN + '/downloads/mods/', MIRROR_DOWNLOADS.replace(/\/$/, '') + '/mods/'];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Список проверен: известный формат, безопасные пути, хэши и размеры. */
function validManifest(m) {
  if (!m || m.v !== 1 || !Array.isArray(m.files) || !m.files.length || m.files.length > 500) return false;
  const seen = new Set();
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || !SAFE_PATH.test(f.path) || seen.has(f.path)) return false;
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) return false;
    if (!Number.isInteger(f.size) || f.size <= 0 || f.size > 200 * 1024 * 1024) return false;
    seen.add(f.path);
  }
  if (m.optIn !== undefined && (!Array.isArray(m.optIn) || m.optIn.some((k) => typeof k !== 'string'))) return false;
  return true;
}

function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return null;
  }
}

/** Кэш целый: список на месте и все файлы с нужным размером. */
function cacheComplete(dir) {
  const m = readJson(path.join(dir, MANIFEST));
  if (!validManifest(m)) return null;
  for (const f of m.files) {
    try {
      if (fs.statSync(path.join(dir, f.path)).size !== f.size) return null;
    } catch (_) {
      return null;
    }
  }
  return m;
}

/**
 * Старт: брать кэш, если он целый и скачан этой версией лаунчера (после
 * обновления лаунчера без сети вшитые в новый exe моды свежее старого кэша).
 */
function init(userData, builtin, version) {
  cacheDir = path.join(userData, 'bundled-mods');
  builtinDir = builtin;
  appVersion = version || '';
  const m = cacheComplete(cacheDir);
  if (m && m.app === appVersion) {
    active = cacheDir;
    activeManifest = m;
  } else {
    active = builtinDir;
    activeManifest = null;
  }
}

/** Папка вшитых модов, с которой сейчас работает лаунчер. */
function dir() {
  return active || builtinDir;
}

/** Страницы своих модов для подборки (manifest.pages); null — список не скачан. */
function pages() {
  return activeManifest && Array.isArray(activeManifest.pages) ? activeManifest.pages : null;
}

/** Необязательные моды по списку с сайта; null — список не скачан (правило лаунчера). */
function optIn() {
  return activeManifest && Array.isArray(activeManifest.optIn) ? activeManifest.optIn : null;
}

async function fetchTimeout(url, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { signal: ac.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function loadList() {
  let lastErr = null;
  for (const base of bases()) {
    try {
      const res = await fetchTimeout(base + MANIFEST + '?t=' + Date.now(), LIST_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const m = JSON.parse(await res.text());
      if (!validManifest(m)) throw new Error('список модов не прошёл проверку');
      return { m, base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('адреса не заданы');
}

/** Уже есть у нас с тем же хэшем: в кэше или во вшитых. */
function localCopy(f) {
  for (const root of [cacheDir, builtinDir]) {
    if (!root) continue;
    const p = path.join(root, f.path);
    try {
      if (fs.statSync(p).size === f.size && sha256File(p) === f.sha256) return p;
    } catch (_) {
      // нет такого файла
    }
  }
  return null;
}

async function download(base, f, dest) {
  const bases0 = [base, ...bases().filter((b) => b !== base)];
  let lastErr = null;
  for (const b of bases0) {
    try {
      const res = await fetchTimeout(b + 'files/' + f.sha256 + '.jar', FILE_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== f.size) throw new Error('размер ' + buf.length + ' вместо ' + f.size);
      if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error('хэш не совпал');
      fs.writeFileSync(dest, buf);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {
    // нечего удалять
  }
}

async function doRefresh(log) {
  const { m, base } = await loadList();
  const same = activeManifest && active === cacheDir
    && JSON.stringify(activeManifest.files) === JSON.stringify(m.files)
    && JSON.stringify(activeManifest.optIn || []) === JSON.stringify(m.optIn || [])
    && JSON.stringify(activeManifest.pages || null) === JSON.stringify(m.pages || null);
  if (same) return false;
  const staging = cacheDir + '.new';
  rmrf(staging);
  fs.mkdirSync(staging, { recursive: true });
  let fetched = 0;
  try {
    for (const f of m.files) {
      const dest = path.join(staging, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const have = localCopy(f);
      if (have) {
        fs.copyFileSync(have, dest);
      } else {
        await download(base, f, dest);
        fetched++;
      }
    }
    const saved = { ...m, app: appVersion };
    fs.writeFileSync(path.join(staging, MANIFEST), JSON.stringify(saved, null, 1));
    const old = cacheDir + '.old';
    rmrf(old);
    if (fs.existsSync(cacheDir)) fs.renameSync(cacheDir, old);
    fs.renameSync(staging, cacheDir);
    rmrf(old);
    active = cacheDir;
    activeManifest = saved;
    if (log) log('моды сборки обновлены по списку с сайта: ' + m.files.length + ' файлов, скачано ' + fetched);
    return true;
  } catch (e) {
    rmrf(staging);
    throw e;
  }
}

/**
 * Сверить сборку со списком на сайте. true — набор модов поменялся. Ошибки не
 * пробрасываются: игра запускается с тем, что есть. Повторный вызов во время
 * проверки ждёт ту же проверку; успешная проверка не повторяется 2 минуты, неудачная — 30 секунд.
 */
function refresh(log) {
  if (!bases().length || !cacheDir) return Promise.resolve(false);
  if (refreshing) return refreshing;
  if (Date.now() - lastOk < OK_GAP_MS || Date.now() - lastFail < Math.min(30_000, OK_GAP_MS)) return Promise.resolve(false);
  refreshing = doRefresh(log)
    .then((changed) => {
      lastOk = Date.now();
      return changed;
    })
    .catch((e) => {
      lastFail = Date.now();
      if (log) log('список модов с сайта не обновился: ' + (e && e.message));
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

module.exports = { init, dir, optIn, pages, refresh, validManifest };
