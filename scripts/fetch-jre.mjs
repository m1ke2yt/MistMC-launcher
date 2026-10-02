// Скачивает JRE 21 и раскладывает в resources/jre-<platform>.
// win/linux x64 — Temurin (Adoptium); win32 (32-битные системы) — Liberica:
// Temurin 32-битных сборок Windows для Java 21 не выпускает вовсе.
// Запуск: node scripts/fetch-jre.mjs win | linux | win32
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const target = (process.argv[2] || (process.platform === 'win32' ? 'win' : 'linux')).toLowerCase();
const TARGETS = {
  win:   { dir: 'jre-win',   windows: true },
  windows: { dir: 'jre-win', windows: true },
  linux: { dir: 'jre-linux', windows: false },
  win32: { dir: 'jre-win32', windows: true, ia32: true },
  ia32:  { dir: 'jre-win32', windows: true, ia32: true },
};
const t = TARGETS[target];
if (!t) { console.error('Неизвестная цель:', target, '— жду win | linux | win32'); process.exit(1); }
const jreDir = path.join(root, 'resources', t.dir);
const probe = t.windows ? path.join('bin', 'javaw.exe') : path.join('bin', 'java');

// Прямой URL для 32-бит: свежая 21-я Liberica JRE через их API, с фолбэком
// на закреплённую версию (API отвалился — сборка всё равно должна собраться).
const LIBERICA_FALLBACK = 'https://github.com/bell-sw/Liberica/releases/download/21.0.8+12/bellsoft-jre21.0.8+12-windows-i586.zip';
async function resolveUrl() {
  if (!t.ia32) {
    const plat = t.windows ? 'windows' : 'linux';
    return `https://api.adoptium.net/v3/binary/latest/21/ga/${plat}/x64/jre/hotspot/normal/eclipse?project=jdk`;
  }
  try {
    const res = await fetch('https://api.bell-sw.com/v1/liberica/releases?version-feature=21&os=windows&bitness=32&bundle-type=jre&package-type=zip');
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) throw new Error('пустой ответ');
    // «21+37» и «21.0.8+12» простым сплитом не сравнить (build попадает в
    // разряд update) — берём числовые поля версии из самого API
    const key = (r) => [r.featureVersion || 0, r.interimVersion || 0, r.updateVersion || 0,
      r.patchVersion || 0, r.buildVersion || 0];
    list.sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return kb[i] - ka[i];
      }
      return 0;
    });
    console.log('Liberica JRE (32-bit):', list[0].version);
    return list[0].downloadUrl;
  } catch (e) {
    console.log('API Liberica недоступен (' + e.message + ') — беру закреплённую версию.');
    return LIBERICA_FALLBACK;
  }
}

async function main() {
  if (fs.existsSync(path.join(jreDir, probe))) {
    console.log('JRE уже на месте:', jreDir);
    return;
  }
  fs.rmSync(jreDir, { recursive: true, force: true });
  fs.mkdirSync(jreDir, { recursive: true });

  const ext = t.windows ? 'zip' : 'tar.gz';
  const tmpArc = path.join(os.tmpdir(), `jre-21-${t.dir}.${ext}`);
  const url = await resolveUrl();
  console.log(`Скачиваю JRE 21 (${t.dir})…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Не удалось скачать JRE: HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpArc, buf);
  console.log('Скачано', (buf.length / 1e6).toFixed(1), 'МБ. Распаковываю…');

  const tmpOut = path.join(os.tmpdir(), `jre-21-${t.dir}-out`);
  fs.rmSync(tmpOut, { recursive: true, force: true });
  fs.mkdirSync(tmpOut, { recursive: true });
  if (t.windows) {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${tmpArc}' -DestinationPath '${tmpOut}' -Force`], { stdio: 'inherit' });
  } else {
    // tar доступен и на Windows (git/MSYS) и на Linux
    execFileSync('tar', ['-xzf', tmpArc, '-C', tmpOut], { stdio: 'inherit' });
  }

  const inner = fs.readdirSync(tmpOut).map((n) => path.join(tmpOut, n)).find((p) => fs.statSync(p).isDirectory());
  const srcRoot = inner && fs.existsSync(path.join(inner, 'bin')) ? inner : tmpOut;
  for (const entry of fs.readdirSync(srcRoot)) {
    fs.cpSync(path.join(srcRoot, entry), path.join(jreDir, entry), { recursive: true });
  }
  fs.rmSync(tmpArc, { force: true });
  fs.rmSync(tmpOut, { recursive: true, force: true });

  if (!fs.existsSync(path.join(jreDir, probe))) {
    throw new Error('После распаковки не найден ' + probe);
  }
  console.log('JRE готов:', jreDir);
}

main().catch((e) => { console.error(e); process.exit(1); });
