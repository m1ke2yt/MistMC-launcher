'use strict';

// Менеджер контента Modrinth: моды / ресурспаки / шейдеры.
// Все сетевые вызовы из main-процесса (undici) — CSP/CORS renderer не мешают.
// Раскладка: моды → <gameDir>/mods (строго под выбранный Fabric/Forge),
// ресурспаки → resourcepacks, шейдеры → shaderpacks (работают через Iris).
// Выключенный файл = <file>.disabled. Реестр — <gameDir>/launcher-mods.json:
//   { user: [{projectId, slug, title, iconUrl, fileName, type, loader, enabled}],
//     bundledDisabled: ["file.jar"] }

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const { fetch, Agent } = require('undici');
const site = require('./site');
const buildSecret = require('./build-secret');

const API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'MistMC-Launcher/1.2.0 (mistmc.gg)';
// Вшитые в сборку Mist MC моды (fabric): ставить их из каталога нельзя —
// вторая копия с другой версией = дубль mod id и краш Fabric-лоадера.
// fabric-api / modmenu / cloth-config (project id с Modrinth).
const BUNDLED_PROJECTS = new Set(['P7dR8mSH', 'mOgUt4GM', '9s6osm5g']);
// Версия Minecraft, под которую собрана полная вшитая сборка (она же версия
// сервера Mist MC). Записи реестра без поля mc поставлены до появления выбора
// версии игры — они под неё. Под остальные версии вшиты только свои моды Mist
// (плащи, друзья — подпапки сборки, см. bundledDirFor), а библиотеки вроде
// fabric-api там ставятся из каталога как обычные моды.
const BUNDLED_MC = '1.21.11';
/** Вшиты ли на этой версии библиотеки сборки (fabric-api, modmenu, cloth-config). */
function bundledApplies(loader, mc) { return loader === 'fabric' && mc === BUNDLED_MC; }

// Версия загрузчика, под которую ставим моды. main.js сообщает её после выбора
// стабильного Fabric Loader (мета Fabric, см. resolveFabricLoader). Нужна, чтобы
// не ставить джарник, который требует лоадер новее нашего: Fabric Language
// Kotlin 1.14 (07.09.2026) хочет fabricloader >=0.19.5 — с прибитым 0.19.3
// игра встречала новичка экраном «Incompatible mods found» прямо после установки.
const loaderVersions = { fabric: null };
function setLoaderVersion(loader, version) { loaderVersions[loader] = version || null; }

// Java, на которой пойдёт игра. Точное значение main.js берёт из version.json
// Mojang; до первого запуска версии хватает правила: 26.x — Java 25, раньше — 21.
const javaMajors = new Map();
function setJavaMajor(mc, major) { if (mc && major) javaMajors.set(mc, Number(major)); }
function javaMajorFor(mc) {
  if (javaMajors.has(mc)) return javaMajors.get(mc);
  return parseInt(String(mc).split('.')[0], 10) >= 26 ? 25 : 21;
}

// Что предоставляет сама игра — те же три встроенных «мода», которые видит
// Fabric Loader. Требование к любому из них в fabric.mod.json невыполнимо
// подбором соседей: такой джарник на выбранной версии просто не запустится.
const ENV_IDS = ['minecraft', 'java', 'fabricloader'];
function envOf(loader, mc) {
  return { minecraft: mc, java: String(javaMajorFor(mc)), fabricloader: loaderVersions[loader] || null };
}
/** Первое невыполненное требование мода к среде: { id, need, have } | null. */
function envMismatch(meta, loader, mc) {
  if (loader !== 'fabric' || !meta || !meta.depends) return null;
  const env = envOf(loader, mc);
  for (const id of ENV_IDS) {
    const need = meta.depends[id];
    if (need === undefined || !env[id]) continue;
    if (!satisfies(env[id], need)) return { id, need: fmtConstraint(need), have: env[id] };
  }
  return null;
}
function describeEnv(mis) {
  if (mis.id === 'minecraft') return 'собран под Minecraft ' + mis.need + ', а выбрана ' + mis.have;
  if (mis.id === 'java') return 'требует Java ' + mis.need + ', а игра идёт на Java ' + mis.have;
  return 'требует Fabric Loader ' + mis.need + ', у нас ' + mis.have;
}

/**
 * То же для джарника, закинутого руками: помимо заявленного в fabric.mod.json
 * проверяем, под какую эпоху игры он собран (см. usesIntermediary). Моды из
 * каталога эту проверку не проходят — их версию игры знает Modrinth.
 */
function fileEnvMismatch(file, meta, loader, mc) {
  const mis = envMismatch(meta, loader, mc);
  if (mis || loader !== 'fabric' || !unobfuscatedMc(mc) || !usesIntermediary(file)) return mis;
  return { id: 'minecraft', need: BUNDLED_MC + ' и старше', have: mc };
}

/** Версии игры, под которые годится запись реестра (заявлены на Modrinth). */
function entryMcSet(e) {
  return Array.isArray(e.gameVersions) && e.gameVersions.length ? e.gameVersions : [e.mc || BUNDLED_MC];
}
/** Паки и шейдеры от версии игры не зависят, моды — строго под свою. */
function entryFitsMc(e, mc) { return (e.type || 'mod') !== 'mod' || entryMcSet(e).includes(mc); }

const agent = new Agent({ connect: { timeout: 10000 }, headersTimeout: 15000, bodyTimeout: 300000 });

// ── доступность Modrinth: прямой доступ + прокси-фолбэк через сайт ──
// У части провайдеров прямой доступ к Modrinth деградирует/висит. Если прямой
// запрос не ответил заголовками за 10с — повторяем через наш прокси и
// «прилипаем» к нему на 5 минут. Пути прокси — в build-secret.js; в сборке
// из исходников их нет, тогда остаётся только прямой доступ.
const DIRECT_HEADER_TIMEOUT = 10_000;
const PROXY_STICKY_MS = 5 * 60_000;
let preferProxyUntil = 0;

function toProxyUrl(url) {
  const { modrinthApi, modrinthCdn } = buildSecret.NET;
  if (!modrinthApi || !modrinthCdn) return url;
  // база с фолбэком: сайт, а если он заблокирован в стране игрока
  // (Украина vs RU IP) — зеркало
  const base = site.baseSync();
  return url
    .replace('https://api.modrinth.com/', base + modrinthApi)
    .replace('https://cdn.modrinth.com/', base + modrinthCdn);
}

// fetch с таймаутом только на ЗАГОЛОВКИ: тело больших файлов не ограничиваем
// (его страхует bodyTimeout агента)
async function fetchHeaderTimeout(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      dispatcher: agent,
      signal: ac.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function robustFetch(url) {
  site.getBase().catch(() => {}); // фоновая проба, чтобы toProxyUrl знал актуальную базу
  const proxied = toProxyUrl(url);
  const useProxyFirst = Date.now() < preferProxyUntil && proxied !== url;
  const order = proxied === url ? [url] : useProxyFirst ? [proxied, url] : [url, proxied];
  let lastErr = null;
  for (const attempt of order) {
    try {
      const res = await fetchHeaderTimeout(attempt, DIRECT_HEADER_TIMEOUT);
      if (res.status >= 500) { lastErr = new Error('HTTP ' + res.status); continue; }
      if (attempt === proxied && proxied !== url) preferProxyUntil = Date.now() + PROXY_STICKY_MS;
      if (attempt === url) preferProxyUntil = 0;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('нет соединения');
}

// ── читерное: скрываем из поиска и не даём поставить ────────────────────
// Паттерны гоняются по slug + названию + описанию (моды-камеры и x-ray любят
// палиться только в описании). Разрешены отдельно: legacyfreecam («Freecam
// (Fair Play)» — камера НЕ проходит сквозь стены) и анти-чит/анти-freecam моды.
const BLOCK_PATTERNS = [
  /x[-_ ]?ray/i,
  /free[-_ ]?cam/i,
  /wall[-_ ]?hack/i,
  /wurst|meteor.?client|baritone|bleach.?hack|aristois|inertia.?client/i,
  /seed.?crack/i,
  /auto.?click|kill.?aura|auto.?fish|elytra.?fly|air.?place|scaffold.?walk/i,
  // именно поисковики руд; «highlight» сюда не включаем — эмиссивные паки
  // светящихся руд (Glowing Ores) читом не являются
  /(ore|diamond|mineral|dungeon|spawner).{0,12}(finder|scanner|detector|locator)/i,
  /cave.?(finder|map.?hack)/i,
];
const ANTI_RE = /anti.?(x[-_ ]?ray|free.?cam|cheat)/i;
const BLOCK_SLUGS = new Set([
  'litematica-printer', // принтер режется античитом Mist MC
  'journeymap', // пещерный режим карты сервером не закрывается — на Mist MC мод запрещён, сервер кикает
]);
// Моды, которые лаунчер выключает перед запуском, даже если игрок закинул
// джарник руками: по fabric-id и по имени файла (forge-сборки без fabric.mod.json).
const BLOCKED_MODS = [
  { ids: new Set(['journeymap']), fileRe: /journeymap/i, label: 'JourneyMap' },
];
const ALLOW_SLUGS = new Set(['legacyfreecam']);

// «Freecam (Fair Play)» с Modrinth на деле собран ОБЫЧНЫМ вариантом мода:
// в его настройках включается «Игнорировать всю коллизию», и камера летает
// сквозь стены (проверено 31.08 на 1.1.1+mc1.21.11 — в джарнике вариант
// «normal», никакой блокировки читов нет). Поэтому Modrinth для этого мода
// не источник: ставим и принудительно поддерживаем нашу сборку, из которой
// вырезаны миксины коллизии (BlockStateBaseMixin) и полной яркости
// (LightTextureMixin) — пункты в меню остаются, но не действуют.
// Признак нашей сборки — файл-маркер mist-fairplay внутри джарника.
const FAIR_FREECAM = {
  projectId: 'tWqI1yhH',
  slug: 'legacyfreecam',
  modIds: new Set(['legacy-freecam', 'freecam']), // ловим и оригинальный freecam, закинутый руками
  fileName: 'legacy-freecam-fabric-1.1.1+mc1.21.11-mist.jar',
  marker: 'mist-fairplay',
  versionId: 'mist-fairplay-1',
  versionNumber: '1.1.1-mist',
};
function fairFreecamUrl() {
  if (!site.MIRROR_DOWNLOADS) throw new Error('в сборке из исходников недоступно');
  return site.MIRROR_DOWNLOADS + '/mods/' + encodeURIComponent(FAIR_FREECAM.fileName);
}
function isBlocked(text, slug) {
  if (ALLOW_SLUGS.has(slug)) return false;
  if (BLOCK_SLUGS.has(slug)) return true;
  if (ANTI_RE.test(text)) return false; // защитные моды («Anti Xray», «Anti Freecam»)
  return BLOCK_PATTERNS.some((re) => re.test(text));
}

// ── типы контента ───────────────────────────────────────────────────────
const TYPES = {
  mod: { projectType: 'mod', dir: 'mods', perLoader: true },
  resourcepack: { projectType: 'resourcepack', dir: 'resourcepacks', perLoader: false },
  shader: { projectType: 'shader', dir: 'shaderpacks', perLoader: false },
};
function typeInfo(type) {
  return TYPES[type] || TYPES.mod;
}

// ── кураторские подборки с русскими описаниями ─────────────────────────
// Вшитые в сборку Mist MC (fabric-api, modmenu, cloth-config, ABP) не включаем.
const CURATED = {
  mod: [
    { slug: 'sodium', ru: 'Оптимизация рендера — заметно больше FPS' },
    { slug: 'lithium', ru: 'Оптимизация игровой логики — меньше лагов' },
    { slug: 'iris', ru: 'Шейдеры как в OptiFine — нужен для вкладки «Шейдеры»' },
    { slug: 'entityculling', ru: 'Не рисует мобов за стенами — ещё больше FPS' },
    { slug: 'ferrite-core', ru: 'Снижает расход оперативной памяти' },
    // из голосовых рекомендуем ровно один — SVC (решение 31.07): две системы
    // в подборке путали игроков, ставили обе и не понимали, где их слышно
    { slug: 'simple-voice-chat', ru: 'Голосовой чат SVC — работает на Mist MC' },
    { slug: 'xaeros-minimap', ru: 'Миникарта (радар игроков на Mist MC отключён сервером)' },
    { slug: 'xaeros-world-map', ru: 'Полная карта мира — дополнение к миникарте Xaero' },
    { slug: 'clientsort', ru: 'Сортировка инвентаря колёсиком/клавишей' },
    { slug: 'emotecraft', ru: 'Жесты и эмоции — поддерживается на Mist MC' },
    { slug: 'bendable-cuboids', ru: 'Сгибы конечностей для эмоций Emotecraft' },
    { slug: 'legacyfreecam', ru: 'Свободная камера Fair Play — сквозь стены НЕ пролетает' },
    { slug: 'lambdynamiclights', ru: 'Динамический свет: факел светит в руке' },
    { slug: 'litematica', ru: 'Схематика построек: проекция блоков для строительства' },
    { slug: 'patpat', ru: 'Гладь игроков и питомцев по голове (ПКМ + shift)' },
    { slug: 'online-patpat', ru: 'PatPat работает с другими игроками на сервере' },
    { slug: 'zoomify', ru: 'Зум на клавишу, как в OptiFine' },
    { slug: 'cameraoverhaul', ru: 'Плавные наклоны камеры при движении — приятнее ощущается игра' },
    { slug: 'appleskin', ru: 'Показывает сытость и питательность еды' },
    { slug: 'mouse-tweaks', ru: 'Удобное перетаскивание предметов мышью' },
    { slug: 'shulkerboxtooltip', ru: 'Содержимое шалкера видно прямо в подсказке' },
    { slug: 'continuity', ru: 'Соединённые текстуры стекла и блоков' },
    { slug: '3dskinlayers', ru: 'Объёмные слои скина — шапки и куртки в 3D' },
    { slug: 'not-enough-animations', ru: 'Реалистичные анимации от третьего лица' },
    { slug: 'wavey-capes', ru: 'Плащ красиво развевается волнами' },
  ],
  shader: [
    { slug: 'complementary-reimagined', ru: 'Золотой стандарт: красиво и быстро' },
    { slug: 'complementary-unbound', ru: 'Реалистичный свет и тени' },
    { slug: 'bsl-shaders', ru: 'Классика — мягкий тёплый свет' },
    { slug: 'photon-shader', ru: 'Реалистичная картинка, ясное небо' },
    { slug: 'makeup-ultra-fast-shaders', ru: 'Очень лёгкие — для слабых ПК' },
    { slug: 'solas-shader', ru: 'Стилизованные, сказочная атмосфера' },
  ],
  resourcepack: [
    { slug: 'faithful-32x', ru: 'Ванильные текстуры в HD (32×)' },
    { slug: 'fresh-animations', ru: 'Живые анимации мобов (нужны моды ETF + EMF)' },
    { slug: 'bare-bones', ru: 'Минимализм как в трейлерах Minecraft' },
    { slug: 'motschen-better-leaves', ru: 'Пышная объёмная листва' },
  ],
};
const CURATED_RU = new Map(
  Object.values(CURATED).flat().map((c) => [c.slug, c.ru]),
);

async function apiGet(url) {
  // до 3 раундов (каждый раунд = прямой + прокси): Modrinth периодически
  // отдаёт 5xx/таймауты со своей стороны — короткий ретрай часто спасает
  let lastErr = null;
  for (let round = 0; round < 3; round++) {
    if (round) await new Promise((r) => setTimeout(r, 1500 * round));
    try {
      const res = await robustFetch(url);
      if (res.ok) return res.json();
      lastErr = new Error('Modrinth HTTP ' + res.status);
      if (res.status < 500 && res.status !== 429) break; // 4xx ретраить смысла нет
    } catch (e) {
      lastErr = e && e.name === 'AbortError' ? new Error('Modrinth не отвечает (таймаут)') : e;
    }
  }
  throw lastErr || new Error('Modrinth недоступен');
}

// ── реестр ──────────────────────────────────────────────────────────────
function manifestPath(gameDir) {
  return path.join(gameDir, 'launcher-mods.json');
}
function readManifest(gameDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath(gameDir), 'utf8'));
    const user = (Array.isArray(raw.user) ? raw.user : []).map((e) => ({ type: 'mod', ...e }));
    return {
      user,
      bundledDisabled: Array.isArray(raw.bundledDisabled) ? raw.bundledDisabled : [],
    };
  } catch (_) {
    return { user: [], bundledDisabled: [] };
  }
}
function writeManifest(gameDir, m) {
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(manifestPath(gameDir), JSON.stringify(m, null, 2));
}

