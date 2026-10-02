'use strict';

// Автоперевод описаний Modrinth на русский через публичный эндпоинт Google
// Translate (client=gtx, без ключа). Держится на честном слове: сбой сети,
// лимит или потеря разметки → вызывающий молча показывает оригинал.
// Дисковый кэш переводов (userData/translate-cache.json) — повторные открытия
// мгновенные и не дёргают сеть.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetch, Agent } = require('undici');

const agent = new Agent({ connect: { timeout: 8000 }, headersTimeout: 10000, bodyTimeout: 30000 });

const CACHE_MAX = 4000; // записей; старые вытесняются
let cacheFile = null;
let cache = new Map();
let saveTimer = null;

function init(dir) {
  cacheFile = path.join(dir, 'translate-cache.json');
  try {
    cache = new Map(Object.entries(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))));
  } catch (_) {
    cache = new Map();
  }
}

function scheduleSave() {
  if (!cacheFile || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(cache)));
    } catch (_) { /* кэш — не повод падать */ }
  }, 1500);
}

const hash = (s) => crypto.createHash('md5').update(s).digest('hex');

// Уже по-русски (кириллицы больше, чем латиницы) — переводить нечего
function looksRussian(text) {
  const cyr = (text.match(/[а-яё]/gi) || []).length;
  const lat = (text.match(/[a-z]/gi) || []).length;
  return cyr > lat;
}

async function gtx(text) {
  const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'q=' + encodeURIComponent(text),
    dispatcher: agent,
  });
  if (!res.ok) throw new Error('translate HTTP ' + res.status);
  const data = await res.json();
  // data[0] = [[перевод, оригинал, …], …] — куски идут по порядку
  return (data[0] || []).map((seg) => (seg && seg[0]) || '').join('');
}

// ── защита разметки ─────────────────────────────────────────────────────
// Код, HTML-теги, картинки и URL заменяем плейсхолдерами ⟦N⟧, чтобы перевод
// их не искалечил; после перевода возвращаем на место. Если переводчик съел
// хоть один плейсхолдер — бросаем, вызывающий отдаст оригинал.
function protect(md) {
  const store = [];
  const put = (s) => { store.push(s); return '⟦' + (store.length - 1) + '⟧'; };
  let s = md;
  s = s.replace(/```[\s\S]*?(```|$)/g, put);                      // код-блоки
  s = s.replace(/<[^>\n]{1,300}?>/g, put);                        // HTML-теги
  s = s.replace(/!\[[^\]]*\]\([^)\s]+\)/g, put);                  // картинки целиком
  // текст ссылки в Title Case = почти всегда название другого мода
  // («Iris Shaders», «Fabric API») — не переводим
  s = s.replace(/\[((?:[A-Z][\w'&.+-]*)(?:\s+[A-Z\d][\w'&.+-]*){0,3})\]\(/g,
    (_, txt) => '[' + put(txt) + '](');
  s = s.replace(/\]\(([^)\s]+)\)/g, (_, u) => '](' + put(u) + ')'); // url ссылок (текст переводится)
  s = s.replace(/`[^`\n]+`/g, put);                               // inline-код
  s = s.replace(/https?:\/\/[^\s)>\]]+/g, put);                   // голые ссылки
  return { s, store };
}

const PLACEHOLDER_RE = /⟦\s*(\d+)\s*⟧/g;

function restore(s, store) {
  return s.replace(PLACEHOLDER_RE, (_, n) => store[+n] ?? '');
}

// Имена собственные (название мода) переводить нельзя: «Sodium» → «Натрий»,
// «Iris» → «радужная оболочка глаза». Прячем их в плейсхолдеры тем же способом.
function protectTerms(text, terms, store) {
  let s = text;
  for (const term of (terms || []).filter((t) => t && t.length >= 3).sort((a, b) => b.length - a.length)) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(esc, 'gi'), (m) => { store.push(m); return '⟦' + (store.length - 1) + '⟧'; });
  }
  return s;
}

// Режем по абзацам, чтобы каждый запрос был вменяемого размера
function chunkSplit(s, max = 3500) {
  const out = [];
  let cur = '';
  for (const para of s.split(/\n\n/)) {
    let piece = para + '\n\n';
    if (cur.length + piece.length > max && cur) { out.push(cur); cur = ''; }
    while (piece.length > max) { out.push(piece.slice(0, max)); piece = piece.slice(max); }
    cur += piece;
  }
  if (cur) out.push(cur);
  return out;
}

/** Перевод markdown-описания целиком; бросает при сбое (вызывающий отдаёт
 * оригинал). terms — имена собственные (название мода), их не переводим. */
async function markdown(md, terms) {
  if (!md || !md.trim() || looksRussian(md)) return md;
  const k = 'md:' + hash(md);
  if (cache.has(k)) return cache.get(k);
  let { s, store } = protect(md); // сперва разметка (внутри URL бывают имена)
  s = protectTerms(s, terms, store);
  const parts = await Promise.all(chunkSplit(s).map((p) => gtx(p)));
  const joined = parts.join('');
  const got = (joined.match(PLACEHOLDER_RE) || []).length;
  if (got !== store.length) throw new Error('перевод потерял разметку (' + got + '/' + store.length + ')');
  const out = restore(joined, store);
  cache.set(k, out);
  scheduleSave();
  return out;
}

/** Пакетный перевод коротких строк (описания в поиске): массив → массив.
 * terms[i] — название соответствующего мода (не переводится). Непереведённые
 * (пустые/русские) остаются как есть; бросает при сбое. */
async function batch(list, terms) {
  const out = list.slice();
  const idx = [];
  for (let i = 0; i < list.length; i++) {
    const t = (list[i] || '').trim();
    if (!t || looksRussian(t)) continue;
    const k = 't:' + hash(t);
    if (cache.has(k)) { out[i] = cache.get(k); continue; }
    idx.push(i);
  }
  if (!idx.length) return out;
  // ␞ (U+241E) — разделитель записей: переводчик его не трогает, а в
  // описаниях модов он не встречается (на всякий случай вычищаем)
  const SEP = '\n␞\n';
  const stores = new Map(); // i → плейсхолдеры имён этого описания
  const joined = idx.map((i) => {
    const store = [];
    const s = protectTerms(list[i].trim().replace(/␞/g, ' '), terms ? [terms[i]] : null, store);
    stores.set(i, store);
    return s;
  }).join(SEP);
  const tr = await gtx(joined);
  const parts = tr.split(/\s*␞\s*/);
  if (parts.length !== idx.length) throw new Error('batch mismatch ' + parts.length + '/' + idx.length);
  idx.forEach((i, n) => {
    const store = stores.get(i);
    const got = (parts[n].match(PLACEHOLDER_RE) || []).length;
    // имя потерялось в переводе — этому описанию оставляем оригинал
    const v = got === store.length ? restore(parts[n], store).trim() : '';
    out[i] = v || list[i];
    cache.set('t:' + hash(list[i].trim()), out[i]);
  });
  scheduleSave();
  return out;
}

/** Перевод одной короткой строки; бросает при сбое. */
async function plain(text, terms) {
  return (await batch([text || ''], terms ? [terms[0]] : null))[0];
}

module.exports = { init, markdown, batch, plain, looksRussian };
