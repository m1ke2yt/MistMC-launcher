'use strict';

/**
 * Конфиг electron-builder для 32-битной Windows-сборки (старые машины и
 * 32-битные Windows 10/8.1). Отличия от основной сборки:
 *  - арх ia32 (Electron сам скачает win32-ia32 дистрибутив);
 *  - вшивается 32-битная JRE 21 Liberica из resources/jre-win32
 *    (Temurin 32-битных сборок Java 21 не делает);
 *  - свой канал автообновления /downloads/ia32/ — иначе 32-битный лаунчер
 *    утащил бы 64-битный exe из общего latest.yml и умер при установке;
 *  - свой выходной каталог release/ia32: оба билда пишут latest.yml, в общей
 *    папке второй затёр бы первый.
 * Запуск: npx electron-builder --win --config build/ia32.config.js
 */
const pkg = require('../package.json');

const cfg = JSON.parse(JSON.stringify(pkg.build));
cfg.directories.output = 'release/ia32';
cfg.win.target = [
  { target: 'nsis', arch: ['ia32'] },
  { target: 'zip', arch: ['ia32'] },
];
for (const r of cfg.win.extraResources) {
  if (r.from === 'resources/jre-win') r.from = 'resources/jre-win32';
}
cfg.publish = [{ provider: 'generic', url: 'https://mistmc.gg/downloads/ia32/' }];
delete cfg.linux; // linux собирается только основной конфигурацией

module.exports = cfg;