function contentDir(gameDir, type) {
  return path.join(gameDir, typeInfo(type).dir);
}
function filePathOf(gameDir, entry) {
  return path.join(contentDir(gameDir, entry.type), entry.fileName);
}

// ── список для UI ───────────────────────────────────────────────────────
function bundledJars(bundledDir) {
  try {
    return fs.readdirSync(bundledDir).filter((f) => f.toLowerCase().endsWith('.jar'));
  } catch (_) {
    return [];
  }
}

// Папку вшитой сборки сообщают вызовы из main.js; резолверу она нужна, чтобы
// не трогать вшитые джарники и знать, какие из них игрок выключил.
let bundledDirSeen = null;

/**
 * Папка вшитых модов под версию игры: корень — под версию сервера, подпапки
 * 26.1 / 26.2 / 26.3 — свои моды Mist под остальные (26.1.1 и 26.1.2 берут
 * папку своей серии 26.1). null — под эту версию ничего не вшито.
 */
function bundledDirFor(baseDir, mc) {
  if (!baseDir) return null;
  if (mc === BUNDLED_MC) return baseDir;
  const series = String(mc).split('.').slice(0, 2).join('.');
  for (const key of [mc, series]) {
    const dir = path.join(baseDir, key);
    if (bundledJars(dir).length) return dir;
  }
  return null;
}
/** Вшитые джарники для загрузчика и версии игры: { dir, jars }. */
function bundledFor(baseDir, loader, mc) {
  const dir = loader === 'fabric' ? bundledDirFor(baseDir, mc) : null;
  return { dir, jars: dir ? bundledJars(dir) : [] };
}
/** Все вшитые джарники всех версий: имя → папка (имена между версиями не повторяются). */
function allBundled(baseDir) {
  const out = new Map();
  if (!baseDir) return out;
  for (const f of bundledJars(baseDir)) out.set(f, baseDir);
  try {
    for (const d of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of bundledJars(path.join(baseDir, d.name))) out.set(f, path.join(baseDir, d.name));
    }
  } catch (_) { /* папки сборки нет (dev без ресурсов) */ }
  return out;
}
/** Есть ли под эту версию игры вшитые моды Mist. */
function hasBundled(baseDir, mc) { return bundledFor(baseDir, 'fabric', mc).jars.length > 0; }

function listContent(gameDir, type, loader, bundledDir, mc = BUNDLED_MC) {
  bundledDirSeen = bundledDir;
  const m = readManifest(gameDir);
  const bundled = type === 'mod'
    ? bundledFor(bundledDir, loader, mc).jars.map((f) => ({
        fileName: f,
        title: f.replace(/\.jar$/i, ''),
        enabled: !m.bundledDisabled.includes(f),
      }))
    : [];
  // подчистка: записи, чьи файлы удалили руками (или доудалило отложенное)
  const alive = m.user.filter((e) =>
    entryFileVariants(gameDir, e).some((p) => fs.existsSync(p)));
  if (alive.length !== m.user.length) {
    m.user = alive;
    writeManifest(gameDir, m);
  }
  // моды отдаём ВСЕ (и чужого загрузчика, и под другую версию игры) —
  // renderer покажет их приглушённо с пометкой, чтобы смена сборки или версии
  // не выглядела как «моды удалились»;
  // ожидающие удаления (pendingRemove) для UI уже не существуют
  return {
    bundled,
    user: alive.filter((e) => e.type === type && !e.pendingRemove)
      .map((e) => ({ ...e, otherMc: !entryFitsMc(e, mc), forMc: e.mc || BUNDLED_MC })),
  };
}

// ── поиск ───────────────────────────────────────────────────────────────
function hitToItem(h) {
  return {
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: CURATED_RU.get(h.slug) || h.description || '',
    iconUrl: h.icon_url || '',
    downloads: h.downloads || 0,
  };
}

async function searchContent(query, type, loader, mcVersion) {
  const t = typeInfo(type);
  // версийный фасет — только для модов: паки/шейдеры кроссверсионные и редко
  // декларируют новейшую MC (поиск «Glowing» отдавал пусто именно из-за этого)
  const facets = [['project_type:' + t.projectType]];
  if (type === 'mod') facets.push(['versions:' + mcVersion], ['categories:' + loader]);
  if (type === 'shader') facets.push(['categories:iris']);
  const url = API + '/search?limit=20&query=' + encodeURIComponent(query || '')
    + '&facets=' + encodeURIComponent(JSON.stringify(facets))
    + (query ? '' : '&index=downloads');
  const data = await apiGet(url);
  return (data.hits || [])
    .filter((h) => !isBlocked([h.slug, h.title, h.description].join(' '), h.slug))
    .map(hitToItem);
}

// ── популярные (кураторские подборки) ───────────────────────────────────
const curatedCache = new Map(); // type -> ответ /projects
async function popularContent(type, loader, mcVersion) {
  const listDef = CURATED[type] || [];
  if (!listDef.length) return [];
  if (!curatedCache.has(type)) {
    const ids = encodeURIComponent(JSON.stringify(listDef.map((c) => c.slug)));
    curatedCache.set(type, await apiGet(API + '/projects?ids=' + ids));
  }
  const bySlug = new Map(curatedCache.get(type).map((p) => [p.slug, p]));
  const out = [];
  for (const c of listDef) {
    const p = bySlug.get(c.slug);
    if (!p) continue;
    if (type === 'mod' && !(p.loaders || []).includes(loader)) continue;
    // строгая проверка версии — только модам; паки/шейдеры кроссверсионные
    if (type === 'mod' && !(p.game_versions || []).includes(mcVersion)) continue;
    out.push({
      projectId: p.id,
      slug: p.slug,
      title: p.title,
      description: c.ru,
      iconUrl: p.icon_url || '',
      downloads: p.downloads || 0,
    });
  }
  return out;
}

// ── страница проекта (модалка в лаунчере) ───────────────────────────────
// Полная карточка с Modrinth: описание (markdown body) + галерея скриншотов.
// Кэшируем на сессию — повторное открытие модалки мгновенное.
const detailsCache = new Map(); // idOrSlug -> project
async function projectDetails(idOrSlug) {
  if (detailsCache.has(idOrSlug)) return detailsCache.get(idOrSlug);
  const p = await apiGet(API + '/project/' + encodeURIComponent(idOrSlug));
  const gallery = (Array.isArray(p.gallery) ? p.gallery : [])
    .filter((g) => g && typeof g.url === 'string' && /^https:\/\//i.test(g.url))
    .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (a.ordering || 0) - (b.ordering || 0))
    .slice(0, 12)
    .map((g) => ({ url: g.url, title: g.title || '' }));
  const out = {
    projectId: p.id,
    slug: p.slug,
    title: p.title || p.slug,
    description: CURATED_RU.get(p.slug) || p.description || '',
    body: p.body || '',
    iconUrl: p.icon_url || '',
    downloads: p.downloads || 0,
    followers: p.followers || 0,
    gallery,
    // под какие версии игры и загрузчики проект вообще выходил — карточка
    // объясняет по ним, почему под выбранную версию ставить нечего
    gameVersions: Array.isArray(p.game_versions) ? p.game_versions : [],
    loaders: Array.isArray(p.loaders) ? p.loaders : [],
  };
  detailsCache.set(idOrSlug, out);
  return out;
}

// ── установка (с обязательными зависимостями) ───────────────────────────
function versionLoaders(type, loader) {
  if (type === 'resourcepack') return ['minecraft'];
  if (type === 'shader') return ['iris'];
  return [loader];
}

async function pickVersion(projectId, type, loader, mcVersion, pinnedVersionId) {
  // Пин зависимости важнее «новейшей»: моды вроде Iris требуют КОНКРЕТНУЮ
  // версию Sodium — свежее ломает игру (проверено: iris 1.10.7 ⇄ sodium 0.8.7).
  if (pinnedVersionId) {
    try {
      const v = await apiGet(API + '/version/' + encodeURIComponent(pinnedVersionId));
      // пин от другого мода может указывать на сборку под чужую версию игры —
      // такую не берём, иначе джарник не запустится на выбранной
      if (type !== 'mod' || !Array.isArray(v.game_versions) || v.game_versions.includes(mcVersion)) return v;
    } catch (_) { /* пин протух — падаем на обычный выбор */ }
  }
  const base = API + '/project/' + encodeURIComponent(projectId) + '/version'
    + '?loaders=' + encodeURIComponent(JSON.stringify(versionLoaders(type, loader)));
  let versions = await apiGet(base + '&game_versions=' + encodeURIComponent(JSON.stringify([mcVersion])));
  // паки/шейдеры часто не указывают свежую версию MC — они кроссверсионные
  if ((!Array.isArray(versions) || !versions.length) && type !== 'mod') {
    versions = await apiGet(base);
  }
  if (!Array.isArray(versions) || !versions.length) return null;
  // API отдаёт от новых к старым. Берём свежую СТАБИЛЬНУЮ: иначе игрокам
  // прилетали беты (Sodium 0.8.14-beta.1 вместо 0.8.13). Если релиза под
  // эту версию MC нет вовсе — ставим что есть.
  return versions.find((v) => v.version_type === 'release') || versions[0];
}

/** Пин на этот проект от уже установленных модов (совместимость по manifest.depPins). */
function pinFromInstalled(m, projectId, loader, mc) {
  for (const e of m.user) {
    if (e.type !== 'mod' || e.loader !== loader || !entryFitsMc(e, mc)) continue;
    const pin = e.depPins && e.depPins[projectId];
    if (pin) return { versionId: pin, by: e.title };
  }
  return null;
}

