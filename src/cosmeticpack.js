'use strict';

// Локальный косметик-пак игрока.
//
// ЗАЧЕМ ОН СОБИРАЕТСЯ ЗДЕСЬ, А НЕ РАЗДАЁТСЯ СЕРВЕРОМ. Плащи и флаги игроки
// рисуют сами, и у каждого автора своя текстура. Общий серверный пак пришлось
// бы пересобирать и рассылать целиком после каждой одобренной картинки —
// вместо этого лаунчер держит пак-папку у игрока и досыпает в неё только
// изменившееся. Новый плащ виден сразу после модерации, качается при этом
// пара килобайт.
//
// Устройство: базовая часть (модели и текстуры HMCCosmetics плюс наши модели
// плаща и флага) приезжает архивом с сайта и распаковывается один раз; поверх
// кладутся текстуры нарисованных вещей, по одной модели на каждую, и в
// assets/minecraft/items/paper.json дописываются их номера.
//
// Ошибки МОЛЧАЛИВЫЕ: без косметики играется, а вот не запуститься из-за неё —
// недопустимо.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PACK_DIR = 'MistMC-Cosmetics';               // папка в resourcepacks
const OPTIONS_ENTRY = 'file/MistMC-Cosmetics';     // запись в options.txt
const STATE_FILE = '.mistmc-pack.json';            // что уже собрано (внутри папки пака)

async function fetchWithTimeout(url, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// ── распаковка базового архива ─────────────────────────────────────────────
// Тот же приём, что в mods.js: идём по центральной директории zip. Библиотека
// ради одного архива не нужна, а лишняя зависимость в лаунчере — лишний риск.
function unzipTo(buf, destDir) {
  let eocd = -1;
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('битый архив пака');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('битая директория архива');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // архив свой, но распаковываем как чужой: путь наружу папки = мимо
    const safe = path.normalize(name).replace(/^([/\\]|\.\.[/\\])+/, '');
    if (!safe || safe.includes('..')) continue;
    const dest = path.join(destDir, safe);
    if (!dest.startsWith(destDir + path.sep)) continue;
    if (name.endsWith('/')) { fs.mkdirSync(dest, { recursive: true }); continue; }

    if (buf.readUInt32LE(lho) !== 0x04034b50) continue;
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    const out = method === 8 ? zlib.inflateRawSync(data) : method === 0 ? Buffer.from(data) : null;
    if (!out) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
  }
}

function readState(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8'));
  } catch (e) {
    return { baseSha1: null, drawings: {} };
  }
}

function writeState(dir, state) {
  try {
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state));
  } catch (e) { /* не критично: в следующий раз просто пересоберём */ }
}

/** Базовая часть пака: качаем архив, если он обновился, и распаковываем начисто. */
async function ensureBase(dir, urls, state, logLine) {
  let want = null;
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url + '.sha1', 7000);
      const text = (await res.text()).trim().toLowerCase();
      if (/^[0-9a-f]{40}$/.test(text)) { want = text; break; }
    } catch (e) { /* следующий хост */ }
  }
  if (!want) return state.baseSha1 ? true : false; // хосты недоступны: старый пак сойдёт
  if (state.baseSha1 === want && fs.existsSync(path.join(dir, 'pack.mcmeta'))) return true;

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 60000);
      const buf = Buffer.from(await res.arrayBuffer());
      if (sha1(buf) !== want) { logLine('Косметика: sha1 не совпал с ' + url); continue; }
      // распаковываем в чистую папку: старые модели из прошлой версии пака
      // не должны пережить обновление
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      unzipTo(buf, dir);
      state.baseSha1 = want;
      state.drawings = {}; // текстуры плащей лежали внутри — досыплем заново
      logLine('Косметика: базовый пак обновлён (' + want.slice(0, 8) + ')');
      return true;
    } catch (e) {
      logLine('Косметика: ' + url + ' недоступен (' + (e && e.message ? e.message : e) + ')');
    }
  }
  return !!state.baseSha1;
}

/** Модель нарисованной вещи — копия шаблона с подменённой текстурой. */
function drawingModel(dir, kind, name) {
  const template = path.join(dir, 'assets/mistmc/models/item', kind + '_template.json');
  const model = JSON.parse(fs.readFileSync(template, 'utf8'));
  const texture = 'mistmc:item/' + name;
  model.textures = { 0: texture, particle: texture };
  return model;
}

// Наши записи в предмете-носителе — только пул с номерами (cape_7, flag_3).
// Шаблоны cape_template/flag_template под это НЕ подпадают: их кладёт базовый
// пак, и подчищать их нельзя.
const POOL_MODEL = /^mistmc:item\/(?:cape|flag)_\d+$/;

