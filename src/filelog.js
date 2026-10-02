'use strict';

// Файловый журнал лаунчера (%APPDATA%\mist-mc-launcher\launcher.log).
// До 1.6.9 всё логирование жило только в UI-консоли окна: если лаунчер
// падал на старте, игроку было нечего прислать. Сюда зеркалится всё, что
// видно в UI, плюс падения процессов, которые до окна не доживают.
// Логгер не имеет права ронять лаунчер: каждая операция в try/catch.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024; // потолок; при превышении лог уезжает в .old
const SIZE_CHECK_EVERY = 2000;     // строк между проверками размера в рантайме

let logPath = null;
let stream = null;
let linesSinceCheck = 0;

function ts() {
  const d = new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return p(d.getFullYear(), 4) + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function rotateIfBig() {
  try {
    if (fs.statSync(logPath).size <= MAX_BYTES) return;
    if (stream) { stream.end(); stream = null; }
    fs.renameSync(logPath, logPath + '.old'); // на Windows rename перезаписывает существующий .old
  } catch (_) {}
}

function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'launcher.log');
    rotateIfBig();
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    stream.on('error', () => { stream = null; });
  } catch (_) {}
}

function file() { return logPath; }

function line(text) {
  if (!logPath) return;
  try {
    if (++linesSinceCheck >= SIZE_CHECK_EVERY) {
      linesSinceCheck = 0;
      rotateIfBig();
      if (!stream) { stream = fs.createWriteStream(logPath, { flags: 'a' }); stream.on('error', () => { stream = null; }); }
    }
    const out = '[' + ts() + '] ' + String(text).replace(/\r/g, '') + '\n';
    if (stream) stream.write(out);
    else fs.appendFileSync(logPath, out);
  } catch (_) {}
}

// Падение: пишем синхронно, минуя стрим — процесс может умереть до flush.
function crash(kind, err) {
  if (!logPath) return;
  try {
    let detail;
    if (err && err.stack) detail = err.stack;
    else if (err instanceof Error) detail = err.message;
    else { try { detail = JSON.stringify(err); } catch (_) { detail = String(err); } }
    fs.appendFileSync(logPath, '[' + ts() + '] ✖✖ ' + kind + ':\n' + detail + '\n');
  } catch (_) {}
}

module.exports = { init, file, line, crash };