async function downloadTo(url, dest, log) {
  const res = await robustFetch(url);
  if (!res.ok) throw new Error('скачивание HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  log('  ↓ ' + path.basename(dest) + ' (' + Math.round(buf.length / 1024) + ' КБ)');
}

// Джарники, скачанные ради чтения fabric.mod.json (проверка совместимости в
// карточке, подбор версий резолвером), держим на диске: если эту же версию
// потом ставят, второй раз её не качаем. Старше шести часов — выметаем.
const JAR_CACHE_DIR = path.join(os.tmpdir(), 'mistmc-jarcache');
const JAR_CACHE_TTL = 6 * 3600e3;
function jarCachePath(versionId) {
  return path.join(JAR_CACHE_DIR, String(versionId).replace(/[^A-Za-z0-9_-]/g, '_') + '.jar');
}
function pruneJarCache() {
  try {
    for (const f of fs.readdirSync(JAR_CACHE_DIR)) {
      const p = path.join(JAR_CACHE_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > JAR_CACHE_TTL) fs.unlinkSync(p);
    }
  } catch (_) { /* папки ещё нет */ }
}
pruneJarCache();

/** Файл версии Modrinth в папку игры: из кэша проверок, если он там цел. */
async function fetchVersionFile(version, file, dest, log) {
  const cached = jarCachePath(version.id);
  try {
    if (file.primary !== false && file.size && fs.statSync(cached).size === file.size) {
      fs.copyFileSync(cached, dest);
      log('  ↓ ' + path.basename(dest) + ' (' + Math.round(file.size / 1024) + ' КБ)');
      return;
    }
  } catch (_) { /* в кэше нет — качаем */ }
  await downloadTo(file.url, dest, log);
}

async function installContent(gameDir, project, type, loader, mcVersion, log, depth = 0, pinnedVersionId = null, opts = {}) {
  if (isBlocked([project.slug, project.title, project.description].filter(Boolean).join(' '), project.slug)) {
    return { ok: false, error: 'Этот мод запрещён на Mist MC' };
  }
  // вшитый в сборку мод уже стоит — вторая копия уронит Fabric
  if (type === 'mod' && bundledApplies(loader, mcVersion) && BUNDLED_PROJECTS.has(project.projectId)) {
    return { ok: true, already: true };
  }
  const t = typeInfo(type);
  const m = readManifest(gameDir);

  // одна запись на мод в пределах версии игры: тот же мод под другую версию
  // лежит отдельной записью и ждёт, пока игрок на неё вернётся
  const sameSlot = (e) => e.projectId === project.projectId && e.type === type
      && (!t.perLoader || e.loader === loader) && !e.pendingRemove;
  const existing = m.user.find((e) => sameSlot(e) && entryFitsMc(e, mcVersion));

  // freecam ставится ТОЛЬКО нашей сборкой (см. FAIR_FREECAM) — пины и версии
  // Modrinth к нему неприменимы
  if (type === 'mod' && (project.slug === FAIR_FREECAM.slug || project.projectId === FAIR_FREECAM.projectId)) {
    if (loader !== 'fabric') return { ok: false, error: 'Нет сборки под ' + mcVersion + ' / ' + loader };
    // честная сборка собрана под версию сервера; под другие её нет
    if (mcVersion !== BUNDLED_MC) {
      return { ok: false, error: 'Честная сборка Freecam есть только под ' + BUNDLED_MC };
    }
    if (existing && existing.versionId === FAIR_FREECAM.versionId) return { ok: true, already: true };
    if (existing) {
      log('  ⟳ ' + existing.title + ': ' + (existing.versionNumber || '?') + ' → ' + FAIR_FREECAM.versionNumber);
      removeUserContent(gameDir, 'mod', existing.fileName);
    }
    fs.mkdirSync(contentDir(gameDir, 'mod'), { recursive: true });
    await downloadTo(fairFreecamUrl(), path.join(contentDir(gameDir, 'mod'), FAIR_FREECAM.fileName), log);
    const withCam = readManifest(gameDir);
    withCam.user.push({
      projectId: FAIR_FREECAM.projectId,
      slug: FAIR_FREECAM.slug,
      title: project.title || 'Freecam (Fair Play)',
      iconUrl: project.iconUrl || '',
      fileName: FAIR_FREECAM.fileName,
      type: 'mod',
      loader,
      enabled: true,
      versionNumber: FAIR_FREECAM.versionNumber,
      versionId: FAIR_FREECAM.versionId,
      mc: BUNDLED_MC,
    });
    writeManifest(gameDir, withCam);
    log('✓ Установлен ' + (project.title || 'Freecam (Fair Play)') + ' — сборка Mist MC, пролёт сквозь стены вырезан');
    return { ok: true };
  }

  // pinnedVersionId приходит от enforceJarDeps — это АВТОРИТЕТ (посчитан по
  // fabric.mod.json всех установленных модов), выполняем даже заменой стоящей
  // версии. Пин Modrinth («с чем тестировали») — МЯГКИЙ: только при первой
  // установке. Раньше он применялся всегда и утаскивал уже стоящий мод назад:
  // Iris пинил Sodium 0.8.7 поверх 0.8.13, и Sodium Extra (>=0.8.13) падал.
  let pin = pinnedVersionId;
  if (!pin && !existing && type === 'mod') {
    const found = pinFromInstalled(m, project.projectId, loader, mcVersion);
    if (found) {
      pin = found.versionId;
      log('  ⚑ версия закреплена модом ' + found.by + ' (совместимость)');
    }
  }

  if (existing && (!pinnedVersionId || existing.versionId === pinnedVersionId)) {
    return { ok: true, already: true };
  }

  let version = await pickVersion(project.projectId, type, loader, mcVersion, pin);
  if (!version) {
    return { ok: false, error: 'Нет сборки под ' + mcVersion + (type === 'mod' ? ' / ' + loader : '') };
  }
  if (existing && existing.versionId === version.id) {
    return { ok: true, already: true };
  }
  let file = (version.files || []).find((f) => f.primary) || (version.files || [])[0];
  if (!file) return { ok: false, error: 'У версии нет файлов' };

  // замена несовместимой версии: сносим старый файл и запись
  if (existing) {
    log('  ⟳ ' + existing.title + ': ' + (existing.versionNumber || '?') + ' → ' + (version.version_number || '?'));
    removeUserContent(gameDir, type, existing.fileName);
  }

  // Записи того же мода под версии игры, которые новая сборка покрывает сама,
  // больше не нужны: иначе при возврате на ту версию в mods оказались бы два
  // джарника одного мода (Fabric на таком не стартует).
  if (type === 'mod') {
    const covers = Array.isArray(version.game_versions) && version.game_versions.length
      ? version.game_versions : [mcVersion];
    for (const old of readManifest(gameDir).user) {
      if (!sameSlot(old) || !entryMcSet(old).every((v) => covers.includes(v))) continue;
      removeUserContent(gameDir, type, old.fileName);
    }
  }

  fs.mkdirSync(contentDir(gameDir, type), { recursive: true });
  const safeName = (f) => path.basename(f.filename).replace(/[\\/:*?"<>|]/g, '_');
  let fileName = safeName(file);
  await fetchVersionFile(version, file, path.join(contentDir(gameDir, type), fileName), log);

  // Требования к среде (Modrinth-deps их не знают, только fabric.mod.json):
  // свежий релиз может хотеть лоадер новее нашего, а сборка, заявленная на
  // Modrinth под нашу версию игры, внутри бывает собрана под соседнюю. Тогда
  // берём последнюю версию, которая реально запустится, а не роняем игру.
  if (type === 'mod' && loader === 'fabric') {
    const meta = fabricModInfo(path.join(contentDir(gameDir, type), fileName));
    const mis = envMismatch(meta, loader, mcVersion);
    if (mis) {
      log('  ⚑ ' + (project.title || fileName) + ' ' + (version.version_number || '') + ' ' + describeEnv(mis)
        + ' — ищу подходящую версию');
      try { fs.unlinkSync(path.join(contentDir(gameDir, type), fileName)); } catch (_) { /* уже нет */ }
      const alt = await pickVersionForEnv(project.projectId, loader, mcVersion, version.id);
      const altFile = alt && ((alt.files || []).find((f) => f.primary) || (alt.files || [])[0]);
      if (!alt || !altFile) {
        return {
          ok: false,
          error: mis.id === 'fabricloader'
            ? 'Мод требует Fabric Loader ' + mis.need + ' — обновите лаунчер'
            : mis.id === 'java'
              ? 'Мод требует Java ' + mis.need + ' — на Minecraft ' + mcVersion + ' он не запустится'
              : 'У мода нет сборки, которая запустится на Minecraft ' + mcVersion,
        };
      }
      log('  → ' + (project.title || fileName) + ': ' + (version.version_number || '?') + ' → ' + (alt.version_number || '?'));
      version = alt;
      file = altFile;
      fileName = safeName(file);
      await fetchVersionFile(version, file, path.join(contentDir(gameDir, type), fileName), log);
    }
  }

  // пины этой версии на другие проекты — пригодятся при будущих установках
  const depPins = {};
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id && dep.version_id) {
      depPins[dep.project_id] = dep.version_id;
    }
  }

  const fresh = readManifest(gameDir);
  fresh.user.push({
    projectId: project.projectId,
    slug: project.slug || project.projectId,
    title: project.title || project.slug || fileName,
    iconUrl: project.iconUrl || '',
    fileName,
    type,
    loader: t.perLoader ? loader : null,
    enabled: true,
    versionNumber: version.version_number || '',
    versionId: version.id,
    depPins: Object.keys(depPins).length ? depPins : undefined,
    // под какую версию игры ставили и какие ещё эта сборка заявляет
    mc: mcVersion,
    gameVersions: type === 'mod' && Array.isArray(version.game_versions) && version.game_versions.length
      ? version.game_versions : undefined,
    // версию выбрал сам игрок — резолвер подстраивает под неё соседей, а не её
    userPin: opts.userPin ? true : undefined,
  });
  writeManifest(gameDir, fresh);
  log('✓ Установлен ' + (project.title || fileName) + ' ' + (version.version_number || ''));

  // обязательные зависимости — только у модов (fabric-api вшит, пропускаем)
  if (type === 'mod' && depth < 4) {
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      if (bundledApplies(loader, mcVersion) && BUNDLED_PROJECTS.has(dep.project_id)) continue;
      const cur = readManifest(gameDir);
      const have = cur.user.find((e) => e.projectId === dep.project_id && e.type === 'mod' && e.loader === loader
        && !e.pendingRemove && entryFitsMc(e, mcVersion));
      // зависимость уже стоит — версию не навязываем: пин Modrinth мягкий,
      // а реальные требования разрулит enforceJarDeps по fabric.mod.json
      if (have) continue;
      try {
        const info = await apiGet(API + '/project/' + dep.project_id);
        log('  + зависимость: ' + info.title + (dep.version_id ? ' (закреплённая версия)' : ''));
        await installContent(gameDir, {
          projectId: dep.project_id,
          slug: info.slug,
          title: info.title,
          iconUrl: info.icon_url || '',
        }, 'mod', loader, mcVersion, log, depth + 1, dep.version_id || null);
      } catch (e) {
        log('  ! зависимость ' + dep.project_id + ' не установилась: ' + e.message);
      }
    }
  }
  // жёсткие требования из fabric.mod.json (Modrinth-deps их не знают):
  // только на верхнем уровне — enforceJarDeps сам ставит версии с depth 4
  if (depth === 0 && type === 'mod') {
    try { await enforceJarDeps(gameDir, loader, mcVersion, log); } catch (_) { /* сеть */ }
  }
  return { ok: true };
}

// ── тумблер / удаление ─────────────────────────────────────────────────
function findEntry(m, type, fileName) {
  return m.user.find((e) => e.type === type && e.fileName === fileName);
}

function toggleUserContent(gameDir, type, fileName, enabled) {
  const m = readManifest(gameDir);
  const entry = findEntry(m, type, fileName);
  if (!entry) return { ok: false, error: 'Не найдено' };
  const on = filePathOf(gameDir, entry);
  const off = on + '.disabled';
  try {
    if (enabled && fs.existsSync(off) && !fs.existsSync(on)) fs.renameSync(off, on);
    if (!enabled && fs.existsSync(on)) fs.renameSync(on, off);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  entry.enabled = !!enabled;
  delete entry.autoOff; // решение игрока важнее автоматического выключения
  writeManifest(gameDir, m);
  return { ok: true };
}

function toggleBundledMod(gameDir, fileName, enabled) {
  const m = readManifest(gameDir);
  m.bundledDisabled = m.bundledDisabled.filter((f) => f !== fileName);
  if (!enabled) m.bundledDisabled.push(fileName);
  const p = path.join(contentDir(gameDir, 'mod'), fileName);
  try {
    if (!enabled && fs.existsSync(p)) fs.unlinkSync(p);
    // включили обратно — джарник кладём сразу, а не при запуске: иначе до
    // запуска подсказки считали бы зависящие от него моды сломанными
    const srcDir = allBundled(bundledDirSeen).get(path.basename(fileName));
    const src = srcDir && path.join(srcDir, path.basename(fileName));
    if (enabled && src && fs.existsSync(src) && !fs.existsSync(p)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.copyFileSync(src, p);
    }
  } catch (_) { /* займётся syncMods */ }
  writeManifest(gameDir, m);
  return { ok: true };
}

/** Все варианты файла записи (вкл. .disabled2 — след syncMods при коллизии). */
function entryFileVariants(gameDir, entry) {
  const base = filePathOf(gameDir, entry);
  return [base, base + '.disabled', base + '.disabled2'];
}

/** Удалить файлы записи; false — какой-то занят (игра держит jar открытым). */
function tryDeleteEntryFiles(gameDir, entry) {
  let allGone = true;
  for (const p of entryFileVariants(gameDir, entry)) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {
      allGone = false; // занят (Windows не удаляет открытые jar при живой игре)
    }
  }
  return allGone;
}

function removeUserContent(gameDir, type, fileName) {
  const m = readManifest(gameDir);
  const entry = findEntry(m, type, fileName);
  if (!entry) return { ok: false, error: 'Не найдено' };
  if (tryDeleteEntryFiles(gameDir, entry)) {
    m.user = m.user.filter((e) => e !== entry);
    writeManifest(gameDir, m);
    return { ok: true };
  }
  // Файл занят (игра запущена). РАНЬШЕ запись молча выкидывалась из манифеста,
  // а jar оставался в mods/ навсегда — «удалил, а мод не удалился». Теперь:
  // помечаем pendingRemove (из списка UI пропадает), а syncMods доудалит файл
  // перед СЛЕДУЮЩИМ запуском игры — там jar гарантированно свободен.
  entry.pendingRemove = true;
  entry.enabled = false;
  writeManifest(gameDir, m);
  return { ok: true, pending: true };
}

// ── жёсткие зависимости из fabric.mod.json ──────────────────────────────
// Modrinth-метаданные знают не всё: у Replay Voice Chat требование
// «replaymod = 2.6.25» записано ТОЛЬКО в fabric.mod.json внутри jar (в deps
// на Modrinth его нет вовсе) — юзер ставил Replay Mod отдельно, получал
// свежайший 2.6.27, и Fabric падал «Incompatible mods found». Поэтому после
// каждой установки и перед запуском читаем fabric.mod.json активных модов и
// приводим установленные версии под ТОЧНЫЕ требования (диапазоны >=/~/^ не
// трогаем — их удовлетворяет свежая версия).

/** Достаёт один файл из zip/jar без внешних библиотек (центральная
 * директория → локальный заголовок → inflateRaw). null — файла нет/битый. */
function readZipEntry(file, wantName) {
  return readZipEntryBuf(fs.readFileSync(file), wantName);
}
/** То же по содержимому в памяти — так читаются джарники, вложенные в джарник. */
function readZipEntryBuf(buf, wantName) {
  // EOCD (PK\x05\x06) ищем с конца (комментарий до 64 КБ)
  let eocd = -1;
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // смещение центральной директории
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wantName) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(lho + 26);
      const lExtraLen = buf.readUInt16LE(lho + 28);
      const start = lho + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + csize);
      try {
        return method === 8 ? require('zlib').inflateRawSync(data)
          : method === 0 ? Buffer.from(data) : null;
      } catch (_) { return null; }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/**
 * Собран ли джарник под обфусцированную игру (до Minecraft 26.1). Такие моды
 * ссылаются на классы игры по промежуточным именам (net/minecraft/class_1234),
 * которых в 26.x уже нет: Fabric их загрузит, а игра упадёт. По fabric.mod.json
 * это не видно — у половины модов требование к игре открытое («>=1.21.9») или
 * не указано вовсе, поэтому смотрим в сами классы (первые несколько десятков).
 */
