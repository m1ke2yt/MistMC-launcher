'use strict';

// Сообщество лаунчера: оценки модов игроками и коды сборок.
// Все запросы подписываются ключом официальной сборки (как хартбит) — сайт
// отличает наш лаунчер от подделки. Любая сетевая беда не должна мешать
// пользоваться лаунчером, поэтому наружу отдаём { ok:false, error } и молчим.

const crypto = require('crypto');
const { Agent } = require('undici');
const buildSecret = require('./build-secret');
// база сайта с фолбэком на зеркало (RU IP сайта заблокирован из Украины)
const site = require('./site');

const agent = new Agent({ connect: { timeout: 8000 }, headersTimeout: 12000, bodyTimeout: 30000 });
const TIMEOUT_MS = 12000;

/** Добавляет ts и подпись HMAC (в публичной сборке ключа нет — уходит без неё). */
function signBody(body, payload) {
  const ts = Date.now();
  const out = Object.assign({}, body, { ts });
  if (buildSecret.HEARTBEAT_HMAC_KEY) {
    out.sig = crypto
      .createHmac('sha256', buildSecret.HEARTBEAT_HMAC_KEY)
      .update(payload(ts))
      .digest('hex');
  }
  return out;
}

async function call(path, { method = 'GET', body } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await site.siteFetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      dispatcher: agent,
      signal: ac.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || ('HTTP ' + res.status) };
    }
    return data;
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'сайт не отвечает' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Поставить оценку: value 1 (нравится), -1 (не нравится), 0 (снять). */
function vote(nick, project, value) {
  const v = value > 0 ? 1 : value < 0 ? -1 : 0;
  const body = signBody(
    { nick, project, value: v },
    (ts) => `${nick}|${project.projectId}|${v}|${ts}`,
  );
  return call('/api/bridge/launcher/vote', { method: 'POST', body });
}

/** Оценки по списку проектов (+ свой голос). */
function ratings(ids, nick) {
  const list = (ids || []).filter(Boolean).slice(0, 100);
  if (!list.length) return Promise.resolve({ ok: true, ratings: [] });
  const q = '?ids=' + encodeURIComponent(list.join(','))
    + (nick ? '&nick=' + encodeURIComponent(nick) : '');
  return call('/api/bridge/launcher/vote' + q);
}

/** Топ по оценкам игроков. */
function top(type, limit) {
  return call('/api/bridge/launcher/top?type=' + encodeURIComponent(type || 'mod')
    + '&limit=' + (limit || 25));
}

/** Опубликовать сборку → короткий код. */
function shareBuild(nick, build) {
  const body = signBody({ nick, build }, (ts) => `${nick}|share|${ts}`);
  return call('/api/bridge/launcher/share', { method: 'POST', body });
}

/** Забрать сборку по коду. */
function fetchBuild(code) {
  return call('/api/bridge/launcher/share?code=' + encodeURIComponent(String(code || '').trim()));
}

/** Каталог косметики + что куплено/надето + баланс искр. */
function cosmetics(nick) {
  return call('/api/bridge/launcher/cosmetics?nick=' + encodeURIComponent(nick || ''));
}

/** action: 'buy' | 'equip'; id = null снимает надетое. */
function cosmeticAction(nick, action, id, slot) {
  const body = signBody(
    { nick, action, id, slot },
    (ts) => `${nick}|${action}|${id ?? ''}|${ts}`,
  );
  return call('/api/bridge/launcher/cosmetics', { method: 'POST', body });
}

/** Свои рисованные плащи и флаги: что одобрено, что на проверке, что завернули. */
function drawings(nick) {
  return call('/api/bridge/launcher/cape?nick=' + encodeURIComponent(nick || ''));
}

/** Отправить рисунок на модерацию. png — base64 без префикса data:. */
function submitDrawing(nick, kind, png) {
  const body = signBody({ nick, kind, png }, (ts) => `${nick}|cape|${kind}|${ts}`);
  return call('/api/bridge/launcher/cape', { method: 'POST', body });
}

/** Какой скин стоит у игрока на сайте: url на PNG (с суммой — кэш сам
 *  обновится при смене) или null, если скин обычный. */
async function skinState(nick) {
  const res = await call('/api/bridge/launcher/skin?nick=' + encodeURIComponent(nick));
  if (!res || !res.ok || !res.skin || !res.skin.sha1) return { ok: true, url: null };
  return {
    ok: true,
    url: `${site.baseSync()}/api/bridge/launcher/skin?nick=${encodeURIComponent(nick)}&png=1&v=${res.skin.sha1}`,
    slim: !!res.skin.slim,
  };
}

/** Поставить свой скин (png — base64 без префикса data:). */
function applySkin(nick, png, slim) {
  const body = signBody({ nick, png, slim }, (ts) => `${nick}|skin|set|${ts}`);
  return call('/api/bridge/launcher/skin', { method: 'POST', body });
}

/** Вернуть обычный скин аккаунта. */
function resetSkin(nick) {
  const body = signBody({ nick, reset: true }, (ts) => `${nick}|skin|reset|${ts}`);
  return call('/api/bridge/launcher/skin', { method: 'POST', body });
}

/** Опись косметик-пака: что положить в локальный ресурспак игрока. */
function cosmeticPack(nick) {
  return call('/api/bridge/launcher/cosmetic-pack?nick=' + encodeURIComponent(nick || ''));
}

/** Адрес сайта — нужен модулю сборки пака, чтобы качать текстуры. */
function siteUrl() {
  return site.baseSync();
}

module.exports = {
  vote, ratings, top, shareBuild, fetchBuild, cosmetics, cosmeticAction,
  drawings, submitDrawing, cosmeticPack, siteUrl, applySkin, resetSkin, skinState,
};
