// Перенос настроек из другого лаунчера: сканируем известные места установки
// (официальный/TLauncher/Legacy → .minecraft, Prism/MultiMC, CurseForge,
// Modrinth App) + ручной выбор папки; переносим выбранное: options.txt
// (управление/графика/звук), servers.dat, ресурспаки, шейдеры, миры,
// конфиги модов (вейпоинты Xaero, схематики Litematica, эмоции…).
// МОДЫ НЕ ПЕРЕНОСИМ принципиально: ставятся через вкладку «Моды» c блоклистом
// читерского — чужие джарники могут быть не под нашу версию или с читами.
const fs = require('fs');
const path = require('path');

/** Похожа ли папка на игровую папку Minecraft (для ручного выбора). */
function looksLikeMinecraftDir(dir) {
  try {
    return ['options.txt', 'servers.dat', 'saves', 'resourcepacks', 'versions']
      .some((n) => fs.existsSync(path.join(dir, n)));
  } catch (e) {
    return false;
  }
}

function countEntries(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).length;
  } catch (e) {
    return 0;
  }
}

function statsFor(dir) {
  return {
    options: fs.existsSync(path.join(dir, 'options.txt')),
    servers: fs.existsSync(path.join(dir, 'servers.dat')),
    resourcepacks: countEntries(path.join(dir, 'resourcepacks')),
    shaderpacks: countEntries(path.join(dir, 'shaderpacks')),
    saves: countEntries(path.join(dir, 'saves')),
    configs: countEntries(path.join(dir, 'config')),
  };
}

function pushIfGameDir(out, dir, label, ownDir) {
  try {
    if (!fs.existsSync(dir)) return;
    if (path.resolve(dir) === path.resolve(ownDir)) return; // сами из себя не переносим
    const st = statsFor(dir);
    if (!st.options && !st.servers && !st.saves && !st.resourcepacks) return; // пустышка
    out.push({ dir, label, stats: st });
  } catch (e) { /* нет доступа — пропускаем */ }
}

/** Найти игровые папки известных лаунчеров (ownDir — наша, исключается). */
function scanSources(ownDir) {
  const out = [];
  const appdata = process.env.APPDATA || '';
  const home = process.env.USERPROFILE || '';

  // официальный лаунчер, TLauncher, Legacy Launcher — все живут в .minecraft
  pushIfGameDir(out, path.join(appdata, '.minecraft'), 'Официальный / TLauncher / Legacy (.minecraft)', ownDir);

  // Prism Launcher / MultiMC: instances/<имя>/.minecraft (у новых Prism — minecraft)
  for (const [root, name] of [
    [path.join(appdata, 'PrismLauncher', 'instances'), 'Prism'],
    [path.join(appdata, 'MultiMC', 'instances'), 'MultiMC'],
  ]) {
    try {
      for (const inst of fs.readdirSync(root)) {
        for (const sub of ['.minecraft', 'minecraft']) {
          pushIfGameDir(out, path.join(root, inst, sub), `${name}: ${inst}`, ownDir);
        }
      }
    } catch (e) { /* лаунчер не установлен */ }
  }

  // CurseForge: curseforge/minecraft/Instances/<имя>
  try {
    const root = path.join(home, 'curseforge', 'minecraft', 'Instances');
    for (const inst of fs.readdirSync(root)) {
      pushIfGameDir(out, path.join(root, inst), `CurseForge: ${inst}`, ownDir);
    }
  } catch (e) { /* нет */ }

  // Modrinth App: ModrinthApp/profiles/<имя>
  try {
    const root = path.join(appdata, 'ModrinthApp', 'profiles');
    for (const inst of fs.readdirSync(root)) {
      pushIfGameDir(out, path.join(root, inst), `Modrinth App: ${inst}`, ownDir);
    }
  } catch (e) { /* нет */ }

  return out;
}

function backupThenCopyFile(src, dest, results, what) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.copyFileSync(dest, dest + '.bak-migrate'); // прежний — рядом, вернуть легко
  }
  fs.copyFileSync(src, dest);
  results.push(`✔ ${what} перенесены (прежние сохранены в *.bak-migrate)`);
}

/** Копия недостающих записей папки (существующие у нас НЕ трогаем). */
function copyMissing(srcDir, destDir, results, what) {
  if (!fs.existsSync(srcDir)) return;
  let copied = 0;
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (name.startsWith('.')) continue;
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    if (fs.existsSync(dest)) continue;
    try {
      fs.cpSync(src, dest, { recursive: true });
      copied++;
    } catch (e) { /* один битый файл не должен валить перенос */ }
  }
  if (copied > 0) results.push(`✔ ${what}: ${copied} новых`);
}

/**
 * Перенос выбранных частей из dir в gameDir. parts: options, servers,
 * resourcepacks, shaderpacks, saves, configs (см. чекбоксы в модалке).
 */
function importFrom(dir, gameDir, parts, logLine) {
  const results = [];
  if (path.resolve(dir) === path.resolve(gameDir)) {
    return ['✖ Это папка нашего лаунчера — переносить из неё некуда.'];
  }

  if (parts.options && fs.existsSync(path.join(dir, 'options.txt'))) {
    // управление, графика, звук, язык — целиком; наш ресурспак доложится
    // сам при следующем запуске (respack.ensureEnabled)
    backupThenCopyFile(path.join(dir, 'options.txt'), path.join(gameDir, 'options.txt'),
      results, 'Настройки игры (options.txt)');
  }
  if (parts.servers && fs.existsSync(path.join(dir, 'servers.dat'))) {
    backupThenCopyFile(path.join(dir, 'servers.dat'), path.join(gameDir, 'servers.dat'),
      results, 'Список серверов');
  }
  if (parts.resourcepacks) {
    copyMissing(path.join(dir, 'resourcepacks'), path.join(gameDir, 'resourcepacks'),
      results, 'Ресурспаки');
  }
  if (parts.shaderpacks) {
    copyMissing(path.join(dir, 'shaderpacks'), path.join(gameDir, 'shaderpacks'),
      results, 'Шейдеры');
  }
  if (parts.saves) {
    copyMissing(path.join(dir, 'saves'), path.join(gameDir, 'saves'), results, 'Миры');
  }
  if (parts.configs) {
    // конфиги модов + данные, которые жалко терять: вейпоинты и карты Xaero,
    // схематики Litematica, эмоции Emotecraft
    copyMissing(path.join(dir, 'config'), path.join(gameDir, 'config'), results, 'Конфиги модов');
    copyMissing(path.join(dir, 'xaero'), path.join(gameDir, 'xaero'), results, 'Карты/вейпоинты Xaero');
    copyMissing(path.join(dir, 'XaeroWaypoints'), path.join(gameDir, 'XaeroWaypoints'),
      results, 'Вейпоинты Xaero (старый формат)');
    copyMissing(path.join(dir, 'schematics'), path.join(gameDir, 'schematics'),
      results, 'Схематики Litematica');
    copyMissing(path.join(dir, 'emotes'), path.join(gameDir, 'emotes'), results, 'Эмоции Emotecraft');
  }

  if (!results.length) results.push('Ничего не перенесено: в выбранной папке не нашлось отмеченного.');
  if (logLine) for (const r of results) logLine('Перенос: ' + r);
  return results;
}

module.exports = { scanSources, importFrom, looksLikeMinecraftDir, statsFor };