const legacyCache = new Map();
function usesIntermediary(file) {
  let key;
  try {
    const st = fs.statSync(file);
    key = file + '|' + st.size + '|' + st.mtimeMs;
  } catch (_) { return false; }
  if (legacyCache.has(key)) return legacyCache.get(key);
  let found = false;
  try {
    const buf = fs.readFileSync(file);
    let eocd = -1;
    const from = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= from; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    const count = eocd < 0 ? 0 : buf.readUInt16LE(eocd + 10);
    let p = eocd < 0 ? 0 : buf.readUInt32LE(eocd + 16);
    const needle = Buffer.from('net/minecraft/class_');
    let classes = 0;
    let bytes = 0;
    for (let n = 0; n < count && p + 46 <= buf.length && !found; n++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) break;
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const lho = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
      if (!name.endsWith('.class') || (method !== 8 && method !== 0)) continue;
      if (classes >= 80 || bytes > 4 * 1024 * 1024) break;
      if (buf.readUInt32LE(lho) !== 0x04034b50) continue;
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      let body;
      try { body = method === 8 ? zlib.inflateRawSync(data) : data; } catch (_) { continue; }
      classes++;
      bytes += body.length;
      if (body.indexOf(needle) >= 0) found = true;
    }
  } catch (_) { found = false; }
  if (legacyCache.size > 400) legacyCache.clear();
  legacyCache.set(key, found);
  return found;
}
/** Minecraft с открытыми именами классов (26.1 и новее). */
function unobfuscatedMc(mc) { return parseInt(String(mc).split('.')[0], 10) >= 26; }

/**
 * fabric.mod.json джарника (null — не фабрик-мод):
 * { id, name, version, depends, breaks, conflicts, provides, environment, nested }.
 * nested — моды из вложенных джарников (jar-in-jar) вместе с их псевдонимами:
 * Fabric грузит их наравне с обычными, и зависимость на «fabric-resource-loader-v0»
 * закрывает именно такой вложенный модуль fabric-api.
 */
const modInfoCache = new Map();
function fabricModInfo(file) {
  try {
    const st = fs.statSync(file);
    const key = file + '|' + st.size + '|' + st.mtimeMs;
    if (modInfoCache.has(key)) return modInfoCache.get(key);
    const info = fabricInfoFromBuf(fs.readFileSync(file), 0);
    if (modInfoCache.size > 400) modInfoCache.clear();
    modInfoCache.set(key, info);
    return info;
  } catch (_) { return null; }
}
function fabricInfoFromBuf(buf, depth) {
  try {
    const raw = readZipEntryBuf(buf, 'fabric.mod.json');
    if (!raw) return null;
    const j = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''));
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    const info = {
      id: j.id,
      name: typeof j.name === 'string' ? j.name : '',
      version: String(j.version || ''),
      depends: obj(j.depends),
      // breaks — жёсткая несовместимость («Incompatible mods found» на старте).
      // Именно её объявляет Sodium: 0.8.13 breaks iris <=1.10.7.
      breaks: obj(j.breaks),
      // conflicts — мягкая: игра запустится, но автор предупреждает о проблемах
      conflicts: obj(j.conflicts),
      provides: (Array.isArray(j.provides) ? j.provides : []).filter((p) => typeof p === 'string'),
      environment: typeof j.environment === 'string' ? j.environment : '*',
      nested: [],
    };
    if (depth < 3) {
      for (const n of Array.isArray(j.jars) ? j.jars : []) {
        if (!n || typeof n.file !== 'string') continue;
        const inner = readZipEntryBuf(buf, n.file);
        const sub = inner && fabricInfoFromBuf(inner, depth + 1);
        if (!sub || !sub.id) continue;
        info.nested.push({ id: sub.id, version: sub.version });
        for (const p of sub.provides) info.nested.push({ id: p, version: sub.version });
        info.nested.push(...sub.nested);
      }
    }
    return info;
  } catch (_) { return null; }
}

// ── версии и предикаты fabric.mod.json ─────────────────────────────────
// Нужны, чтобы понимать требования вида ">=0.8.13", "0.8.x", "~1.2.3".
// РАНЬШЕ диапазоны игнорировались («свежая версия и так подойдёт»), но версию
// зависимости мог удерживать пин Modrinth от другого мода — и игра падала
// «requires version 0.8.13 or later, but only 0.8.7 is present».

/** «0.8.7+mc1.21.11» → { nums:[0,8,7], pre:null }; null — не разобрали. */
function parseVer(v) {
  const s = String(v || '').trim().split('+')[0];
  // хвостовой дефис без пререлиза («0.27.14-») — fabric-нотация «самый
  // ранний пререлиз этой версии»: у malilib/litematica все требования такие.
  // Пустой pre ('') — валидное значение «ниже любого пререлиза», null — релиз.
  // одно число — тоже версия: так записана Java («25») и требования к ней («>=21»)
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]*))?$/);
  if (!m) return null;
  return {
    nums: [+m[1], m[2] === undefined ? 0 : +m[2], m[3] === undefined ? 0 : +m[3]],
    pre: m[4] === undefined ? null : m[4],
  };
}

/** Сравнение по semver: пререлиз меньше релиза (0.8.14-beta.1 < 0.8.14). */
function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1; // именно null: пустой pre ('') — НИЖЕ всех пререлизов
  if (b.pre === null) return -1;
  const ap = a.pre.split('.');
  const bp = b.pre.split('.');
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i];
    const y = bp[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x < +y ? -1 : 1; } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Один предикат: «*», «1.2.3», «>=1.2.3», «~1.2.3», «^1.2.3», «1.2.x». */
function satisfiesOne(version, predicate) {
  const ver = parseVer(version);
  if (!ver) return true; // версию не разобрали — не мешаем игроку
  let p = String(predicate || '').trim();
  if (!p || p === '*') return true;
  const op = (p.match(/^(>=|<=|>|<|=|~|\^)/) || [])[1] || '';
  p = p.slice(op.length).trim().split('+')[0];
  // wildcard: 1.2.x / 1.x → диапазон [низ, следующий разряд)
  if (/[xX*]/.test(p)) {
    const parts = p.split('.');
    const idx = parts.findIndex((s) => /^[xX*]$/.test(s));
    if (idx <= 0) return true; // «x» вместо мажора — что угодно
    const lowNums = [0, 0, 0];
    for (let i = 0; i < idx; i++) lowNums[i] = +parts[i] || 0;
    const low = { nums: lowNums, pre: null };
    const highNums = lowNums.slice();
    highNums[idx - 1] += 1;
    for (let i = idx; i < 3; i++) highNums[i] = 0;
    return cmpVer(ver, low) >= 0 && cmpVer(ver, { nums: highNums, pre: null }) < 0;
  }
  const target = parseVer(p);
  if (!target) return true;
  const c = cmpVer(ver, target);
  switch (op) {
    case '>=': return c >= 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '<': return c < 0;
    case '~': { // >=x.y.z <x.(y+1).0
      const hi = { nums: [target.nums[0], target.nums[1] + 1, 0], pre: null };
      return c >= 0 && cmpVer(ver, hi) < 0;
    }
    case '^': { // semver: для 0.y фиксируется и minor
      const hi = target.nums[0] === 0
        ? { nums: [0, target.nums[1] + 1, 0], pre: null }
        : { nums: [target.nums[0] + 1, 0, 0], pre: null };
      return c >= 0 && cmpVer(ver, hi) < 0;
    }
    default: return c === 0;
  }
}

/** Требование целиком: массив = ИЛИ, пробелы внутри строки = И. */
function satisfies(version, constraint) {
  const list = Array.isArray(constraint) ? constraint : [constraint];
  return list.some((one) => {
    if (typeof one !== 'string') return true;
    return one.trim().split(/\s+/).every((pred) => satisfiesOne(version, pred));
  });
}

function fmtConstraint(c) {
  return (Array.isArray(c) ? c : [c]).filter((x) => typeof x === 'string').join(' или ') || '*';
}

/**
 * Версия мода из строки Modrinth («mc1.21.11-0.8.13-fabric» → «0.8.13»).
 * gameVersions — версии игры, заявленные этой сборкой: в строке может стоять
 * не выбранная, а соседняя («mc26.1-0.8.0» у сборки под 26.1–26.1.2), и без
 * них номер игры принимался бы за номер мода.
 */
function guessModVersion(versionNumber, mcVersion, gameVersions) {
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let s = String(versionNumber || '');
  const mcs = [...new Set([mcVersion].concat(Array.isArray(gameVersions) ? gameVersions : []))]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  for (const v of mcs) {
    // границы — чтобы «26.1» не вырезалось из середины «1.26.1»
    s = s.replace(new RegExp('(?:mc)?(?<![\\d.])' + esc(v) + '(?![\\d.]*\\d)', 'gi'), ' ');
  }
  s = s.replace(/\b(fabric|forge|neoforge|quilt)\b/gi, ' ');
  const m = s.match(/(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z][0-9A-Za-z.]*)?)/);
  return m ? m[1] : null;
}

/**
 * Версии проекта под текущие loader/MC. Кэш короткий: резолвер зовёт часто,
 * но лаунчер живёт сутками, и вышедшая за это время версия должна появиться.
 */
const versionListCache = new Map();
const VERSION_LIST_TTL = 10 * 60e3;
async function listProjectVersions(projectId, loader, mcVersion, type = 'mod') {
  const key = projectId + '|' + type + '|' + loader + '|' + mcVersion;
  const hit = versionListCache.get(key);
  if (hit && Date.now() - hit.at < VERSION_LIST_TTL) return hit.list;
  let out = [];
  let failed = false;
  const base = API + '/project/' + encodeURIComponent(projectId) + '/version?loaders='
    + encodeURIComponent(JSON.stringify(versionLoaders(type, loader)));
  try {
    out = await apiGet(base + '&game_versions=' + encodeURIComponent(JSON.stringify([mcVersion]))) || [];
    // паки и шейдеры кроссверсионные и часто не заявляют свежую версию игры
    if (type !== 'mod' && (!Array.isArray(out) || !out.length)) out = await apiGet(base) || [];
  } catch (_) { out = []; failed = true; }
  if (!Array.isArray(out)) out = [];
  // сбой сети не запоминаем: иначе до перезапуска мод считался бы «без версий»
  if (!failed) versionListCache.set(key, { at: Date.now(), list: out });
  return out;
}

/**
 * depends/breaks версии-кандидата. Modrinth их не отдаёт (dependencies в API —
 * только «какой проект нужен», без диапазонов), поэтому качаем jar во временный
 * файл и читаем fabric.mod.json. Кэш по versionId — за проход качаем единицы.
 */
const jarMetaCache = new Map();
async function metaOfVersion(version) {
  if (jarMetaCache.has(version.id)) return jarMetaCache.get(version.id);
  let out = null;
  const file = (version.files || []).find((f) => f.primary) || (version.files || [])[0];
  if (file && file.url) {
    // джарник остаётся в кэше: если эту версию следом ставят, её не качаем заново
    const cached = jarCachePath(version.id);
    try {
      let have = false;
      try { have = !!file.size && fs.statSync(cached).size === file.size; } catch (_) { /* нет в кэше */ }
      if (!have) {
        const res = await robustFetch(file.url);
        if (res.ok) {
          fs.mkdirSync(JAR_CACHE_DIR, { recursive: true });
          fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
          have = true;
        }
      }
      if (have) out = fabricModInfo(cached);
    } catch (_) { out = null; }
  }
  jarMetaCache.set(version.id, out);
  return out;
}

/**
 * Свежая версия проекта, чей fabric.mod.json устраивает среду: нашу версию
 * игры, Java и загрузчик. Релизы раньше бет, внутри — от новых к старым;
 * skipId — уже отвергнутая.
 */
async function pickVersionForEnv(projectId, loader, mcVersion, skipId) {
  const versions = await listProjectVersions(projectId, loader, mcVersion);
  const queue = versions.filter((v) => v.version_type === 'release')
    .concat(versions.filter((v) => v.version_type !== 'release'))
    .filter((v) => v.id !== skipId);
  let probes = 0;
  for (const v of queue) {
    if (probes++ >= MAX_CANDIDATE_PROBES) break;
    const meta = await metaOfVersion(v);
    if (!meta) continue;
    if (!envMismatch(meta, loader, mcVersion)) return v;
  }
  return null;
}

// Джарник, закинутый руками и собранный под другую версию игры, на время
// убираем под этим хвостом: syncMods вернёт его сам, когда игрок переключится
// на версию, под которую он собран.
const WRONG_MC_SUFFIX = '.wrongmc.disabled';

/**
 * Уже стоящие моды, которые на выбранной версии не запустятся (собраны под
 * другой Minecraft, хотят Java или загрузчик новее), переставляем на
 * подходящую версию (кейс FLK 1.14 ↔ Fabric Loader 0.19.3). Нет такой — мод
 * выключаем: иначе Fabric встретит игрока экраном «Incompatible mods found».
 */
async function enforceEnvFit(gameDir, loader, mcVersion, log) {
  if (loader !== 'fabric') return;
  const state = scanFabricState(gameDir, loader, mcVersion);
  // вшитые джарники (любой версии игры) раскладывает и убирает syncMods — здесь их не трогаем
  const bundled = new Set(allBundled(bundledDirSeen).keys());
  for (const slot of state.values()) {
    const { entry, info } = slot;
    const mis = slot.manual
      ? fileEnvMismatch(filePathOf(gameDir, entry), info, loader, mcVersion)
      : envMismatch(info, loader, mcVersion);
    if (!mis || bundled.has(entry.fileName)) continue;
    if (!entry.projectId) {
      // закинутый руками: подобрать замену негде. Чужую версию игры убираем
      // (вернётся при смене версии), остальное оставляем на совести игрока
      if (mis.id !== 'minecraft') {
        log('⚠ ' + entry.fileName + ' ' + describeEnv(mis) + ' — файл закинут вручную, не трогаю');
        continue;
      }
      try {
        const p = filePathOf(gameDir, entry);
        fs.renameSync(p, p + WRONG_MC_SUFFIX);
        log('  − ' + entry.fileName + ': ' + describeEnv(mis) + ' — убран до смены версии игры');
      } catch (e) {
        log('  ! ' + entry.fileName + ': ' + describeEnv(mis) + ', выключить не вышло: ' + e.message);
      }
      continue;
    }
    log('⚑ ' + entry.title + ' ' + info.version + ' ' + describeEnv(mis) + ' — подбираю подходящую версию');
    const alt = await pickVersionForEnv(entry.projectId, loader, mcVersion, entry.versionId);
    if (!alt) {
      sleepMod(gameDir, slot);
      log('  − ' + entry.title + ' выключен: версии, которая запустится на Minecraft ' + mcVersion
        + (mis.id === 'fabricloader' ? ' с нашим загрузчиком' : '') + ', нет');
      continue;
    }
    await installContent(gameDir, {
      projectId: entry.projectId,
      slug: entry.slug,
      title: entry.title,
      iconUrl: entry.iconUrl || '',
    }, 'mod', loader, mcVersion, log, 4, alt.id);
  }
}

