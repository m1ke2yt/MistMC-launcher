'use strict';

// Модели и текстуры косметики для ВИТРИНЫ лаунчера.
//
// Витрина обязана показывать саму вещь, а не цветной кружок, поэтому интерфейсу
// нужны те же модели, что видит игра: боксы с UV из ресурспака. Берём их из
// базового пака — того самого, что лаунчер кладёт игроку, — и отдаём в окно
// готовыми (JSON модели + текстуры в data:).
//
// Пак кэшируем в userData, а не в папке игры: витрину можно открыть, ни разу
// не запустив игру, да и папка игры может быть ещё не создана.

const fs = require('fs');
const path = require('path');
const { unzipTo, fetchWithTimeout, sha1 } = require('./cosmeticpack');

const CACHE_DIR = 'cosmetics-pack';

function packDir(userDataDir) {
  return path.join(userDataDir, CACHE_DIR);
}

/** Скачать/обновить базовый пак в кэш. Возвращает папку или null. */
async function ensurePack(userDataDir, urls, logLine) {
  const dir = packDir(userDataDir);
  const stamp = path.join(dir, '.sha1');
  let want = null;
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url + '.sha1', 7000);
      const text = (await res.text()).trim().toLowerCase();
      if (/^[0-9a-f]{40}$/.test(text)) { want = text; break; }
    } catch (e) { /* следующий хост */ }
  }
  let have = null;
  try { have = fs.readFileSync(stamp, 'utf8').trim(); } catch (e) { /* нет кэша */ }
  if (have && (!want || have === want) && fs.existsSync(path.join(dir, 'pack.mcmeta'))) return dir;
  if (!want) return have ? dir : null;

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 60000);
      const buf = Buffer.from(await res.arrayBuffer());
      if (sha1(buf) !== want) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      unzipTo(buf, dir);
      fs.writeFileSync(stamp, want);
      return dir;
    } catch (e) {
      if (logLine) logLine('Витрина косметики: ' + url + ' недоступен');
    }
  }
  return have ? dir : null;
}

/** «hmccosmetics:item/backpack» → assets/hmccosmetics/models/item/backpack.json */
function resourcePath(dir, ref, kind, ext) {
  const s = String(ref || '');
  const i = s.indexOf(':');
  const ns = i < 0 ? 'minecraft' : s.slice(0, i);
  const rest = i < 0 ? s : s.slice(i + 1);
  return path.join(dir, 'assets', ns, kind, rest + ext);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Модель предмета-носителя по номеру модели (тот же путь, что у игры). */
function modelRefFor(dir, material, modelData) {
  const items = readJson(path.join(dir, 'assets/minecraft/items', material.toLowerCase() + '.json'));
  const entries = items && items.model && items.model.entries;
  if (!entries) return null;
  const hit = entries.find((e) => e.threshold === modelData);
  return hit && hit.model ? hit.model.model : null;
}

/**
 * Собрать всё, что нужно окну для показа вещи: описание боксов и текстуры.
 * Текстуры уходят как data: — грузить file:// из окна не даёт политика доступа.
 */
function loadModel(dir, ref) {
  const model = readJson(resourcePath(dir, ref, 'models', '.json'));
  if (!model || !model.elements) return null;
  const textures = {};
  for (const [key, value] of Object.entries(model.textures || {})) {
    if (typeof value !== 'string' || value.startsWith('#')) continue;
    try {
      // Ленты анимации уходят ЦЕЛИКОМ: рендер (model3d.makeTexture) сам
      // распознаёт кадры w×w и листает их, как игра, — витрина живая.
      const png = fs.readFileSync(resourcePath(dir, value, 'textures', '.png'));
      textures[key] = 'data:image/png;base64,' + png.toString('base64');
    } catch (e) { /* текстуры нет — грань останется без картинки */ }
  }
  return {
    elements: model.elements,
    textureSize: model.texture_size || [16, 16],
    display: model.display || {},
    textures,
  };
}

/**
 * Модели для витрины: по позиции каталога → её модель.
 * items — [{ id, material, modelData }] из описи пака.
 */
async function collect(userDataDir, manifest, logLine) {
  const dir = await ensurePack(userDataDir, manifest.basePack || [], logLine);
  if (!dir) return { ok: false, error: 'пак недоступен' };
  // Как вещь качается в примерочной, задано в редакторе посадки и лежит
  // рядом с моделями отдельным файлом (в сами модели такое класть нельзя —
  // это не часть формата, который читает игра).
  const anims = readJson(path.join(dir, 'assets/mistmc/anims.json')) || {};
  const models = {};
  for (const item of manifest.items || []) {
    const ref = modelRefFor(dir, item.material, item.modelData);
    if (!ref) continue;
    const model = loadModel(dir, ref);
    if (!model) continue;
    if (anims[item.id]) model.anims = anims[item.id];
    models[item.id] = model;
  }
  return { ok: true, models };
}

/**
 * Имитация надетых элитр для примерочной: два крыла-пластины, UV — зона элитр
 * холста плаща (лицевая грань 48..68×4..44, задняя 72..92×4..44 при 128×64).
 * Геометрии настоящих элитр в паке нет (её рисует клиент), поэтому собираем
 * похожую руками; посадка — как у cape_template, чтобы висело на спине.
 *
 * Поза — ванильная СЛОЖЕННАЯ (игрок стоит): в ElytraModel каждое крыло шириной
 * почти во всю спину, шарнир у своего плеча, наклон ±15° к центру — пластины
 * перекрываются, кончики перехлёстываются внизу. Раньше предпросмотр раскрывал
 * крылья «бабочкой» от шеи (поза полёта) — игрок рисовал под одну картинку,
 * а в игре стоя видел другую («в лаунчере одно, в игре другое»).
 */
function elytraPreviewModel() {
  const front = [6, 1, 8.5, 11];    // px * 16 / размер холста
  const back = [9, 1, 11.5, 11];
  const mirror = ([x1, y1, x2, y2]) => [x2, y1, x1, y2];
  const wing = (z0, originX, angle, southUv, northUv) => ({
    from: [3, -2, z0],
    to: [13, 18, z0 + 1],
    rotation: { angle, axis: 'z', origin: [originX, 18, z0 + 0.5] },
    faces: {
      south: { uv: southUv, texture: '#0' },
      north: { uv: northUv, texture: '#0' },
    },
  });
  return {
    texture_size: [128, 64],
    textures: {},
    display: { head: { translation: [0, -65, 9.25], scale: [1.6, 1.6, 1.6] } },
    elements: [
      wing(4.7, 13, 15, front, back),                  // правое: шарнир у правого плеча
      wing(4.5, 3, -15, mirror(front), mirror(back)),  // левое — зеркалом, чуть глубже
    ],
  };
}

/** Модель рисованной вещи с ПОДСТАВЛЕННОЙ текстурой (то, что нарисовал игрок). */
async function drawnModel(userDataDir, manifest, kind, pngDataUrl, logLine) {
  const dir = await ensurePack(userDataDir, manifest.basePack || [], logLine);
  if (!dir) return null;
  const model = kind === 'elytra'
    ? elytraPreviewModel()
    : loadModel(dir, 'mistmc:item/' + kind + '_template');
  if (!model) return null;
  if (pngDataUrl) {
    for (const key of Object.keys(model.textures)) model.textures[key] = pngDataUrl;
    if (!Object.keys(model.textures).length) model.textures['0'] = pngDataUrl;
  }
  return model;
}

module.exports = { collect, drawnModel, ensurePack };
