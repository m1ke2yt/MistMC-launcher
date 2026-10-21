'use strict';

// Просьбы игры к лаунчеру. Мод MistSocial перед входом в мир друга сверяет
// моды: если у друга стоят те, которых нет у игрока, мод просит лаунчер
// доставить их и перезапустить игру. Моды в работающую игру не подгрузить,
// а ставить их умеет только лаунчер (каталог, зависимости, запреты сервера).
//
// Канал — TCP на 127.0.0.1, строки JSON. Порт и одноразовый ключ игра
// получает переменной окружения MIST_LAUNCHER_IPC («порт:ключ»): в командную
// строку они не попадают, значит, не светятся ни в списке процессов, ни в
// крэш-репортах, которые игроки выкладывают целиком.
//   игра → { t: 'hello', token }
//   игра → { t: 'sync', host, mc, mods: [{ id, n, v, h }] }
//   лаунчер → { t: 'progress', done, total, name } … { t: 'result', installed, failed, restart }
//   игра → { t: 'restart', join, mc }  лаунчер → { t: 'restart_ok' }
//   игра → { t: 'ping' }  лаунчер → { t: 'pong' }
// mc — версия игры друга, если она не та, что запущена: лаунчер перезапустит
// игру уже на ней.
// На любую неудачу лаунчер отвечает { t: 'error', text }.
// ping — пропуск для модов Mist MC: без ответа лаунчера они не включаются.
// Моды до 1.8.21 принимают и ответ на неизвестную просьбу.

const net = require('net');
const crypto = require('crypto');

const MAX_LINE = 256 * 1024;
const MOD_ID_RE = /^[a-z][a-z0-9_-]{1,63}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const MAX_MODS = 200;

// ключи прошлых игр годятся только для ping: вторая игра не должна отбирать
// пропуск у первой, которая ещё грузится; ставить моды и перезапускать игру
// может лишь последняя
const KEEP_TOKENS = 4;

let server = null;
let port = 0;
let tokens = [];
let handlers = null;
let busy = false;

/** 'current' — ключ последней игры, 'old' — одной из прошлых, иначе null. */
function tokenKind(given) {
  if (typeof given !== 'string') return null;
  const a = Buffer.from(given);
  const i = tokens.findIndex((t) => {
    const b = Buffer.from(t);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  return i < 0 ? null : i === 0 ? 'current' : 'old';
}

const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

/** Список модов из просьбы игры: только известные поля, с проверкой формата. */
function cleanMods(raw) {
  const out = [];
  const seen = new Set();
  for (const m of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_MODS) break;
    if (!m || typeof m !== 'object') continue;
    const id = clip(m.id, 64);
    if (!MOD_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const sha1 = clip(m.h, 40).toLowerCase();
    out.push({
      id,
      name: clip(m.n, 64) || id,
      version: clip(m.v, 64),
      sha1: SHA1_RE.test(sha1) ? sha1 : null,
    });
  }
  return out;
}

async function onMessage(msg, reply, kind) {
  if (msg.t === 'ping') {
    reply({ t: 'pong' });
  } else if (kind !== 'current') {
    throw new Error('Игра запущена заново — эта просьба уже не действует.');
  } else if (msg.t === 'sync') {
    if (busy) throw new Error('Моды уже ставятся — подождите.');
    const wanted = cleanMods(msg.mods);
    if (!wanted.length) throw new Error('Список модов пуст.');
    busy = true;
    try {
      const res = await handlers.sync({ host: clip(msg.host, 16), mc: clip(msg.mc, 24), mods: wanted },
        (done, total, name) => reply({ t: 'progress', done, total, name: name || '' }));
      reply({ t: 'result', installed: res.installed, failed: res.failed, restart: res.installed.length > 0 });
    } finally {
      busy = false;
    }
  } else if (msg.t === 'restart') {
    handlers.restart({ join: clip(msg.join, 16), mc: clip(msg.mc, 24) });
    reply({ t: 'restart_ok' });
  } else {
    throw new Error('Неизвестная просьба: ' + clip(msg.t, 24));
  }
}

function onConnection(sock) {
  let buf = '';
  let authed = null;
  let chain = Promise.resolve();
  sock.setEncoding('utf8');
  sock.setNoDelay(true);
  sock.on('error', () => { /* игра закрылась — обычное дело */ });
  const reply = (o) => { if (!sock.destroyed) sock.write(JSON.stringify(o) + '\n'); };
  const handle = async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch (_) { sock.destroy(); return; }
    if (!msg || typeof msg !== 'object') { sock.destroy(); return; }
    if (!authed) {
      // первым идёт ключ, выданный этой игре при запуске; чужим процессам ответа нет
      if (msg.t !== 'hello' || !tokenKind(msg.token)) { sock.destroy(); return; }
      authed = msg.token;
      return;
    }
    try {
      // ключ мог устареть, пока соединение открыто: сверяем на каждой просьбе
      await onMessage(msg, reply, tokenKind(authed));
    } catch (e) {
      reply({ t: 'error', text: e && e.message ? e.message : 'Не получилось.' });
    }
  };
  sock.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > MAX_LINE) { sock.destroy(); return; }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      // по одной просьбе за раз, в порядке прихода
      if (line) chain = chain.then(() => handle(line));
    }
  });
}

/**
 * Поднять канал (один на процесс лаунчера) и выдать ключ очередной игре.
 * Возвращает значение для MIST_LAUNCHER_IPC или null, если порт открыть не
 * удалось — игра тогда просто не предложит ставить моды.
 *   h.sync({ host, mc, mods }, progress) → { installed: [название], failed: [{ name, why }] }
 *   h.restart({ join, mc })
 */
async function issue(h) {
  handlers = h;
  if (!server) {
    try {
      const srv = net.createServer(onConnection);
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', resolve);
      });
      srv.on('error', () => { /* слушаем дальше */ });
      srv.unref(); // закрытию лаунчера не мешает
      server = srv;
      port = srv.address().port;
    } catch (_) {
      return null;
    }
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens = [token, ...tokens].slice(0, KEEP_TOKENS);
  return port + ':' + token;
}

module.exports = { issue, cleanMods };