// Джарник, закинутый руками и выключенный из-за недостающей зависимости:
// reviveAutoOff вернёт его, когда зависимость появится в игре.
const NEED_DEP_SUFFIX = '.needdep.disabled';

/**
 * Выключить мод: файл в .disabled, в реестре enabled=false. autoOff — id мода,
 * которого не хватило: по нему выключенный вернётся сам, когда тот появится.
 */
function sleepMod(gameDir, slot, autoOff) {
  const p = filePathOf(gameDir, slot.entry);
  if (slot.manual && autoOff) {
    if (fs.existsSync(p)) fs.renameSync(p, p + NEED_DEP_SUFFIX);
    return;
  }
  if (fs.existsSync(p)) fs.renameSync(p, fs.existsSync(p + '.disabled') ? p + '.disabled2' : p + '.disabled');
  const man = readManifest(gameDir);
  const e = man.user.find((x) => x.fileName === slot.entry.fileName && x.type === 'mod');
  if (e) {
    e.enabled = false;
    if (autoOff) e.autoOff = autoOff;
    writeManifest(gameDir, man);
  }
}

// Встроенные «моды» Fabric Loader: зависимость на них закрывает сама игра
const BUILTIN_IDS = new Set(['minecraft', 'java', 'fabricloader', 'mixinextras']);

/**
 * Активные моды: modid → { entry, info } по fabric.mod.json файла.
 * state.provided — всё, что есть в игре помимо них: вложенные джарники и
 * псевдонимы (provides); по ним видно, закрыта ли чужая зависимость.
 */
function scanFabricState(gameDir, loader, mc = BUNDLED_MC) {
  const m = readManifest(gameDir);
  const state = new Map();
  state.provided = new Map();
  const provide = (info) => {
    for (const p of info.provides || []) state.provided.set(p, info.version);
    for (const n of info.nested || []) state.provided.set(n.id, n.version);
  };
  for (const e of m.user) {
    if (e.type !== 'mod' || e.loader !== loader || !e.enabled || e.pendingRemove) continue;
    if (!entryFitsMc(e, mc)) continue;
    const p = filePathOf(gameDir, e);
    if (!fs.existsSync(p)) continue;
    const info = fabricModInfo(p);
    // серверные моды клиент не грузит — их требования его не касаются
    if (!info || !info.id || info.environment === 'server') continue;
    state.set(info.id, { entry: e, info: withKnown(info) });
    provide(info);
  }
  // Джарники, закинутые в папку руками, для Fabric такие же моды — их
  // требования тоже валят игру на старте (реальный кейс: replaymod +
  // replayvoicechat руками, резолвер их не видел и конфликт доехал до
  // экрана «Incompatible mods»). Modrinth-подбора у них нет (projectId
  // неизвестен), но конфликт с их участием решается соседями или, в
  // крайнем случае, усыплением файла.
  if (loader === 'fabric') {
    const dir = contentDir(gameDir, 'mod');
    // файлы реестра сюда не попадают: запись под другую версию игры лежит в
    // папке до ближайшего syncMods, но «закинутой руками» от этого не становится
    const managed = new Set(m.user.filter((e) => e.type === 'mod').map((e) => e.fileName));
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jar') || managed.has(f)) continue;
        const info = fabricModInfo(path.join(dir, f));
        if (!info || !info.id || info.environment === 'server' || state.has(info.id)) continue;
        state.set(info.id, {
          entry: { type: 'mod', fileName: f, title: info.name || info.id, projectId: null, slug: null, loader },
          info: withKnown(info),
          manual: true,
        });
        provide(info);
      }
    } catch (_) { /* папки может не быть на самом первом запуске */ }
  }
  return state;
}

/** Закрыта ли зависимость на modId: мод стоит, вложен в другой или встроен в игру. */
function depPresent(state, modId) {
  return state.has(modId) || BUILTIN_IDS.has(modId) || state.provided.has(modId);
}

/**
 * Известные несовместимости, которые сами моды НЕ объявляют (depends "*"),
 * а видно их только по крашу мижина. Дополняем breaks при сканировании —
 * дальше обычный резолвер сам откатит версию или выключит виновника.
 * Кейс 02.08: online-patpat 1.1 мижинит старый API PatPat и падает на 1.3+.
 */
const KNOWN_BREAKS = {
  'online-patpat': { patpat: '>=1.3.0-' },
};
/** Жёсткие несовместимости из нашей таблицы — как будто мод их сам объявил. */
function withKnown(info) {
  const extra = KNOWN_BREAKS[info.id];
  return extra ? { ...info, breaks: { ...(info.breaks || {}), ...extra } } : info;
}

/**
 * Все нарушения набора модов:
 *   dep     — чужой depends не выполнен по версии;
 *   missing — нужного мода в игре нет вовсе (удалён, выключен, не ставился);
 *   break   — чужой breaks накрыл версию;
 *   soft    — conflicts: игра запустится, но автор предупреждает.
 */
function fabricConflicts(state, withSoft) {
  const out = [];
  for (const { info } of state.values()) {
    for (const [depId, c] of Object.entries(info.depends || {})) {
      if (depId === info.id) continue;
      const t = state.get(depId);
      if (t) {
        if (!satisfies(t.info.version, c)) out.push({ kind: 'dep', targetId: depId, byId: info.id, constraint: c });
      } else if (!depPresent(state, depId)) {
        out.push({ kind: 'missing', targetId: depId, byId: info.id, constraint: c });
      }
    }
    for (const [badId, c] of Object.entries(info.breaks || {})) {
      if (badId === info.id) continue;
      const t = state.get(badId);
      if (t && satisfies(t.info.version, c)) {
        out.push({ kind: 'break', targetId: badId, byId: info.id, constraint: c });
      }
    }
    if (!withSoft) continue;
    for (const [otherId, c] of Object.entries(info.conflicts || {})) {
      if (otherId === info.id) continue;
      const t = state.get(otherId);
      if (t && satisfies(t.info.version, c)) {
        out.push({ kind: 'soft', targetId: otherId, byId: info.id, constraint: c });
      }
    }
  }
  return out;
}
/** Первое нарушение, из-за которого игра не запустится. */
function firstFabricConflict(state) {
  return fabricConflicts(state, false)[0] || null;
}

/** Устроит ли версия modId всех прочих установленных (их depends и breaks). */
function versionFitsOthers(state, modId, version) {
  for (const { info } of state.values()) {
    if (info.id === modId) continue;
    const dep = (info.depends || {})[modId];
    if (dep && !satisfies(version, dep)) return false;
    const br = (info.breaks || {})[modId];
    if (br && satisfies(version, br)) return false;
  }
  return true;
}

/** Не ломается ли сам кандидат об уже стоящие моды (его depends/breaks). */
function candidateFitsState(state, meta, selfId) {
  for (const [depId, c] of Object.entries(meta.depends || {})) {
    if (depId === selfId) continue;
    const t = state.get(depId);
    if (t && !satisfies(t.info.version, c)) return false;
  }
  for (const [badId, c] of Object.entries(meta.breaks || {})) {
    if (badId === selfId) continue;
    const t = state.get(badId);
    if (t && satisfies(t.info.version, c)) return false;
  }
  return true;
}

/** Снимает ли кандидат мода byId именно этот конфликт. */
function candidateResolves(state, conflict, meta) {
  const target = state.get(conflict.targetId);
  if (!target) return true;
  if (conflict.kind === 'break') {
    const br = (meta.breaks || {})[conflict.targetId];
    return !br || !satisfies(target.info.version, br);
  }
  const dep = (meta.depends || {})[conflict.targetId];
  return !dep || satisfies(target.info.version, dep);
}

/** Сколько jar-ов кандидатов качаем на один конфликт (метаданные лежат внутри). */
const MAX_CANDIDATE_PROBES = 8;

function providesId(info, modId) {
  return info.id === modId || (info.provides || []).includes(modId)
    || (info.nested || []).some((n) => n.id === modId);
}

/** Есть ли нужный мод среди выключенных игроком (тогда его не доставляем). */
function disabledProvider(gameDir, loader, mc, modId) {
  for (const e of readManifest(gameDir).user) {
    if (e.type !== 'mod' || e.loader !== loader || e.enabled || e.pendingRemove || !entryFitsMc(e, mc)) continue;
    const info = fabricModInfo(filePathOf(gameDir, e) + '.disabled');
    if (info && providesId(info, modId)) return e;
  }
  return null;
}

// Библиотеки, которых чаще всего не хватает джарникам, закинутым руками (у
// модов из каталога зависимости знает Modrinth): fabric-id → проект Modrinth.
const KNOWN_MOD_PROJECTS = {
  'fabric-api': 'fabric-api',
  fabric: 'fabric-api',
};

/**
 * Достать мод, которого не хватает моду `by`. По порядку: вшитая сборка
 * (игрок выключил библиотеку), обязательные зависимости версии на Modrinth,
 * таблица известных библиотек. true — что-то поставили или включили.
 */
async function installMissingDep(gameDir, loader, mcVersion, log, by, depId) {
  const mine = bundledFor(bundledDirSeen, loader, mcVersion);
  if (mine.dir) {
    for (const f of readManifest(gameDir).bundledDisabled) {
      const src = path.join(mine.dir, f);
      const info = mine.jars.includes(f) && fs.existsSync(src) ? fabricModInfo(src) : null;
      if (!info || !providesId(info, depId)) continue;
      toggleBundledMod(gameDir, f, true);
      fs.copyFileSync(src, path.join(contentDir(gameDir, 'mod'), f));
      log('  + ' + f + ' включён обратно: без него не запустится ' + by.entry.title);
      return true;
    }
  }
  // мод выключил сам игрок — обратно не включаем, выключится зависимый
  if (disabledProvider(gameDir, loader, mcVersion, depId)) return false;

  const install = async (projectIdOrSlug) => {
    const info = await apiGet(API + '/project/' + encodeURIComponent(projectIdOrSlug));
    if (bundledApplies(loader, mcVersion) && BUNDLED_PROJECTS.has(info.id)) return false;
    const have = readManifest(gameDir).user.find((e) => e.projectId === info.id && e.type === 'mod'
      && e.loader === loader && !e.pendingRemove && entryFitsMc(e, mcVersion));
    if (have) return false;
    log('  + ' + info.title + ': нужен для ' + by.entry.title);
    // глубина 4: зависимости самой зависимости найдёт следующий проход
    const r = await installContent(gameDir, {
      projectId: info.id, slug: info.slug, title: info.title, iconUrl: info.icon_url || '',
    }, 'mod', loader, mcVersion, log, 4);
    if (r && !r.ok) log('    ! ' + info.title + ': ' + r.error);
    return !!(r && r.ok && !r.already);
  };

  let installed = false;
  if (by.entry.projectId && by.entry.versionId && by.entry.versionId !== FAIR_FREECAM.versionId) {
    const v = await apiGet(API + '/version/' + encodeURIComponent(by.entry.versionId));
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      if (await install(dep.project_id)) installed = true;
    }
  }
  if (!installed && KNOWN_MOD_PROJECTS[depId]) installed = await install(KNOWN_MOD_PROJECTS[depId]);
  return installed;
}

/**
 * Моды, выключенные из-за недостающей зависимости, включаем обратно, как
 * только она появилась (игрок доставил или включил нужный мод).
 */
function reviveAutoOff(gameDir, loader, mc, log) {
  for (let round = 0; round < 5; round++) {
    const state = scanFabricState(gameDir, loader, mc);
    let changed = false;
    const man = readManifest(gameDir);
    for (const e of man.user) {
      if (e.type !== 'mod' || e.loader !== loader || e.enabled || !e.autoOff || e.pendingRemove) continue;
      if (!entryFitsMc(e, mc) || !depPresent(state, e.autoOff)) continue;
      const on = filePathOf(gameDir, e);
      try {
        if (!fs.existsSync(on) && fs.existsSync(on + '.disabled')) fs.renameSync(on + '.disabled', on);
        if (!fs.existsSync(on)) continue;
        log('  + ' + e.title + ' снова включён: «' + e.autoOff + '» на месте');
        e.enabled = true;
        delete e.autoOff;
        changed = true;
      } catch (_) { /* файл занят — попробуем при следующем запуске */ }
    }
    if (changed) writeManifest(gameDir, man);
    const dir = contentDir(gameDir, 'mod');
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { /* папки ещё нет */ }
    for (const f of names) {
      if (!f.endsWith('.jar' + NEED_DEP_SUFFIX)) continue;
      const info = fabricModInfo(path.join(dir, f));
      const back = path.join(dir, f.slice(0, -NEED_DEP_SUFFIX.length));
      if (!info || fs.existsSync(back)) continue;
      if (!Object.keys(info.depends || {}).every((id) => id === info.id || depPresent(state, id))) continue;
      try {
        fs.renameSync(path.join(dir, f), back);
        log('  + ' + path.basename(back) + ' снова включён: зависимости на месте');
        changed = true;
      } catch (_) { /* файл занят */ }
    }
    if (!changed) return;
  }
}

/**
 * Сверка требований установленных модов друг к другу по fabric.mod.json —
 * ЕДИНСТВЕННЫЙ авторитет по версиям (пины Modrinth = лишь «с чем тестировали»).
 * Учитываем ОБА раздела: depends («нужна версия не ниже») и breaks («с этой
 * версией не работаю») — второй раньше игнорировался, и игроки ловили
 * «Incompatible mods found»: Sodium 0.8.13 объявляет breaks iris <=1.10.7,
 * а свежее Iris 1.10.7 под 1.21.11 просто нет.
 *
 * Разрешение конфликта по кругу (до 6 проходов, чтобы правки не зациклились):
 *   1) подобрать версию «жертвы», которая устраивает вообще всех;
 *   2) если такой нет — понизить того, кто предъявил требование, и закрепить
 *      его версию; сломанные этим третьи моды чинятся следующим проходом
 *      (Sodium 0.8.12 → Sodium Extra 0.9.3 больше не подходит → 0.9.1).
 * Сеть упала — молча выходим, играем как есть.
 */
