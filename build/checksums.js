'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * electron-builder afterAllArtifactBuild hook: рядом с артефактами релиза пишем
 * SHA256SUMS.txt. Даёт игрокам путь проверки целостности скачанного установщика
 * (MITM/подмена хоста раздачи → хеш не сойдётся). Публикуйте этот файл вместе с
 * билдами на mistmc.gg/downloads.
 *
 * Полноценная защита — Authenticode-подпись .exe: electron-builder подпишет
 * автоматически, если в окружении заданы CSC_LINK (путь/URL к .pfx) и
 * CSC_KEY_PASSWORD. Без них билд собирается неподписанным (как раньше).
 */
module.exports = async function (buildResult) {
  const files = (buildResult.artifactPaths || []).filter((f) =>
    /\.(exe|zip|tar\.gz|appimage)$/i.test(f),
  );
  if (!files.length) return [];

  const lines = files.map((file) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return `${hash}  ${path.basename(file)}`;
  });

  const out = path.join(path.dirname(files[0]), 'SHA256SUMS.txt');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log('  • SHA256SUMS.txt записан: ' + out);
  return [out];
};
