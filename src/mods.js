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
const { fetch, Agent } = require('undici');

const API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'MistMC-Launcher/1.2.0 (mistmc.gg)';
// Вшитые в сборку Mist MC моды (fabric): ставить их из каталога нельзя —
// вторая копия с другой версией = дубль mod id и краш Fabric-лоадера.
// fabric-api / modmenu / cloth-config (project id с Modrinth).
const BUNDLED_PROJECTS = new Set(['P7dR8mSH', 'mOgUt4GM', '9s6osm5g']);

const agent = new Agent({ connect: { timeout: 10000 }, headersTimeout: 15000, bodyTimeout: 300000 });

// ── доступность Modrinth: прямой доступ + прокси-фолбэк через mistmc.gg ──
// У части провайдеров прямой доступ к Modrinth деградирует/висит. Если прямой
// запрос не ответил заголовками за 10с — повторяем через наш прокси
// (mistmc.gg/modrinth-api|cdn) и «прилипаем» к нему на 5 минут.
const DIRECT_HEADER_TIMEOUT = 10_000;
const PROXY_STICKY_MS = 5 * 60_000;
let preferProxyUntil = 0;

function toProxyUrl(url) {
  return url
    .replace('https://api.modrinth.com/', 'https://mistmc.gg/modrinth-api/')
    .replace('https://cdn.modrinth.com/', 'https://mistmc.gg/modrinth-cdn/');
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
  const proxied = toProxyUrl(url);
  const useProxyFirst = Date.now() < preferProxyUntil && proxied !== url;
  const order = useProxyFirst ? [proxied, url] : [url, proxied];
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
]);
const ALLOW_SLUGS = new Set(['legacyfreecam']);
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
    { slug: 'simple-voice-chat', ru: 'Голосовой чат SVC — работает на Mist MC' },
    { slug: 'plasmo-voice', ru: 'Голосовой чат Plasmo — работает на Mist MC' },
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

