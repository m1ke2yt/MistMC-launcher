// Скачивает Temurin JRE 21 и раскладывает в resources/jre-<platform>
// Запуск: node scripts/fetch-jre.mjs win   |   node scripts/fetch-jre.mjs linux
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const target = (process.argv[2] || (process.platform === 'win32' ? 'win' : 'linux')).toLowerCase();
const PLAT = target === 'win' || target === 'windows' ? 'windows' : 'linux';
const jreDir = path.join(root, 'resources', PLAT === 'windows' ? 'jre-win' : 'jre-linux');
const probe = PLAT === 'windows' ? path.join('bin', 'javaw.exe') : path.join('bin', 'java');
const API = `https://api.adoptium.net/v3/binary/latest/21/ga/${PLAT}/x64/jre/hotspot/normal/eclipse?project=jdk`;

async function main() {
  if (fs.existsSync(path.join(jreDir, probe))) {
    console.log('JRE уже на месте:', jreDir);
    return;
  }
  fs.rmSync(jreDir, { recursive: true, force: true });
  fs.mkdirSync(jreDir, { recursive: true });

  const ext = PLAT === 'windows' ? 'zip' : 'tar.gz';
  const tmpArc = path.join(os.tmpdir(), `temurin-jre-21-${PLAT}.${ext}`);
  console.log(`Скачиваю Temurin JRE 21 (${PLAT})…`);
  const res = await fetch(API, { redirect: 'follow' });
  if (!res.ok) throw new Error('Не удалось скачать JRE: HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpArc, buf);
  console.log('Скачано', (buf.length / 1e6).toFixed(1), 'МБ. Распаковываю…');

  const tmpOut = path.join(os.tmpdir(), `temurin-jre-21-${PLAT}-out`);
  fs.rmSync(tmpOut, { recursive: true, force: true });
  fs.mkdirSync(tmpOut, { recursive: true });
  if (PLAT === 'windows') {
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
