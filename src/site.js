'use strict';

// Выбор рабочей базы сайта: mistmc.gg напрямую или зеркало на VPS раздачи
// (https://files.mistmc.gg/site → реверс-прокси на сайт). У части стран
// (Украина) RU IP сайта заблокирован целиком — без фолбэка лаунчер терял
// хартбит (и инвентаризацию модов в админке), сообщество и автообновление.
//
// Логика: пробуем прямой сайт коротким запросом; не ответил — пробуем зеркало.
// Результат кэшируется, перепроверка раз в 10 минут (и принудительно при
// сетевой ошибке очередного вызова). Всё молчаливое: сеть не должна мешать игре.

const { fetch, Agent } = require('undici');

const MAIN = process.env.MISTMC_SITE_URL || 'https://mistmc.gg';
const MIRROR = 'https://files.mistmc.gg/site';
// Зеркало релизов лаунчера (синкается deploy-launcher-release.ps1) — для фида
// electron-updater не нужен даже прокси, файлы лежат на VPS раздачи локально.
const MIRROR_DOWNLOADS = 'https://files.mistmc.gg/dl';

const PROBE_PATH = '/api/status';
const PROBE_TIMEOUT_MS = 6000;
const RECHECK_MS = 10 * 60_000;

const agent = new Agent({ connect: { timeout: PROBE_TIMEOUT_MS }, headersTimeout: PROBE_TIMEOUT_MS });

let base = MAIN;          // текущая рабочая база
let checkedAt = 0;        // когда пробовали в последний раз
let probing = null;       // защита от параллельных проб

async function probeOne(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url + PROBE_PATH, { dispatcher: agent, signal: ac.signal });
    return res.status < 500;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probe() {
  if (await probeOne(MAIN)) {
    base = MAIN;
  } else if (await probeOne(MIRROR)) {
    base = MIRROR;
  } // оба лежат — оставляем как было, следующая проверка по таймеру
  checkedAt = Date.now();
}

/** Актуальная база сайта (с ленивой перепроверкой раз в RECHECK_MS). */
async function getBase() {
  if (Date.now() - checkedAt > RECHECK_MS) {
    if (!probing) probing = probe().finally(() => { probing = null; });
    await probing;
  }
  return base;
}

/** Синхронно: последняя известная база (для мест, где ждать нельзя). */
function baseSync() {
  return base;
}

function isMirror() {
  return base === MIRROR;
}

/** fetch относительно рабочей базы; при сетевой ошибке — одна перепроба через альтернативу. */
async function siteFetch(path, options) {
  const first = await getBase();
  try {
    return await fetch(first + path, options);
  } catch (e) {
    const alt = first === MAIN ? MIRROR : MAIN;
    try {
      const res = await fetch(alt + path, options);
      base = alt; // альтернатива ответила — прилипаем к ней
      checkedAt = Date.now();
      return res;
    } catch (_) {
      throw e;
    }
  }
}

module.exports = { MAIN, MIRROR, MIRROR_DOWNLOADS, getBase, baseSync, isMirror, siteFetch };