async function enforceJarDeps(gameDir, loader, mcVersion, log) {
  if (loader !== 'fabric') return;
  // 0) моды, которые на выбранной версии не запустятся сами по себе (чужой
  // Minecraft, Java или загрузчик новее нашего) — сначала они, иначе Fabric
  // покажет «Incompatible mods found» ещё до разбора взаимных требований
  await enforceEnvFit(gameDir, loader, mcVersion, log);
  reviveAutoOff(gameDir, loader, mcVersion, log);
  // версию, выбранную игроком вручную, не двигаем — подстраиваем соседей
  const locked = new Set();
  for (const [id, slot] of scanFabricState(gameDir, loader, mcVersion)) {
    if (slot.entry.userPin) locked.add(id);
  }
  const triedMissing = new Set();

  // недостающие зависимости в счёт шести проходов подбора не идут: их бывает
  // много разом (выключили библиотеку, на которой держится десяток модов)
  for (let pass = 0, guard = 0; pass < 6 && guard < 80; guard++) {
    const state = scanFabricState(gameDir, loader, mcVersion);
    const conflict = firstFabricConflict(state);
    if (!conflict) return;

    const by = state.get(conflict.byId);
    if (!by) return;

    if (conflict.kind === 'missing') {
      const key = conflict.byId + '>' + conflict.targetId;
      // вшитый мод Mist (на 26.x ему нужен Fabric API из каталога): не вышло
      // доставить зависимость — пропускаем его на этот запуск, а не выключаем:
      // syncMods положит его снова, и попытка повторится
      const ours = bundledFor(bundledDirSeen, loader, mcVersion).jars.includes(by.entry.fileName);
      let got = null;
      if (!triedMissing.has(key)) {
        try {
          got = await installMissingDep(gameDir, loader, mcVersion, log, by, conflict.targetId);
        } catch (e) {
          if (!ours) throw e;
        }
      }
      triedMissing.add(key);
      if (got && depPresent(scanFabricState(gameDir, loader, mcVersion), conflict.targetId)) continue;
      if (ours) {
        try {
          fs.unlinkSync(filePathOf(gameDir, by.entry));
          log('  − ' + by.entry.fileName + ' пропущен в этот запуск: не удалось поставить «' + conflict.targetId + '»');
          continue;
        } catch (e) {
          log('  ! ' + by.entry.fileName + ': ' + e.message);
          return;
        }
      }
      // поставить нечего (или игрок сам выключил нужный мод) — выключаем
      // того, кто без него не запустится; вернётся сам, когда зависимость
      // появится (reviveAutoOff)
      try {
        sleepMod(gameDir, by, conflict.targetId);
        log('  − ' + by.entry.title + ' выключен: ему нужен мод «' + conflict.targetId + '», а его нет'
          + (by.manual ? '' : ' — включится сам, когда тот появится'));
        continue;
      } catch (e) {
        log('  ! не смог выключить ' + by.entry.title + ': ' + e.message);
        return;
      }
    }
    pass++;

    const target = state.get(conflict.targetId);
    if (!target) return;
    log(conflict.kind === 'break'
      ? '⚑ ' + by.entry.title + ' ' + by.info.version + ' не работает с '
        + target.entry.title + ' ' + target.info.version + ' — подбираю версии'
      : '⚑ ' + target.entry.title + ' ' + target.info.version + ' не устраивает '
        + by.entry.title + ' (нужно ' + fmtConstraint(conflict.constraint) + ') — подбираю версии');

    let applied = false;

    // 1) двигаем «жертву» — версию, на которую жалуются
    if (!locked.has(conflict.targetId)) {
      applied = await tryReplace(gameDir, loader, mcVersion, log, state, conflict, target,
        (ver) => versionFitsOthers(state, conflict.targetId, ver), null);
      if (applied) locked.add(conflict.targetId);
    }

    // 2) не вышло — двигаем того, кто предъявил требование
    if (!applied && !locked.has(conflict.byId)) {
      applied = await tryReplace(gameDir, loader, mcVersion, log, state, conflict, by,
        null, conflict);
      if (applied) locked.add(conflict.byId);
    }

    if (!applied) {
      // Последний рубеж: версию не подобрали (Modrinth молчит или её нет) —
      // усыпляем мод, который предъявил требование, иначе Fabric встретит
      // игрока экраном «Incompatible mods found» вместо игры. Мод остаётся
      // во вкладке «Мои моды» выключенным — включить обратно один клик.
      try {
        sleepMod(gameDir, by);
        log('  − ' + by.entry.title + ' временно выключен: '
          + (conflict.kind === 'break' ? 'не работает с ' : 'требует ') + target.entry.title
          + ' ' + fmtConstraint(conflict.constraint) + ', совместимой версии не нашлось');
        locked.add(conflict.byId);
        continue; // конфликт снят выключением — проверяем, не остался ли следующий
      } catch (e) {
        log('  ! не смог выключить ' + by.entry.title + ': ' + e.message);
        return;
      }
    }
  }
}

/**
 * Подобрать и поставить версию мода `slotEntry`. `fitsByVersionString` — дешёвая
 * проверка по номеру версии (для «жертвы»), `resolveFor` — конфликт, который
 * кандидат обязан снять (для «источника требования»); в обоих случаях кандидат
 * дополнительно не должен ломаться о текущий набор модов.
 */
async function tryReplace(gameDir, loader, mcVersion, log, state, conflict, slot,
  fitsByVersionString, resolveFor) {
  if (!slot.entry.projectId) return false; // закинут руками — подбирать не из чего
  const versions = await listProjectVersions(slot.entry.projectId, loader, mcVersion);
  if (!versions.length) return false;
  const ordered = versions
    .map((v) => ({ v, ver: guessModVersion(v.version_number, mcVersion, v.game_versions) }))
    .filter((c) => c.ver && c.ver !== slot.info.version.split('+')[0]);
  // стабильные раньше бет, внутри — как отдал API (от новых к старым)
  const queue = ordered.filter((c) => c.v.version_type === 'release')
    .concat(ordered.filter((c) => c.v.version_type !== 'release'));

  let probes = 0;
  for (const cand of queue) {
    // сверяем и очищенную версию («2.6.25»), и полную строку Modrinth
    // («1.21.11-2.6.25»): точные пины вроде Replay Voice Chat → Replay Mod
    // записаны полной строкой, и очищенная их не проходила
    if (fitsByVersionString && !fitsByVersionString(cand.ver)
        && !fitsByVersionString(String(cand.v.version_number || ''))) continue;
    if (probes++ >= MAX_CANDIDATE_PROBES) break;
    const meta = await metaOfVersion(cand.v);
    if (!meta) continue;
    if (envMismatch(meta, loader, mcVersion)) continue;
    if (!candidateFitsState(state, meta, slot.info.id)) continue;
    if (resolveFor && !candidateResolves(state, resolveFor, meta)) continue;
    if (!resolveFor) {
      // «жертву» ставим только если она реально снимает конфликт
      const c = conflict.kind === 'break'
        ? !satisfies(meta.version, (state.get(conflict.byId).info.breaks || {})[conflict.targetId] || '')
        : satisfies(meta.version, conflict.constraint);
      if (!c) continue;
    }
    log('  → ' + slot.entry.title + ' ' + slot.info.version + ' → ' + (cand.ver || '?'));
    const r = await installContent(gameDir, {
      projectId: slot.entry.projectId,
      slug: slot.entry.slug,
      title: slot.entry.title,
      iconUrl: slot.entry.iconUrl || '',
    }, 'mod', loader, mcVersion, log, 4, cand.v.id);
    if (r && r.ok) return true;
  }
  return false;
}

// ── синхронизация модов перед запуском ─────────────────────────────────
// В mods/ активны только моды ТЕКУЩЕГО загрузчика (чужие уходят в .disabled —
// иначе Forge спотыкается о fabric-джарники и наоборот); вшитая сборка Mist MC
// докладывается для Fabric с учётом выключенных. Паки/шейдеры не трогаем —
// они кроссверсионные и не зависят от загрузчика.
function syncMods(gameDir, loader, bundledDir, log, mc = BUNDLED_MC) {
  bundledDirSeen = bundledDir;
  fs.mkdirSync(contentDir(gameDir, 'mod'), { recursive: true });
  const m = readManifest(gameDir);
  // вшитые моды под выбранную версию игры; джарники сборок под другие версии
  // из папки модов убираем
  const mine = bundledFor(bundledDir, loader, mc);
  const bundled = mine.jars;
  const everyBundled = allBundled(bundledDir);

  // отложенные удаления: файл был занят игрой в момент «удалить» — сейчас
  // игра не запущена, доудаляем и забываем запись
  const stillPending = [];
  for (const entry of m.user) {
    if (!entry.pendingRemove) continue;
    if (tryDeleteEntryFiles(gameDir, entry)) {
      log('  − ' + entry.fileName + ' (отложенное удаление)');
    } else {
      stillPending.push(entry);
      log('  ! ' + entry.fileName + ': не удалился — файл занят');
    }
  }
  if (m.user.some((e) => e.pendingRemove)) {
    m.user = m.user.filter((e) => !e.pendingRemove || stillPending.includes(e));
    writeManifest(gameDir, m);
  }

  for (const [f, dir] of everyBundled) {
    const dest = path.join(contentDir(gameDir, 'mod'), f);
    const applies = bundled.includes(f);
    const wanted = applies && !m.bundledDisabled.includes(f);
    try {
      if (wanted) {
        fs.copyFileSync(path.join(dir, f), dest);
        log('  + мод ' + f);
      } else if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
        log('  − мод ' + f + (applies ? ' (выключен)'
          : loader === 'fabric' ? ' (собран под другую версию игры)' : ' (не для ' + loader + ')'));
      }
    } catch (e) {
      // джарник держит уже запущенная игра (второе окно мультиаккаунта) —
      // он на месте, перезаписывать нечем и незачем
      if (wanted && (e.code === 'EBUSY' || e.code === 'EPERM') && fs.existsSync(dest)) log('  + мод ' + f);
      else log('  ! ' + f + ': ' + e.message);
    }
  }

  for (const entry of m.user) {
    if (entry.type !== 'mod' || entry.pendingRemove) continue;
    const on = filePathOf(gameDir, entry);
    const off = on + '.disabled';
    // активны только моды текущего загрузчика И текущей версии игры
    const wanted = entry.enabled && entry.loader === loader && entryFitsMc(entry, mc);
    try {
      if (wanted && fs.existsSync(off) && !fs.existsSync(on)) fs.renameSync(off, on);
      if (!wanted && fs.existsSync(on)) fs.renameSync(on, fs.existsSync(off) ? on + '.disabled2' : off);
      if (wanted && fs.existsSync(on)) log('  + мод ' + entry.fileName);
    } catch (e) {
      log('  ! ' + entry.fileName + ': ' + e.message);
    }
  }

  // Джарники, закинутые руками и убранные как «собран под другую версию игры»
  // (enforceEnvFit), возвращаем, когда выбранная версия им снова подходит.
  if (loader === 'fabric') {
    const dir = contentDir(gameDir, 'mod');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jar' + WRONG_MC_SUFFIX)) continue;
      const back = path.join(dir, f.slice(0, -WRONG_MC_SUFFIX.length));
      const info = fabricModInfo(path.join(dir, f));
      if (!info || fs.existsSync(back) || fileEnvMismatch(path.join(dir, f), info, loader, mc)) continue;
      try {
        fs.renameSync(path.join(dir, f), back);
        log('  + мод ' + path.basename(back) + ' (снова подходит версии игры)');
      } catch (e) {
        log('  ! ' + f + ': ' + e.message);
      }
    }
  }

  // Дубликаты mod id валят Fabric на старте («Duplicate mod id») ещё до окна
  // игры: игрок положил свой fabric-api/modmenu, а мы докинули вшитый той же
  // сути. Оставляем вшитый (он подобран под сборку Mist), копию игрока
  // усыпляем в .dupe.disabled — вернуть можно переименованием.
  if (loader === 'fabric') {
    const dir = contentDir(gameDir, 'mod');
    const byId = new Map(); // id → [{file, bundled}]
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jar')) continue;
      const info = fabricModInfo(path.join(dir, f));
      if (!info || !info.id) continue;
      if (!byId.has(info.id)) byId.set(info.id, []);
      byId.get(info.id).push({ file: f, bundled: bundled.includes(f) });
    }
    for (const [id, files] of byId) {
      if (files.length < 2) continue;
      const keep = files.find((x) => x.bundled) || files[0];
      for (const x of files) {
        if (x === keep) continue;
        try {
          fs.renameSync(path.join(dir, x.file), path.join(dir, x.file + '.dupe.disabled'));
          log('  − ' + x.file + ' (дубликат ' + id + ', оставлен ' + keep.file + ')');
        } catch (e) {
          log('  ! дубликат ' + x.file + ' не отключился: ' + e.message);
        }
      }
    }
  }
}

/**
 * Freecam-надзор перед каждым запуском: любой джарник в mods с fabric-id
 * freecam/legacy-freecam БЕЗ нашего маркера (см. FAIR_FREECAM) — это сборка
 * с пролётом сквозь стены: и та, что каталог ставил до фикса, и закинутая
 * руками. Подменяем честной сборкой с раздачи; если сети нет — усыпляем
 * файл (fail closed): лучше без freecam, чем с читом.
 */
async function enforceFairFreecam(gameDir, log, mc = BUNDLED_MC) {
  const dir = contentDir(gameDir, 'mod');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const f of names) {
    if (!f.endsWith('.jar')) continue;
    const full = path.join(dir, f);
    let info = null;
    try { info = fabricModInfo(full); } catch (_) { continue; }
    if (!info || !FAIR_FREECAM.modIds.has(info.id)) continue;
    if (readZipEntry(full, FAIR_FREECAM.marker)) continue; // уже наша сборка
    // честная сборка есть только под версию сервера: на другой версии игры
    // подменить нечем, поэтому непатченный freecam просто выключаем
    if (mc !== BUNDLED_MC) {
      try {
        fs.renameSync(full, full + '.cheat.disabled');
        log('  − ' + f + ': freecam с пролётом сквозь стены отключён (честной сборки под ' + mc + ' нет)');
      } catch (_) { /* файл занят */ }
      continue;
    }
    const dest = path.join(dir, FAIR_FREECAM.fileName);
    try {
      if (!fs.existsSync(dest) || !readZipEntry(dest, FAIR_FREECAM.marker)) {
        await downloadTo(fairFreecamUrl(), dest, log);
      }
      if (full !== dest) fs.unlinkSync(full);
      log('  ⟳ ' + f + ' → честная сборка freecam (пролёт сквозь стены вырезан)');
    } catch (e) {
      try { fs.renameSync(full, full + '.cheat.disabled'); } catch (_) { /* файл занят */ }
      log('  − ' + f + ': непатченный freecam отключён (честная сборка недоступна: ' + e.message + ')');
      continue;
    }
    const m = readManifest(gameDir);
    const entry = m.user.find((e2) => e2.type === 'mod' && e2.fileName === f)
      || m.user.find((e2) => e2.type === 'mod' && e2.projectId === FAIR_FREECAM.projectId);
    if (entry) {
      entry.fileName = FAIR_FREECAM.fileName;
      entry.versionNumber = FAIR_FREECAM.versionNumber;
      entry.versionId = FAIR_FREECAM.versionId;
      writeManifest(gameDir, m);
    }
  }
}

