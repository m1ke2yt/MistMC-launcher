# Mist MC Launcher

Лаунчер для сервера mistmc.gg. Minecraft 1.21.11, вход без аккаунта Mojang/Microsoft
(offline), выбор загрузчика Fabric / Forge / Vanilla. Клиент, библиотеки и ассеты
скачиваются при первом запуске; Java (JRE 21) кладётся внутрь сборки.

Это исходники для проверки — оформление интерфейса в публичной версии упрощённое.

## Стек

- Electron — окно и IPC.
- `@xmcl/core` + `@xmcl/installer` — установка версий, Fabric/Forge, запуск игры.
- Offline UUID считается так же, как на сервере: name-based UUID от `OfflinePlayer:<ник>`.

## Запуск из исходников

```
npm install
node scripts/fetch-jre.mjs win     # или linux — качает JRE в resources/jre-<platform>
npm start
```

Свои клиентские моды (Fabric jars) можно положить в `resources/mods` — они попадут
в игру при выборе Fabric.

## Сборка

```
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Собирает Windows (nsis + zip) и Linux (tar.gz). На Windows electron-builder не
сохраняет бит `+x` для Linux, поэтому tar пересобирается через `scripts/pack-linux.py`.
AppImage/deb нужно собирать на Linux.

Артефакты — в `release/`.

## Папка игры

По умолчанию `%APPDATA%\.mistmc` (Windows) / `~/.config/.mistmc` (Linux).
Меняется в разделе «Дополнительно».

## Лицензии

Код — MIT (см. `LICENSE`). Список сторонних компонентов и их лицензий — в `NOTICE`.