function listContent(gameDir, type, loader, bundledDir) {
  const m = readManifest(gameDir);
  const bundled = type === 'mod' && loader === 'fabric'
    ? bundledJars(bundledDir).map((f) => ({
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
  // моды отдаём ВСЕ (и чужого загрузчика) — renderer покажет их приглушённо
  // с пометкой, чтобы смена сборки не выглядела как «моды удалились»;
  // ожидающие удаления (pendingRemove) для UI уже не существуют
  return {
    bundled,
    user: alive.filter((e) => e.type === type && !e.pendingRemove),
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
      return await apiGet(API + '/version/' + encodeURIComponent(pinnedVersionId));
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
function pinFromInstalled(m, projectId, loader) {
  for (const e of m.user) {
    if (e.type !== 'mod' || e.loader !== loader) continue;
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

async function installContent(gameDir, project, type, loader, mcVersion, log, depth = 0, pinnedVersionId = null) {
  if (isBlocked([project.slug, project.title, project.description].filter(Boolean).join(' '), project.slug)) {
    return { ok: false, error: 'Этот мод запрещён на Mist MC' };
  }
  // вшитый в сборку мод уже стоит — вторая копия уронит Fabric
  if (type === 'mod' && loader === 'fabric' && BUNDLED_PROJECTS.has(project.projectId)) {
    return { ok: true, already: true };
  }
  const t = typeInfo(type);
  const m = readManifest(gameDir);

  const existing = m.user.find((e) => e.projectId === project.projectId && e.type === type
      && (!t.perLoader || e.loader === loader));

  // pinnedVersionId приходит от enforceJarDeps — это АВТОРИТЕТ (посчитан по
  // fabric.mod.json всех установленных модов), выполняем даже заменой стоящей
  // версии. Пин Modrinth («с чем тестировали») — МЯГКИЙ: только при первой
  // установке. Раньше он применялся всегда и утаскивал уже стоящий мод назад:
  // Iris пинил Sodium 0.8.7 поверх 0.8.13, и Sodium Extra (>=0.8.13) падал.
  let pin = pinnedVersionId;
  if (!pin && !existing && type === 'mod') {
    const found = pinFromInstalled(m, project.projectId, loader);
    if (found) {
      pin = found.versionId;
      log('  ⚑ версия закреплена модом ' + found.by + ' (совместимость)');
    }
  }

  if (existing && (!pinnedVersionId || existing.versionId === pinnedVersionId)) {
    return { ok: true, already: true };
  }

  const version = await pickVersion(project.projectId, type, loader, mcVersion, pin);
  if (!version) {
    return { ok: false, error: 'Нет сборки под ' + mcVersion + (type === 'mod' ? ' / ' + loader : '') };
  }
  if (existing && existing.versionId === version.id) {
    return { ok: true, already: true };
  }
  const file = (version.files || []).find((f) => f.primary) || (version.files || [])[0];
  if (!file) return { ok: false, error: 'У версии нет файлов' };

  // замена несовместимой версии: сносим старый файл и запись
  if (existing) {
    log('  ⟳ ' + existing.title + ': ' + (existing.versionNumber || '?') + ' → ' + (version.version_number || '?'));
    removeUserContent(gameDir, type, existing.fileName);
  }

  fs.mkdirSync(contentDir(gameDir, type), { recursive: true });
  const fileName = path.basename(file.filename).replace(/[\\/:*?"<>|]/g, '_');
  await downloadTo(file.url, path.join(contentDir(gameDir, type), fileName), log);

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
  });
  writeManifest(gameDir, fresh);
  log('✓ Установлен ' + (project.title || fileName) + ' ' + (version.version_number || ''));

  // обязательные зависимости — только у модов (fabric-api вшит, пропускаем)
  if (type === 'mod' && depth < 4) {
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      if (loader === 'fabric' && BUNDLED_PROJECTS.has(dep.project_id)) continue;
      const cur = readManifest(gameDir);
      const have = cur.user.find((e) => e.projectId === dep.project_id && e.type === 'mod' && e.loader === loader);
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
  const buf = fs.readFileSync(file);
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

/** fabric.mod.json джарника: { id, version, depends } (null — не фабрик-мод). */
function fabricModInfo(file) {
  try {
    const raw = readZipEntry(file, 'fabric.mod.json');
    if (!raw) return null;
    const j = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''));
    return { id: j.id, version: String(j.version || ''), depends: j.depends || {} };
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
  const m = s.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], m[3] === undefined ? 0 : +m[3]], pre: m[4] || null };
}

/** Сравнение по semver: пререлиз меньше релиза (0.8.14-beta.1 < 0.8.14). */
function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
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

/** Версия мода из строки Modrinth («mc1.21.11-0.8.13-fabric» → «0.8.13»). */
function guessModVersion(versionNumber, mcVersion) {
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let s = String(versionNumber || '');
  s = s.replace(new RegExp('mc' + esc(mcVersion), 'gi'), ' ');
  s = s.replace(new RegExp(esc(mcVersion), 'g'), ' ');
  s = s.replace(/\b(fabric|forge|neoforge|quilt)\b/gi, ' ');
  const m = s.match(/(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z][0-9A-Za-z.]*)?)/);
  return m ? m[1] : null;
}

/**
 * Сверка требований установленных модов друг к другу по fabric.mod.json —
 * ЕДИНСТВЕННЫЙ авторитет по версиям (пины Modrinth = лишь «с чем тестировали»).
 * Собираем ВСЕ требования на каждый мод (точные и диапазоны), и если стоящая
 * версия хоть одно нарушает — ставим самую свежую, устраивающую ВСЕХ сразу.
 * Классический кейс: Iris пинил Sodium 0.8.7, а Sodium Extra требует >=0.8.13 →
 * игра падала на старте; теперь выбирается 0.8.13, подходящий обоим.
 * Сеть упала — молча выходим, играем как есть.
 */
async function enforceJarDeps(gameDir, loader, mcVersion, log) {
  if (loader !== 'fabric') return;
  const m = readManifest(gameDir);
  const active = m.user.filter((e) => e.type === 'mod' && e.loader === loader
    && e.enabled && !e.pendingRemove);
  // modid → манифест-запись + фактическая версия из jar
  const byModId = new Map();
  const infos = [];
  for (const e of active) {
    const p = filePathOf(gameDir, e);
    if (!fs.existsSync(p)) continue;
    const info = fabricModInfo(p);
    if (!info || !info.id) continue;
    byModId.set(info.id, { entry: e, version: info.version });
    infos.push({ entry: e, info });
  }

  // modid → [{by, constraint}] по всем установленным модам
  const wants = new Map();
  for (const { entry, info } of infos) {
    for (const [depId, constraint] of Object.entries(info.depends || {})) {
      if (depId === info.id || !byModId.has(depId)) continue; // не наш управляемый мод
      if (!wants.has(depId)) wants.set(depId, []);
      wants.get(depId).push({ by: entry.title, constraint });
    }
  }

  for (const [depId, reqs] of wants) {
    const have = byModId.get(depId);
    const bad = reqs.filter((r) => !satisfies(have.version, r.constraint));
    if (!bad.length) continue;
    log('⚑ ' + have.entry.title + ' ' + have.version + ' не устраивает: '
      + bad.map((r) => r.by + ' требует ' + fmtConstraint(r.constraint)).join('; ')
      + ' — подбираю версию');
    try {
      const versions = await apiGet(API + '/project/'
        + encodeURIComponent(have.entry.projectId) + '/version?loaders='
        + encodeURIComponent(JSON.stringify([loader]))
        + '&game_versions=' + encodeURIComponent(JSON.stringify([mcVersion])));
      // версия должна устраивать ВСЕ требования разом, не только нарушенные
      const fits = (versions || [])
        .map((v) => ({ v, ver: guessModVersion(v.version_number, mcVersion) }))
        .filter((c) => c.ver && reqs.every((r) => satisfies(c.ver, r.constraint)));
      // API отдаёт от новых к старым; стабильную предпочитаем бете
      const pick = fits.find((c) => c.v.version_type === 'release') || fits[0];
      if (!pick) {
        log('  ! под ' + mcVersion + ' нет версии ' + have.entry.title
          + ', устраивающей все моды — выключи один из конфликтующих');
        continue;
      }
      log('  → ' + have.entry.title + ' ' + have.version + ' → ' + pick.ver);
      await installContent(gameDir, {
        projectId: have.entry.projectId,
        slug: have.entry.slug,
        title: have.entry.title,
        iconUrl: have.entry.iconUrl || '',
      }, 'mod', loader, mcVersion, log, 4, pick.v.id);
    } catch (e2) {
      log('  ! не удалось привести версию: ' + e2.message);
    }
  }
}

// ── синхронизация модов перед запуском ─────────────────────────────────
// В mods/ активны только моды ТЕКУЩЕГО загрузчика (чужие уходят в .disabled —
// иначе Forge спотыкается о fabric-джарники и наоборот); вшитая сборка Mist MC
// докладывается для Fabric с учётом выключенных. Паки/шейдеры не трогаем —
// они кроссверсионные и не зависят от загрузчика.
function syncMods(gameDir, loader, bundledDir, log) {
  fs.mkdirSync(contentDir(gameDir, 'mod'), { recursive: true });
  const m = readManifest(gameDir);
  const bundled = bundledJars(bundledDir);

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

  for (const f of bundled) {
    const dest = path.join(contentDir(gameDir, 'mod'), f);
    const wanted = loader === 'fabric' && !m.bundledDisabled.includes(f);
    try {
      if (wanted) {
        fs.copyFileSync(path.join(bundledDir, f), dest);
        log('  + мод ' + f);
      } else if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
        log('  − мод ' + f + (loader === 'fabric' ? ' (выключен)' : ' (не для ' + loader + ')'));
      }
    } catch (e) {
      log('  ! ' + f + ': ' + e.message);
    }
  }

  for (const entry of m.user) {
    if (entry.type !== 'mod' || entry.pendingRemove) continue;
    const on = filePathOf(gameDir, entry);
    const off = on + '.disabled';
    const wanted = entry.enabled && entry.loader === loader;
    try {
      if (wanted && fs.existsSync(off) && !fs.existsSync(on)) fs.renameSync(off, on);
      if (!wanted && fs.existsSync(on)) fs.renameSync(on, fs.existsSync(off) ? on + '.disabled2' : off);
      if (wanted && fs.existsSync(on)) log('  + мод ' + entry.fileName);
    } catch (e) {
      log('  ! ' + entry.fileName + ': ' + e.message);
    }
  }
}

// ── сборка игрока: экспорт кодом и применение ───────────────────────────
/**
 * Что игрок поставил САМ (вшитые моды Mist MC не включаем — они и так есть
 * у каждого). Версии сохраняем поимённо: смысл кода сборки в том, чтобы у
 * друга собралось ровно то же, а не «примерно похожее».
 */
function exportBuild(gameDir, loader) {
  const m = readManifest(gameDir);
  const items = m.user
    .filter((e) => !e.pendingRemove && (e.type !== 'mod' || e.loader === loader))
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
  return { loader, items, bundledDisabled: m.bundledDisabled || [] };
}

/**
 * Применить чужую сборку: доставить недостающее. Уже стоящее не трогаем и
 * ничего не удаляем — игрок делится сборкой, а не стирает чужие моды.
 * Возвращает сводку для UI.
 */
async function applyBuild(gameDir, build, mcVersion, log) {
  const loader = build && build.loader === 'forge' ? 'forge' : 'fabric';
  const items = Array.isArray(build && build.items) ? build.items : [];
  const summary = { installed: [], already: [], failed: [], loader };
  for (const it of items) {
    if (!it || !it.projectId) continue;
    const type = TYPES[it.type] ? it.type : 'mod';
    try {
      const res = await installContent(
        gameDir,
        { projectId: it.projectId, slug: it.slug, title: it.title, iconUrl: it.iconUrl || '' },
        type, loader, mcVersion, log, 0, it.versionId || null,
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
function collectClientInventory(gameDir, bundledDir, loader) {
  const inv = { loader, mods: [], resourcepacks: { installed: [], enabled: [] }, shaderpacks: [] };
  try {
    const m = readManifest(gameDir);
    const managed = new Set(m.user.filter((e) => e.type === 'mod').map((e) => e.fileName));
    const bundled = new Set(bundledJars(bundledDir));
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
  listContent,
  searchContent,
  popularContent,
  projectDetails,
  installContent,
  toggleUserContent,
  toggleBundledMod,
  removeUserContent,
  syncMods,
  enforceJarDeps,
  collectClientInventory,
  exportBuild,
  applyBuild,
  // разбор версий — чистые функции, вынесены наружу для тестов
  satisfies,
  guessModVersion,
  cmpVer,
  parseVer,
};