/**
 * Запрещённые на Mist MC моды (BLOCKED_MODS) усыпляем перед запуском:
 * сервер всё равно кикнет за их каналы, лучше объяснить это до входа.
 * Возвращает список выключенных ярлыков (для сообщения игроку).
 */
function enforceBlockedMods(gameDir, log) {
  const dir = contentDir(gameDir, 'mod');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const hit = [];
  for (const f of names) {
    if (!f.endsWith('.jar')) continue;
    const full = path.join(dir, f);
    let info = null;
    try { info = fabricModInfo(full); } catch (_) { /* не fabric-джарник */ }
    const rule = BLOCKED_MODS.find((r) => (info && r.ids.has(info.id)) || r.fileRe.test(f));
    if (!rule) continue;
    try {
      fs.renameSync(full, full + '.banned.disabled');
      const m = readManifest(gameDir);
      const e = m.user.find((x) => x.type === 'mod' && x.fileName === f);
      if (e) { e.enabled = false; writeManifest(gameDir, m); }
      log('  − ' + f + ': ' + rule.label + ' запрещён на Mist MC — выключен');
      hit.push(rule.label);
    } catch (e) {
      log('  ! не смог выключить ' + f + ': ' + e.message);
    }
  }
  return hit;
}

/**
 * Выключить мод по его fabric-id (виновник краша из разбора лога).
 * Ищем джарник по fabric.mod.json среди всех в папке — и реестровых, и
 * закинутых руками. Возвращает имя файла или null, если не нашли/не вышло.
 */
function disableModById(gameDir, loader, modId, log) {
  const dir = contentDir(gameDir, 'mod');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jar')) continue;
      const info = fabricModInfo(path.join(dir, f));
      if (!info || info.id !== modId) continue;
      const p = path.join(dir, f);
      fs.renameSync(p, fs.existsSync(p + '.disabled') ? p + '.disabled2' : p + '.disabled');
      const m = readManifest(gameDir);
      const e = m.user.find((x) => x.type === 'mod' && x.fileName === f);
      if (e) { e.enabled = false; writeManifest(gameDir, m); }
      return f;
    }
  } catch (e) {
    if (log) log('  ! не смог выключить ' + modId + ': ' + e.message);
  }
  return null;
}

// ── сборка игрока: экспорт кодом и применение ───────────────────────────
// ── настройки внутри кода сборки ────────────────────────────────────────
// Кроме списка модов код может нести НЕЛИЧНЫЕ настройки: config/ (параметры
// модов), options.txt (управление, графика, звук) и настройки шейдеров.
// Карту и вейпоинты не переносим НИКОГДА и ни под какой галочкой: это
// координаты баз игрока, и делиться ими «заодно с модами» он не подписывался.
const SHARE_MAX_FILE = 256 * 1024;      // один файл
const SHARE_MAX_RAW = 3 * 1024 * 1024;  // всё вместе до сжатия
const SHARE_MAX_PACKED = 500 * 1024;    // после сжатия (лимит сайта — 700 КБ)
const SHARE_EXT = new Set(['.json', '.json5', '.toml', '.cfg', '.conf', '.properties',
  '.txt', '.yaml', '.yml', '.ini', '.snbt', '.xml']);
// мусор и кэши: возить туда-сюда незачем (у Plasmo Voice, например, в config
// лежат переводы на два десятка языков)
const SHARE_SKIP_DIRS = new Set(['cache', 'caches', 'logs', 'backup', 'backups', 'temp', 'tmp']);

/** Категория файла для галочек; null — файл в код сборки не допускается. */
function shareCategory(relPath) {
  const p = String(relPath || '').replace(/\\/g, '/');
  // защита от чужого кода: никаких выходов вверх и абсолютных путей
  if (!p || p.includes('..') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  if (p === 'options.txt') return 'options';
  if (/^shaderpacks\/[^/]+\.txt$/.test(p)) return 'shaders';
  if (p.startsWith('config/') && SHARE_EXT.has(path.extname(p).toLowerCase())) return 'configs';
  return null;
}

function walkConfigDir(dir, base, out, state, depth = 0) {
  if (depth > 4 || state.bytes > SHARE_MAX_RAW) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // .crowdin и подобное — не настройки
    const full = path.join(dir, e.name);
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) {
      if (SHARE_SKIP_DIRS.has(e.name.toLowerCase())) continue;
      walkConfigDir(full, rel, out, state, depth + 1);
    } else if (e.isFile()) {
      if (!SHARE_EXT.has(path.extname(e.name).toLowerCase())) continue;
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (st.size > SHARE_MAX_FILE || state.bytes + st.size > SHARE_MAX_RAW) continue;
      try {
        out[rel] = fs.readFileSync(full, 'utf8');
        state.bytes += st.size;
      } catch (_) { /* нечитаемый файл пропускаем */ }
    }
  }
}

/** Собрать выбранные настройки: { map: {путь: содержимое}, info } */
function collectShareFiles(gameDir, parts) {
  const map = {};
  const state = { bytes: 0 };
  const info = { configs: 0, options: false, shaders: 0, bytes: 0 };
  if (parts && parts.configs) {
    walkConfigDir(path.join(gameDir, 'config'), 'config', map, state);
    info.configs = Object.keys(map).length;
  }
  if (parts && parts.options) {
    const p = path.join(gameDir, 'options.txt');
    try {
      const st = fs.statSync(p);
      if (st.size <= SHARE_MAX_FILE) {
        map['options.txt'] = fs.readFileSync(p, 'utf8');
        state.bytes += st.size;
        info.options = true;
      }
    } catch (_) { /* нет файла — нечего переносить */ }
  }
  if (parts && parts.shaders) {
    const dir = path.join(gameDir, 'shaderpacks');
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.toLowerCase().endsWith('.txt')) continue; // настройки, а не сами паки
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (!st.isFile() || st.size > SHARE_MAX_FILE) continue;
        map[path.posix.join('shaderpacks', f)] = fs.readFileSync(p, 'utf8');
        state.bytes += st.size;
        info.shaders++;
      }
    } catch (_) { /* нет шейдеров */ }
  }
  info.bytes = state.bytes;
  return { map, info };
}

/**
 * Что игрок поставил САМ (вшитые моды Mist MC не включаем — они и так есть
 * у каждого). Версии сохраняем поимённо: смысл кода сборки в том, чтобы у
 * друга собралось ровно то же, а не «примерно похожее».
 * parts — какие настройки приложить (configs/options/shaders).
 */
function exportBuild(gameDir, loader, parts, mc = BUNDLED_MC) {
  const m = readManifest(gameDir);
  const items = m.user
    .filter((e) => !e.pendingRemove && (e.type !== 'mod' || (e.loader === loader && entryFitsMc(e, mc))))
    .map((e) => ({
      projectId: e.projectId,
      slug: e.slug,
      title: e.title,
      iconUrl: e.iconUrl || '',
      type: e.type || 'mod',
      versionId: e.versionId || null,
      versionNumber: e.versionNumber || '',
      enabled: e.enabled !== false,
    }));
  // mc — под какую версию игры собран набор: по ней получатель поймёт, можно
  // ли ставить версии модов один в один
  const build = { loader, mc, items, bundledDisabled: m.bundledDisabled || [] };

  if (parts && (parts.configs || parts.options || parts.shaders)) {
    const { map, info } = collectShareFiles(gameDir, parts);
    if (Object.keys(map).length) {
      const packed = zlib.gzipSync(Buffer.from(JSON.stringify(map), 'utf8'), { level: 9 });
      if (packed.length > SHARE_MAX_PACKED) {
        throw new Error('настройки слишком большие ('
          + Math.round(packed.length / 1024) + ' КБ) — сними часть галочек');
      }
      build.filesGz = packed.toString('base64');
      build.filesInfo = info; // что внутри — получатель видит ДО установки
    }
  }
  return build;
}

/**
 * Применить чужую сборку: доставить недостающее. Уже стоящее не трогаем и
 * ничего не удаляем — игрок делится сборкой, а не стирает чужие моды.
 * Возвращает сводку для UI.
 */
/**
 * Разложить настройки из чужого кода. Пути проверяем по белому списку категорий
 * (чужой код — недоверенные данные, иначе им можно было бы писать куда угодно),
 * а всё, что заменяем, сперва кладём рядом с пометкой .bak-build, чтобы игрок
 * мог вернуть своё управление.
 */
function applyShareFiles(gameDir, build, parts, log) {
  const res = { written: 0, skipped: 0, backedUp: 0 };
  if (!build || !build.filesGz) return res;
  let map;
  try {
    map = JSON.parse(zlib.gunzipSync(Buffer.from(build.filesGz, 'base64')).toString('utf8'));
  } catch (e) {
    log('  ! настройки в коде повреждены: ' + e.message);
    return res;
  }
  for (const [rel, content] of Object.entries(map)) {
    const cat = shareCategory(rel);
    if (!cat || !parts || !parts[cat] || typeof content !== 'string') { res.skipped++; continue; }
    const dest = path.join(gameDir, rel.replace(/\//g, path.sep));
    // финальная страховка: результат обязан остаться внутри папки игры
    if (!path.resolve(dest).startsWith(path.resolve(gameDir) + path.sep)) { res.skipped++; continue; }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) {
        const bak = dest + '.bak-build';
        if (!fs.existsSync(bak)) { fs.copyFileSync(dest, bak); res.backedUp++; }
      }
      fs.writeFileSync(dest, content, 'utf8');
      res.written++;
    } catch (e) {
      log('  ! ' + rel + ': ' + e.message);
      res.skipped++;
    }
  }
  if (res.written) {
    log('  ⚙ настроек применено: ' + res.written
      + (res.backedUp ? ' (прежние сохранены как *.bak-build: ' + res.backedUp + ')' : ''));
  }
  return res;
}

async function applyBuild(gameDir, build, mcVersion, log, parts) {
  const loader = build && build.loader === 'forge' ? 'forge' : 'fabric';
  const items = Array.isArray(build && build.items) ? build.items : [];
  // сборку делали под другую версию игры: точные версии модов к нашей не
  // подойдут — ставим те же моды, но в сборках под выбранную версию
  const buildMc = (build && typeof build.mc === 'string' && build.mc) || BUNDLED_MC;
  const sameMc = buildMc === mcVersion;
  const summary = { installed: [], already: [], failed: [], loader, files: null, buildMc, sameMc };
  if (!sameMc) log('ⓘ Сборка собрана под Minecraft ' + buildMc + ' — подбираю эти же моды под ' + mcVersion);
  for (const it of items) {
    if (!it || !it.projectId) continue;
    const type = TYPES[it.type] ? it.type : 'mod';
    try {
      const res = await installContent(
        gameDir,
        { projectId: it.projectId, slug: it.slug, title: it.title, iconUrl: it.iconUrl || '' },
        type, loader, mcVersion, log, 0, (sameMc || type !== 'mod') ? (it.versionId || null) : null,
      );
      if (res && res.ok) (res.already ? summary.already : summary.installed).push(it.title || it.slug);
      else summary.failed.push((it.title || it.slug) + ': ' + ((res && res.error) || '?'));
    } catch (e) {
      summary.failed.push((it.title || it.slug) + ': ' + e.message);
    }
  }
  // после массовой установки приводим версии в согласие (см. enforceJarDeps)
  try {
    await enforceJarDeps(gameDir, loader, mcVersion, log);
  } catch (_) { /* сеть — играем как есть */ }
  // настройки кладём ПОСЛЕ модов: конфиг без своего мода бесполезен
  if (build && build.filesGz && parts) {
    summary.files = applyShareFiles(gameDir, build, parts, log);
  }
  return summary;
}

// ── подсказки и выбор версий для вкладки «Моды» ─────────────────────────
function modTitle(slot) { return slot.entry.title || slot.info.name || slot.info.id; }

/**
 * Что не так с набором модов прямо сейчас — без сети, по fabric.mod.json.
 * error — с этим игра не запустится (лаунчер исправит перед запуском или по
 * кнопке), warn — запустится, но автор мода предупреждает о сбоях, info —
 * мод выключен автоматически и ждёт свою зависимость.
 */
function diagnose(gameDir, loader, mc, bundledDir) {
  if (bundledDir) bundledDirSeen = bundledDir;
  const issues = [];
  if (loader !== 'fabric') return issues;
  const state = scanFabricState(gameDir, loader, mc);
  const bundled = new Set(bundledFor(bundledDirSeen, loader, mc).jars);
  const push = (level, slot, text) => issues.push({
    level, fileName: slot.entry.fileName, title: modTitle(slot), text,
  });
  for (const slot of state.values()) {
    const mis = slot.manual
      ? fileEnvMismatch(filePathOf(gameDir, slot.entry), slot.info, loader, mc)
      : envMismatch(slot.info, loader, mc);
    if (mis && !bundled.has(slot.entry.fileName)) push('error', slot, describeEnv(mis));
  }
  for (const c of fabricConflicts(state, true)) {
    const by = state.get(c.byId);
    const t = state.get(c.targetId);
    if (c.kind === 'missing') {
      // вшитым модам Mist на 26.x нужен Fabric API из каталога — его лаунчер
      // ставит сам перед первым запуском, пугать этим игрока незачем
      if (bundled.has(by.entry.fileName) && KNOWN_MOD_PROJECTS[c.targetId]) continue;
      push('error', by, 'нужен мод «' + c.targetId + '» — он не установлен или выключен');
    } else if (c.kind === 'dep') {
      push('error', by, 'нужен ' + modTitle(t) + ' ' + fmtConstraint(c.constraint) + ', а стоит ' + t.info.version);
    } else if (c.kind === 'break') {
      push('error', by, 'не работает с ' + modTitle(t) + ' ' + t.info.version);
    } else {
      push('warn', by, 'может конфликтовать с ' + modTitle(t) + ' ' + t.info.version);
    }
  }
  for (const e of readManifest(gameDir).user) {
    if (e.type !== 'mod' || e.loader !== loader || e.enabled || !e.autoOff || e.pendingRemove) continue;
    if (!entryFitsMc(e, mc)) continue;
    issues.push({ level: 'info', fileName: e.fileName, title: e.title, text: 'выключен: ждёт мод «' + e.autoOff + '»' });
  }
  return issues;
}

