// Серверный ресурспак Mist MC (петы) с автообновлением: перед запуском игры
// сверяем sha1 с сервером и кладём свежий пак в resourcepacks + включаем его
// в options.txt. Локальная копия — запасной канал: даже если раздача пака
// сервером у игрока не скачается (хост лёг, канал плохой), текстуры петов уже
// на месте. Сервер всё равно шлёт свой пак поверх — конфликтов нет (контент тот же).
// Ошибки МОЛЧАЛИВЫЕ: пак не должен мешать запуску игры.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// сайт (домен) → фолбэк VPS бота по прямому IP (переживает блокировки домена)
const PACK_URLS = [
  'https://mistmc.gg/packs/mistpet.zip',
  'http://141.11.197.47:8081/mistpet.zip',
];
const PACK_FILE = 'MistMC-Pets.zip';          // имя в resourcepacks
const OPTIONS_ENTRY = 'file/MistMC-Pets.zip'; // запись в options.txt

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

/** Актуальный sha1 пака (файл <url>.sha1 рядом с паком; сайт → фолбэк). */
async function remoteSha1() {
  for (const url of PACK_URLS) {
    try {
      const res = await fetchWithTimeout(url + '.sha1', 7000);
      const text = (await res.text()).trim().toLowerCase();
      if (/^[0-9a-f]{40}$/.test(text)) return text;
    } catch (e) { /* следующий хост */ }
  }
  return null;
}

function fileSha1(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch (e) {
    return null;
  }
}

async function downloadPack(dest, wantSha, logLine) {
  for (const url of PACK_URLS) {
    try {
      const res = await fetchWithTimeout(url, 60000);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = crypto.createHash('sha1').update(buf).digest('hex');
      if (wantSha && got !== wantSha) {
        // симлинк на хосте могли перекинуть между sha1 и скачкой — не страшно,
        // но битую/половинную скачку не сохраняем
        logLine('Ресурспак: sha1 не совпал с ' + url + ' — пробую другой хост');
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch (e) {
      logLine('Ресурспак: ' + url + ' недоступен (' + (e && e.message ? e.message : e) + ')');
    }
  }
  return false;
}

/** Включить пак в options.txt (создаёт минимальный файл при первом запуске). */
function ensureEnabled(gameDir, logLine) {
  const optFile = path.join(gameDir, 'options.txt');
  const entry = JSON.stringify(OPTIONS_ENTRY);
  try {
    if (!fs.existsSync(optFile)) {
      // первый запуск: MC дополнит файл остальными настройками сам
      fs.writeFileSync(optFile,
        'resourcePacks:["vanilla","mod_resources",' + entry + ']\n');
      return;
    }
    const lines = fs.readFileSync(optFile, 'utf8').split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('resourcePacks:')) continue;
      found = true;
      if (lines[i].includes(entry)) return; // уже включён
      try {
        const arr = JSON.parse(lines[i].slice('resourcePacks:'.length));
        arr.push(OPTIONS_ENTRY); // в конец = поверх остальных паков игрока
        lines[i] = 'resourcePacks:' + JSON.stringify(arr);
      } catch (e) {
        return; // непарсибельная строка — не трогаем чужой файл
      }
    }
    if (!found) lines.push('resourcePacks:["vanilla","mod_resources",' + entry + ']');
    fs.writeFileSync(optFile, lines.join('\n'));
    logLine('Ресурспак Mist MC включён в options.txt');
  } catch (e) { /* молча: не критично */ }
}

/**
 * Синк пака перед запуском: сверка sha1 → скачка при обновлении → включение.
 * Сеть недоступна — тихо выходим (играть это не мешает).
 */
async function syncResourcePack(gameDir, logLine) {
  try {
    const dest = path.join(gameDir, 'resourcepacks', PACK_FILE);
    const want = await remoteSha1();
    if (!want) {
      logLine('Ресурспак: хосты недоступны — оставляю как есть');
      return;
    }
    if (fileSha1(dest) !== want) {
      logLine('Ресурспак Mist MC: качаю обновление…');
      if (!(await downloadPack(dest, want, logLine))) return;
      logLine('Ресурспак Mist MC обновлён (' + want.slice(0, 8) + ')');
    }
    ensureEnabled(gameDir, logLine);
  } catch (e) {
    logLine('Ресурспак: ' + (e && e.message ? e.message : e));
  }
}

module.exports = { syncResourcePack };