/** Прописать номера моделей нарисованных вещей в предмет-носитель. */
function patchItems(dir, entries) {
  const modern = path.join(dir, 'assets/minecraft/items/paper.json');
  const legacy = path.join(dir, '1_21_3/minecraft/models/item/paper.json');

  if (fs.existsSync(modern)) {
    const j = JSON.parse(fs.readFileSync(modern, 'utf8'));
    // выкидываем прошлые записи пула и кладём актуальные: так снятый с
    // публикации плащ перестаёт отображаться, а не остаётся навсегда
    const keep = j.model.entries.filter((e) => !entries.some((x) => x.cmd === e.threshold)
      && !POOL_MODEL.test(e.model.model));
    for (const e of entries) {
      keep.push({ threshold: e.cmd, model: { model: 'mistmc:item/' + e.name, type: 'minecraft:model' } });
    }
    keep.sort((a, b) => a.threshold - b.threshold);
    j.model.entries = keep;
    fs.writeFileSync(modern, JSON.stringify(j, null, 2));
  }
  if (fs.existsSync(legacy)) {
    const j = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    const keep = (j.overrides || []).filter((o) => !POOL_MODEL.test(String(o.model))
      && !entries.some((x) => x.cmd === o.predicate.custom_model_data));
    for (const e of entries) {
      keep.push({ predicate: { custom_model_data: e.cmd }, model: 'mistmc:item/' + e.name });
    }
    keep.sort((a, b) => a.predicate.custom_model_data - b.predicate.custom_model_data);
    j.overrides = keep;
    fs.writeFileSync(legacy, JSON.stringify(j, null, 2));
  }
}

/** Включить пак в options.txt (создаёт минимальный файл при первом запуске). */
function ensureEnabled(gameDir, logLine) {
  const optFile = path.join(gameDir, 'options.txt');
  const entry = JSON.stringify(OPTIONS_ENTRY);
  try {
    if (!fs.existsSync(optFile)) {
      fs.writeFileSync(optFile, 'resourcePacks:["vanilla","mod_resources",' + entry + ']\n');
      return;
    }
    const lines = fs.readFileSync(optFile, 'utf8').split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('resourcePacks:')) continue;
      found = true;
      if (lines[i].includes(entry)) return;
      try {
        const arr = JSON.parse(lines[i].slice('resourcePacks:'.length));
        arr.push(OPTIONS_ENTRY); // в конец = поверх остальных паков игрока
        lines[i] = 'resourcePacks:' + JSON.stringify(arr);
      } catch (e) {
        return; // непарсибельная строка — чужой файл не ломаем
      }
    }
    if (!found) lines.push('resourcePacks:["vanilla","mod_resources",' + entry + ']');
    fs.writeFileSync(optFile, lines.join('\n'));
    logLine('Косметика: пак включён в options.txt');
  } catch (e) { /* молча */ }
}

/**
 * Собрать/обновить пак перед запуском игры.
 * @param gameDir папка игры
 * @param nick    ник игрока (чтобы приехал и свой рисунок с модерации)
 * @param api     модуль community (cosmeticPack, siteUrl)
 * @param logLine лог лаунчера
 */
async function syncCosmeticPack(gameDir, nick, api, logLine) {
  try {
    const dir = path.join(gameDir, 'resourcepacks', PACK_DIR);
    const manifest = await api.cosmeticPack(nick);
    if (!manifest || !manifest.ok) {
      logLine('Косметика: сайт не ответил — оставляю пак как есть');
      return;
    }
    const state = readState(dir);
    if (!(await ensureBase(dir, manifest.basePack || [], state, logLine))) return;

    const texDir = path.join(dir, 'assets/mistmc/textures/item');
    const modelDir = path.join(dir, 'assets/mistmc/models/item');
    fs.mkdirSync(texDir, { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });

    // Своя заявка на модерации приезжает последней и перекрывает одобренную:
    // автор видит в игре то, что нарисовал, остальные — то, что прошло проверку.
    const wanted = new Map();
    for (const d of manifest.drawings || []) {
      wanted.set(d.kind + '_' + d.slotIndex, d);
    }

    const entries = [];
    const fresh = {};
    for (const [name, d] of wanted) {
      entries.push({ cmd: d.cmd, name });
      const texFile = path.join(texDir, name + '.png');
      fresh[name] = d.sha1;
      if (state.drawings[name] === d.sha1 && fs.existsSync(texFile)) continue;
      try {
        const res = await fetchWithTimeout(manifest.textureUrl + d.sha1, 20000);
        const buf = Buffer.from(await res.arrayBuffer());
        if (sha1(buf) !== d.sha1) { delete fresh[name]; continue; }
        fs.writeFileSync(texFile, buf);
        fs.writeFileSync(path.join(modelDir, name + '.json'),
          JSON.stringify(drawingModel(dir, d.kind, name), null, 2));
      } catch (e) {
        delete fresh[name];
        // одна недокачанная текстура не повод бросать весь пак
      }
    }

    // убираем то, чего в описи больше нет (плащ сняли с публикации)
    for (const name of Object.keys(state.drawings)) {
      if (fresh[name]) continue;
      try { fs.unlinkSync(path.join(texDir, name + '.png')); } catch (e) { /* уже нет */ }
      try { fs.unlinkSync(path.join(modelDir, name + '.json')); } catch (e) { /* уже нет */ }
    }

    patchItems(dir, entries.filter((e) => fresh[e.name]));
    state.drawings = fresh;
    writeState(dir, state);
    ensureEnabled(gameDir, logLine);
    logLine('Косметика: в паке ' + entries.length + ' рисованных вещей');
  } catch (e) {
    logLine('Косметика: ' + (e && e.message ? e.message : e));
  }
}

module.exports = { syncCosmeticPack, unzipTo, fetchWithTimeout, sha1 };