/**
 * Кому из включённых модов нужен мод из этого файла. Спрашивают ДО выключения
 * или удаления — чтобы игрок увидел, что потянет за собой.
 */
function dependentsOf(gameDir, loader, mc, fileName) {
  if (loader !== 'fabric') return [];
  const state = scanFabricState(gameDir, loader, mc);
  const idsOf = (info) => [info.id, ...(info.provides || []), ...(info.nested || []).map((n) => n.id)];
  let self = null;
  for (const slot of state.values()) if (slot.entry.fileName === fileName) self = slot;
  if (!self) return [];
  // ту же библиотеку может нести и другой мод (вложенная копия) — тогда
  // зависимость не осиротеет
  const elsewhere = new Set();
  for (const slot of state.values()) if (slot !== self) idsOf(slot.info).forEach((id) => elsewhere.add(id));
  const mine = new Set(idsOf(self.info).filter((id) => !elsewhere.has(id)));
  const out = [];
  for (const slot of state.values()) {
    if (slot === self) continue;
    if (Object.keys(slot.info.depends || {}).some((id) => mine.has(id))) out.push(modTitle(slot));
  }
  return out;
}

/** Версии проекта под выбранную игру для выпадающего списка в карточке. */
async function projectVersions(gameDir, projectId, type, loader, mc) {
  const t = typeInfo(type);
  const cur = readManifest(gameDir).user.find((e) => e.projectId === projectId && e.type === type
    && (!t.perLoader || e.loader === loader) && !e.pendingRemove && entryFitsMc(e, mc));
  // freecam ставится только честной сборкой Mist — выбирать не из чего
  if (type === 'mod' && projectId === FAIR_FREECAM.projectId) {
    return { fixed: true, installedId: cur ? cur.versionId : null, pinned: false, recommendedId: null, versions: [] };
  }
  const versions = await listProjectVersions(projectId, loader, mc, type);
  const rec = versions.find((v) => v.version_type === 'release') || versions[0] || null;
  return {
    installedId: cur ? cur.versionId : null,
    pinned: !!(cur && cur.userPin),
    recommendedId: rec ? rec.id : null,
    versions: versions.slice(0, 40).map((v) => {
      const f = (v.files || []).find((x) => x.primary) || (v.files || [])[0];
      return {
        id: v.id,
        number: v.version_number || v.name || v.id,
        channel: v.version_type || 'release',
        date: v.date_published || '',
        size: (f && f.size) || 0,
      };
    }),
  };
}

/** Чем версия-кандидат не сходится с уже стоящими модами. */
function compatIssues(state, meta, loader, mc, depsCovered) {
  const issues = [];
  const mis = envMismatch(meta, loader, mc);
  if (mis) issues.push({ level: 'error', text: 'эта версия ' + describeEnv(mis) });
  for (const [depId, c] of Object.entries(meta.depends || {})) {
    if (depId === meta.id) continue;
    const t = state.get(depId);
    if (t) {
      if (satisfies(t.info.version, c)) continue;
      const stuck = t.manual || t.entry.userPin;
      issues.push({
        level: 'error',
        text: 'нужен ' + modTitle(t) + ' ' + fmtConstraint(c) + ', а стоит ' + t.info.version
          + (stuck ? (t.manual ? ' (закинут вручную)' : ' (версию закрепил ты)') : ''),
      });
    } else if (!depPresent(state, depId) && !depsCovered && !KNOWN_MOD_PROJECTS[depId]) {
      issues.push({ level: 'warn', text: 'нужен мод «' + depId + '» — в зависимостях на Modrinth его нет, поставь сам' });
    }
  }
  for (const [badId, c] of Object.entries(meta.breaks || {})) {
    const t = badId !== meta.id && state.get(badId);
    if (t && satisfies(t.info.version, c)) {
      issues.push({ level: 'error', text: 'не работает с ' + modTitle(t) + ' ' + t.info.version });
    }
  }
  for (const [otherId, c] of Object.entries(meta.conflicts || {})) {
    const t = otherId !== meta.id && state.get(otherId);
    if (t && satisfies(t.info.version, c)) {
      issues.push({ level: 'warn', text: 'может конфликтовать с ' + modTitle(t) + ' ' + t.info.version });
    }
  }
  for (const slot of state.values()) {
    if (slot.info.id === meta.id) continue;
    const dep = (slot.info.depends || {})[meta.id];
    if (dep && !satisfies(meta.version, dep)) {
      issues.push({ level: 'error', text: modTitle(slot) + ' требует версию ' + fmtConstraint(dep) });
    }
    const br = (slot.info.breaks || {})[meta.id];
    if (br && satisfies(meta.version, br)) {
      issues.push({ level: 'error', text: modTitle(slot) + ' ' + slot.info.version + ' с этой версией не работает' });
    }
    const soft = (slot.info.conflicts || {})[meta.id];
    if (soft && satisfies(meta.version, soft)) {
      issues.push({ level: 'warn', text: 'может конфликтовать с ' + modTitle(slot) + ' ' + slot.info.version });
    }
  }
  return issues;
}

// Сколько трафика тратим на поиск версии, которая встанет без замен: джарники
// бывают по десятку мегабайт, а проверка идёт фоном, пока открыта карточка.
const ALT_PROBE_COUNT = 6;
const ALT_PROBE_BYTES = 24 * 1024 * 1024;

/**
 * Проверка версии мода ДО установки: что о ней говорит автор на Modrinth
 * (обязательные и несовместимые проекты) и что написано в самом джарнике
 * (depends / breaks / conflicts против уже стоящих модов). Если версия не
 * встаёт без замен — ищем ту, что встанет (alt).
 */
async function checkCompat(gameDir, project, type, loader, mc, versionId) {
  const out = { ok: true, version: null, issues: [], alt: null, deep: false };
  if (type !== 'mod') return out; // паки и шейдеры друг другу не мешают
  if (project.slug === FAIR_FREECAM.slug || project.projectId === FAIR_FREECAM.projectId) return out;
  const version = await pickVersion(project.projectId, type, loader, mc, versionId || null);
  if (!version) {
    out.ok = false;
    out.issues.push({ level: 'error', text: 'под Minecraft ' + mc + ' / ' + loader + ' сборки нет' });
    return out;
  }
  out.version = { id: version.id, number: version.version_number || '' };

  const man = readManifest(gameDir);
  const mine = man.user.filter((e) => e.type === 'mod' && e.loader === loader && !e.pendingRemove && entryFitsMc(e, mc));
  const willInstall = [];
  for (const dep of version.dependencies || []) {
    if (!dep.project_id) continue;
    const have = mine.find((e) => e.projectId === dep.project_id);
    if (dep.dependency_type === 'incompatible' && have && have.enabled) {
      out.issues.push({ level: 'error', text: 'автор пометил мод несовместимым с ' + have.title });
    }
    if (dep.dependency_type === 'required' && !have
        && !(bundledApplies(loader, mc) && BUNDLED_PROJECTS.has(dep.project_id))) {
      willInstall.push(dep.project_id);
    }
  }
  if (willInstall.length) {
    try {
      const ps = await apiGet(API + '/projects?ids=' + encodeURIComponent(JSON.stringify(willInstall)));
      out.issues.push({ level: 'info', text: 'вместе с ним поставится: ' + ps.map((p) => p.title).join(', ') });
    } catch (_) { /* названия не узнали — не страшно */ }
  }
  if (loader !== 'fabric') return out;

  const raw = await metaOfVersion(version);
  if (!raw) return out;
  out.deep = true;
  const state = scanFabricState(gameDir, loader, mc);
  state.delete(raw.id); // сверяем с соседями, а не со своей же прежней версией
  out.issues.push(...compatIssues(state, withKnown(raw), loader, mc, willInstall.length > 0));

  if (out.issues.some((i) => i.level === 'error')) {
    const versions = await listProjectVersions(project.projectId, loader, mc);
    const queue = versions.filter((v) => v.version_type === 'release')
      .concat(versions.filter((v) => v.version_type !== 'release'))
      .filter((v) => v.id !== version.id);
    let probes = 0;
    let bytes = 0;
    for (const v of queue) {
      const f = (v.files || []).find((x) => x.primary) || (v.files || [])[0];
      const size = (f && f.size) || 0;
      if (probes >= ALT_PROBE_COUNT || bytes + size > ALT_PROBE_BYTES) break;
      probes++;
      bytes += size;
      const m2 = await metaOfVersion(v);
      if (!m2) continue;
      if (compatIssues(state, withKnown(m2), loader, mc, true).some((i) => i.level === 'error')) continue;
      out.alt = { id: v.id, number: v.version_number || '' };
      break;
    }
  }
  return out;
}

/** Моды под другие версии игры, которых под выбранную ещё нет: [{ title, forMc }]. */
function migrateCandidates(gameDir, loader, mc) {
  const user = readManifest(gameDir).user.filter((e) => e.type === 'mod' && e.loader === loader
    && !e.pendingRemove && e.projectId);
  const have = new Set(user.filter((e) => entryFitsMc(e, mc)).map((e) => e.projectId));
  const seen = new Set();
  const out = [];
  for (const e of user) {
    if (have.has(e.projectId) || seen.has(e.projectId)) continue;
    // на версии сервера эти моды уже есть во вшитой сборке — переносить нечего
    if (bundledApplies(loader, mc) && BUNDLED_PROJECTS.has(e.projectId)) continue;
    seen.add(e.projectId);
    out.push({ projectId: e.projectId, slug: e.slug, title: e.title, iconUrl: e.iconUrl || '',
      forMc: e.mc || BUNDLED_MC, enabled: e.enabled !== false });
  }
  return out;
}

/**
 * Перенести набор модов на выбранную версию игры: тем же модам ищем сборки под
 * неё. Записи под прежнюю версию остаются — на неё можно вернуться.
 */
async function migrateToMc(gameDir, loader, mc, log) {
  const summary = { installed: [], missing: [] };
  for (const c of migrateCandidates(gameDir, loader, mc)) {
    try {
      // глубина 1: общую сверку версий делаем один раз в конце, а не после каждого
      const res = await installContent(gameDir, c, 'mod', loader, mc, log, 1);
      if (res && res.ok) {
        summary.installed.push(c.title);
        if (!c.enabled) {
          const e = readManifest(gameDir).user.find((x) => x.projectId === c.projectId && x.type === 'mod'
            && x.loader === loader && entryFitsMc(x, mc));
          if (e) toggleUserContent(gameDir, 'mod', e.fileName, false);
        }
      } else {
        summary.missing.push(c.title);
        log('  ! ' + c.title + ': ' + ((res && res.error) || 'не установился'));
      }
    } catch (e) {
      summary.missing.push(c.title);
      log('  ! ' + c.title + ': ' + e.message);
    }
  }
  try { await enforceJarDeps(gameDir, loader, mc, log); } catch (_) { /* сеть — играем как есть */ }
  return summary;
}

// ── инвентаризация клиента для хартбита ─────────────────────────────────
/**
 * Что РЕАЛЬНО лежит в папке игры перед запуском — включая закинутое руками
 * мимо лаунчера. Уходит с хартбитом, показывается в админке сервера.
 * origin: bundled — вшит в сборку; launcher — поставлен менеджером модов;
 * manual — jar появился в mods/ мимо нас. id/версия — из fabric.mod.json
 * внутри jar (переименование файла реальный мод не спрячет).
 */
function collectClientInventory(gameDir, bundledDir, loader, mc = BUNDLED_MC) {
  const inv = { loader, mc, mods: [], resourcepacks: { installed: [], enabled: [] }, shaderpacks: [] };
  try {
    const m = readManifest(gameDir);
    const managed = new Set(m.user.filter((e) => e.type === 'mod').map((e) => e.fileName));
    const bundled = new Set(allBundled(bundledDir).keys());
    const dir = contentDir(gameDir, 'mod');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jar')) continue;
        const info = fabricModInfo(path.join(dir, f));
        inv.mods.push({
          file: f.slice(0, 100),
          id: info && info.id ? String(info.id).slice(0, 60) : null,
          version: info && info.version ? String(info.version).slice(0, 40) : null,
          origin: bundled.has(f) ? 'bundled' : managed.has(f) ? 'launcher' : 'manual',
        });
        if (inv.mods.length >= 150) break;
      }
    }
    const rpDir = path.join(gameDir, 'resourcepacks');
    if (fs.existsSync(rpDir)) {
      inv.resourcepacks.installed = fs.readdirSync(rpDir).slice(0, 80).map((f) => f.slice(0, 100));
    }
    try {
      const opts = fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8');
      const line = opts.split(/\r?\n/).find((l) => l.startsWith('resourcePacks:'));
      if (line) {
        const arr = JSON.parse(line.slice('resourcePacks:'.length));
        if (Array.isArray(arr)) {
          inv.resourcepacks.enabled = arr.slice(0, 80).map((s) => String(s).slice(0, 100));
        }
      }
    } catch (_) { /* options.txt нет или битый — не мешаем запуску */ }
    const shDir = path.join(gameDir, 'shaderpacks');
    if (fs.existsSync(shDir)) {
      inv.shaderpacks = fs.readdirSync(shDir).slice(0, 40).map((f) => f.slice(0, 100));
    }
  } catch (_) { /* инвентаризация не должна ломать запуск */ }
  return inv;
}

module.exports = {
  BUNDLED_MC,
  hasBundled,
  setLoaderVersion,
  setJavaMajor,
  diagnose,
  dependentsOf,
  projectVersions,
  checkCompat,
  migrateCandidates,
  migrateToMc,
  reviveAutoOff,
  enforceBlockedMods,
  listContent,
  searchContent,
  popularContent,
  projectDetails,
  installContent,
  toggleUserContent,
  toggleBundledMod,
  removeUserContent,
  disableModById,
  syncMods,
  enforceJarDeps,
  enforceFairFreecam,
  collectClientInventory,
  exportBuild,
  applyBuild,
  readZipEntry,
  // разбор версий — чистые функции, вынесены наружу для тестов
  fabricModInfo,
  usesIntermediary,
  envMismatch,
  satisfies,
  guessModVersion,
  cmpVer,
  parseVer,
};
