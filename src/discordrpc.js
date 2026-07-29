'use strict';

// Discord Rich Presence: «Играет за <ник> · mistmc.gg» в профиле игрока.
// Подключается к локальному клиенту Discord через IPC-пайп. Discord может быть
// не запущен/перезапущен — коннект ретраится фоном, все ошибки молчаливые:
// статус в Discord не стоит того, чтобы мешать игре.

const { Client } = require('@xhayper/discord-rpc');

const LOGO = 'https://mistmc.gg/icon.png';

let client = null;
let ready = false;
let enabled = false;
let appId = null;
let logFn = () => {};
let desired = null; // последняя желаемая активность — применяем при (ре)коннекте
let retryTimer = null;
let reassertTimer = null; // во время игры дожимаем статус поверх авто-детекта Minecraft

function scheduleRetry() {
  if (retryTimer || !enabled) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, 60_000);
}

function connect() {
  if (!enabled || ready || !appId) return;
  try {
    client = new Client({ clientId: appId });
    client.on('ready', () => {
      ready = true;
      logFn('Discord RPC подключён');
      applyActivity();
    });
    client.on('disconnected', () => {
      ready = false;
      scheduleRetry();
    });
    client.login().catch(() => {
      ready = false;
      scheduleRetry(); // Discord не запущен — попробуем позже
    });
  } catch (_) {
    scheduleRetry();
  }
}

function applyActivity() {
  if (!ready || !client || !client.user) return;
  if (!desired) {
    client.user.clearActivity().catch(() => {});
    return;
  }
  // Кнопки НЕ используем: выставленные через локальный IPC кнопки Discord
  // рендерит серыми заглушками даже у зрителей (давний баг клиента).
  client.user.setActivity({
    details: desired.details,
    state: desired.state,
    startTimestamp: desired.start ? new Date(desired.start) : undefined,
    largeImageKey: LOGO,
    largeImageText: 'Mist MC — mistmc.gg',
  }).catch((e) => logFn('Discord RPC: ' + (e && e.message ? e.message : e)));
}

// Discord сам детектит запущенный Minecraft и норовит показать его вместо нашего
// статуса — пока идёт игра, переутверждаем активность раз в 15 секунд.
function setReassert(on) {
  if (reassertTimer) { clearInterval(reassertTimer); reassertTimer = null; }
  if (on) reassertTimer = setInterval(applyActivity, 15_000);
}

function init(applicationId, log) {
  appId = applicationId;
  logFn = log || logFn;
  enabled = true;
  connect();
}

function setIdle(nick) {
  desired = {
    details: nick ? 'В лаунчере — ' + nick : 'В лаунчере',
    state: 'mistmc.gg',
  };
  setReassert(false);
  applyActivity();
}

function setPlaying(nick, loaderLabel) {
  desired = {
    details: 'Играет за ' + nick,
    state: (loaderLabel ? loaderLabel + ' · ' : '') + 'mistmc.gg',
    start: Date.now(),
  };
  applyActivity();
  setReassert(true);
}

function disable() {
  enabled = false;
  desired = null;
  setReassert(false);
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (client) {
    try { if (client.user) client.user.clearActivity().catch(() => {}); } catch (_) { /* ignore */ }
    try { client.destroy().catch(() => {}); } catch (_) { /* ignore */ }
  }
  client = null;
  ready = false;
}

function enable(applicationId, log) {
  if (enabled) return;
  init(applicationId, log);
}

module.exports = { init, enable, disable, setIdle, setPlaying };
