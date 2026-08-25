'use strict';

const $ = (id) => document.getElementById(id);

// Мок для предпросмотра в обычном браузере (без Electron): дизайн смотрибелен,
// кнопки не падают. В собранном лаунчере window.api приходит из preload.
if (!window.api) {
  const noop = () => {};
  window.api = {
    getConfig: async () => ({
      config: { ram: 4096, loader: 'fabric', joinServer: true, gameDir: 'C:\\…\\.mistmc' },
      versionInfo: { mc: '1.21.11', fabric: '0.19.3', forge: '61.1.0', launcher: '1.5.5' },
      account: null,
    }),
    saveConfig: async () => true,
    pickDir: async () => null,
    launch: async () => ({ ok: false, error: 'предпросмотр' }),
    msLogin: async () => ({ ok: false, error: 'предпросмотр' }),
    offlineLogin: async (n) => ({ ok: true, account: { type: 'offline', name: n, uuid: '0' } }),
    logout: async () => true,
    modsList: async () => ({ ok: true, bundled: [], user: [] }),
    modsSearch: async () => ({ ok: true, hits: [] }),
    modsPopular: async () => ({
      ok: true,
      hits: Array.from({ length: 8 }, (_, i) => ({
        projectId: 'demo' + i, slug: 'demo' + i, title: 'Демо-мод №' + (i + 1),
        description: 'Русское описание для предпросмотра', iconUrl: '', downloads: (8 - i) * 1e6,
      })),
    }),
    modInstall: async () => ({ ok: false, error: 'предпросмотр' }),
    modToggle: async () => ({ ok: true }),
    modRemove: async () => ({ ok: true }),
    communityVote: async () => ({ ok: true, rating: { likes: 1, dislikes: 0, mine: 1 } }),
    communityRatings: async () => ({ ok: true, ratings: [] }),
    communityTop: async () => ({ ok: true, top: [] }),
    cosmeticsList: async () => ({ ok: true, balance: 3500, owned: ['cape', 'flag', 'beanie'],
      equipped: { cape: 'cape' }, slotTitles: { hat: 'Голова', back: 'Спина', cape: 'Плащ', hand: 'В руке', balloon: 'Шарик' },
      catalog: [
        { id: 'beanie', slot: 'hat', name: 'Шапка', color: '#ef4444', desc: 'Вязаная шапка. Перекрашивается в любой цвет.', priceSparks: 700, priceRub: 99, launcherOnly: true },
        { id: 'cape', slot: 'cape', name: 'Свой плащ', color: '#a855f7', drawable: 'cape', desc: 'Рисуешь плащ сам в лаунчере. После проверки модератором его видят все.', priceSparks: 2000, priceRub: 249, launcherOnly: true },
        { id: 'future_wings', slot: 'back', name: 'Крылья', color: '#d24c9f', desc: 'Светящиеся крылья за спиной.', priceSparks: 2500, priceRub: 299, launcherOnly: true },
        { id: 'flag', slot: 'hand', name: 'Свой флаг', color: '#f59e0b', drawable: 'flag', desc: 'Древко с полотнищем, которое рисуешь сам.', priceSparks: 1500, priceRub: 189, launcherOnly: true },
        { id: 'kite', slot: 'balloon', name: 'Воздушный змей', color: '#0ea5e9', desc: 'Змей летит за тобой на верёвочке.', priceSparks: 1400, priceRub: 179, launcherOnly: true },
      ] }),
    cosmeticsAction: async () => ({ ok: false, error: 'предпросмотр' }),
    drawingsList: async () => ({ ok: true, textureUrl: '',
      canvas: {
        cape: { w: 128, h: 64, draw: { x: 2, y: 2, w: 20, h: 32 } },
        flag: { w: 64, h: 64, draw: { x: 0, y: 0, w: 56, h: 40 } },
      },
      drawings: {} }),
    drawingSubmit: async () => ({ ok: false, error: 'предпросмотр' }),
    cosmeticAssets: async () => ({ ok: false, error: 'предпросмотр' }),
    cosmeticDrawnModel: async () => ({ ok: false, error: 'предпросмотр' }),
    skinApply: async () => ({ ok: false, error: 'предпросмотр' }),
    skinReset: async () => ({ ok: false, error: 'предпросмотр' }),
    buildShare: async () => ({ ok: true, code: 'K7M2QP', reused: false,
      filesInfo: { configs: 12, options: true, shaders: 1, bytes: 40000 } }),
    buildPreview: async () => ({ ok: true, code: 'K7M2QP', author: 'M1ke2', items: 5,
      filesInfo: { configs: 12, options: true, shaders: 1, bytes: 40000 } }),
    buildApply: async () => ({ ok: false, error: 'предпросмотр' }),
    modDetails: async () => ({
      ok: true,
      project: {
        projectId: 'demo0', slug: 'demo0', title: 'Демо-мод', iconUrl: '',
        description: 'Русское описание для предпросмотра', downloads: 12345678,
        body: '# Demo mod\n\nFull **description** for modal preview.\n\n[Site link](https://mistmc.gg) and `code`.',
        bodyRu: '# Демо-мод\n\nПолное **описание** для предпросмотра модалки.\n\n[Ссылка на сайт](https://mistmc.gg) и `код`.',
        descriptionRu: null,
        gallery: [],
      },
    }),
    openGameDir: async () => ({ ok: true }),
    pickBgImage: async () => ({ ok: false, canceled: true }),
    // (в браузере файл не выбрать — мок оставляем пустым)
    clearBgImage: async () => ({ ok: true }),
    openExternal: noop, minimize: noop, close: noop,
    onProgress: noop, onStatus: noop, onLog: noop, onState: noop,
    onLaunchError: noop, onAuthExpired: noop, onUpdateState: noop,
  };
}

const els = {
  // шапка
  btnHeaderLogin: $('btn-header-login'),
  accChip: $('acc-chip'),
  accAvatar: $('acc-avatar'),
  accAvatarFallback: $('acc-avatar-fallback'),
  accChipName: $('acc-chip-name'),
  accChipType: $('acc-chip-type'),
  accMenu: $('acc-menu'),
  menuSwitch: $('menu-switch'),
  menuLogout: $('menu-logout'),
  tabs: $('tabs'),
  // игра
  viewGame: $('view-game'),
  ram: $('ram'),
  ramVal: $('ram-val'),
  joinServer: $('joinServer'),
  discordRpc: $('discordRpc'),
  gameDir: $('gameDir'),
  btnDir: $('btn-dir'),
  btnOpenDir: $('btn-open-dir'),
  btnPlay: $('btn-play'),
  status: $('status'),
  progressBar: $('progress-bar'),
  logbox: $('logbox'),
  btnLog: $('btn-log'),
  loader: $('loader'),
  loaderHint: $('loader-hint'),
  mcVer: $('mc-ver'),
  verLine: $('ver-line'),
  linkSite: $('link-site'),
  // моды
  viewMods: $('view-mods'),
  viewCosmetics: $('view-cosmetics'),
  cosmGrid: $('cosm-grid'),
  cosmHint: $('cosm-hint'),
  walletBalance: $('wallet-balance'),
  cosmView: $('cosm-view'),
  cosmViewName: $('cosm-view-name'),
  cosmViewHint: $('cosm-view-hint'),
  cosmTypes: $('cosm-types'),
  cosmScroll: $('cosm-scroll'),
  cosmSkin: $('cosm-skin'),
  skinPick: $('skin-pick'),
  skinFile: $('skin-file'),
  skinApply: $('skin-apply'),
  skinReset: $('skin-reset'),
  skinSlim: $('skin-slim'),
  skinHint: $('skin-hint'),
  // редактор плаща/флага
  drawOverlay: $('draw-overlay'),
  drawTitle: $('draw-title'),
  drawSub: $('draw-sub'),
  drawCanvas: $('draw-canvas'),
  drawPreview: $('draw-preview'),
  drawPalette: $('draw-palette'),
  drawZones: $('draw-zones'),
  drawColor: $('draw-color'),
  drawUndo: $('draw-undo'),
  drawClear: $('draw-clear'),
  drawImport: $('draw-import'),
  drawFile: $('draw-file'),
  drawSend: $('draw-send'),
  drawClose: $('draw-close'),
  drawStatus: $('draw-status'),
  drawHint: $('draw-hint'),
  contentTypes: $('content-types'),
  modQuery: $('mod-query'),
  btnModSearch: $('btn-mod-search'),
  modsLoaderHint: $('mods-loader-hint'),
  modsBody: $('mods-body'),
  modsVanilla: $('mods-vanilla'),
  listInstalled: $('list-installed'),
  listResults: $('list-results'),
  secResults: $('sec-results'),
  resultsTitle: $('results-title'),
  // модалка мода
  modOverlay: $('mod-overlay'),
  modmIcon: $('modm-icon'),
  modmTitle: $('modm-title'),
  modmDownloads: $('modm-downloads'),
  modmLink: $('modm-link'),
  modmLang: $('modm-lang'),
  modmLinkSep: $('modm-linksep'),
  modmClose: $('modm-close'),
  modmGallery: $('modm-gallery'),
  modmGalImg: $('modm-galimg'),
  modmPrev: $('modm-prev'),
  modmNext: $('modm-next'),
  modmGalCount: $('modm-galcount'),
  modmBody: $('modm-body'),
  modmHint: $('modm-hint'),
  modmInstall: $('modm-install'),
  modmLike: $('modm-like'),
  modmDislike: $('modm-dislike'),
  modmLikes: $('modm-likes'),
  modmDislikes: $('modm-dislikes'),
  resultsMode: $('results-mode'),
  // модалка
  loginOverlay: $('login-overlay'),
  modalClose: $('modal-close'),
  nickInput: $('nick-input'),
  btnNickLogin: $('btn-nick-login'),
  nickError: $('nick-error'),
  btnMsLogin: $('btn-ms-login'),
  msError: $('ms-error'),
  // окно
  btnMin: $('btn-min'),
  btnClose: $('btn-close'),
  btnUpdate: $('btn-update'),
};

const state = {
  loader: 'fabric',
  gameDir: '',
  account: null, // { type, name, uuid }
  busy: false,
  tab: 'game',
  contentType: 'mod', // mod | resourcepack | shader
  installedIds: new Set(), // projectId установленных текущего типа
  lastHits: [],
  filterQuery: '', // текст из поиска фильтрует и список установленных
  resultsMode: 'popular', // popular = подборка Modrinth | top = топ игроков
  ratings: new Map(), // projectId → { likes, dislikes, mine }
  theme: {},          // цвета и фон из настроек
  bgMedia: null,      // фон окна: { url, kind: 'image' | 'video' }
};

const CTYPE_HINTS = {
  mod: () => 'Каталог Modrinth для Minecraft 1.21.11 · моды под ' + (state.loader === 'fabric' ? 'Fabric' : 'Forge'),
  resourcepack: () => 'Ресурспаки — включаются в игре: Настройки → Наборы ресурсов',
  shader: () => 'Шейдеры работают через мод Iris (поставь его во вкладке «Моды»); включаются в игре: Настройки → Шейдеры',
};

const LOADER_HINTS = {
  fabric: 'Fabric — рекомендуется, с модами Mist MC',
  forge: 'Forge — для модпаков на Forge',
  vanilla: 'Vanilla — чистый клиент без модов',
};
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

// Журнал: строки добавляются отдельными текстовыми узлами с потолком по
// количеству. Раньше было `textContent += line` — на каждую строку Chromium
// пересобирал ВЕСЬ текст журнала и делал перелайаут; за долгую сессию журнал
// разрастался до мегабайт, и каждое сообщение в игровом чате (в рантайме в
// stdout игры попадают практически только [CHAT]-строки) стоило десятки мс CPU
// даже у свёрнутого окна — у игроков это выглядело как микрофриз игры при
// появлении сообщения. Скролл трогаем только когда журнал реально виден.
const LOG_MAX_LINES = 1500;
let logLines = 0;
function log(line) {
  const box = els.logbox;
  box.appendChild(document.createTextNode(line + '\n'));
  if (++logLines > LOG_MAX_LINES) {
    box.removeChild(box.firstChild);
    logLines--;
  }
  if (!box.hidden && document.visibilityState === 'visible') {
    box.scrollTop = box.scrollHeight;
  }
}

function setProgress(percent) {
  if (percent < 0) {
    els.progressBar.classList.add('indeterminate');
  } else {
    els.progressBar.classList.remove('indeterminate');
    els.progressBar.style.width = percent + '%';
  }
}

// ── плавность: показ/скрытие оверлеев и перезапуск анимаций ─────────────
// Закрытие даём доиграть (класс closing в CSS), поэтому hidden ставим по
// таймеру; повторное открытие таймер отменяет — иначе окно спрячется само.
const closeTimers = new WeakMap();
const CLOSE_MS = 140;

function openOverlay(el) {
  const t = closeTimers.get(el);
  if (t) { clearTimeout(t); closeTimers.delete(el); }
  el.classList.remove('closing');
  el.hidden = false;
}

function closeOverlay(el) {
  if (el.hidden || closeTimers.has(el)) return;
  el.classList.add('closing');
  closeTimers.set(el, setTimeout(() => {
    closeTimers.delete(el);
    el.classList.remove('closing');
    el.hidden = true;
  }, CLOSE_MS));
}

/** Перезапустить CSS-анимацию класса на элементе (нужен reflow). */
function replayAnim(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Лёгкая «лесенка» появления списка — первые строки заметно, дальше без задержки. */
function stagger(list) {
  [...list.children].forEach((row, i) => {
    row.style.animationDelay = Math.min(i * 22, 220) + 'ms';
  });
}

function fmtDownloads(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
  return String(n);
}

// ── аккаунт в шапке ─────────────────────────────────────────────────────
function updateAccountUI() {
  const acc = state.account;
  els.btnHeaderLogin.hidden = !!acc;
  els.accChip.hidden = !acc;
  els.accMenu.hidden = true;
  if (acc) {
    els.accChipName.textContent = acc.name;
    els.accChipType.textContent = acc.type === 'msa' ? 'Microsoft' : 'по нику';
    // Голова скина: для msa по uuid (реальный скин), для оффлайна по нику.
    const key = acc.type === 'msa' && acc.uuid ? acc.uuid.replace(/-/g, '') : acc.name;
    els.accAvatar.hidden = false;
    els.accAvatarFallback.hidden = true;
    els.accAvatar.src = 'https://mc-heads.net/avatar/' + encodeURIComponent(key) + '/24';
  }
  els.btnPlay.disabled = state.busy || !acc;
}
els.accAvatar.addEventListener('error', () => {
  // офлайн без интернета/скина — рисуем кружок с первой буквой
  els.accAvatar.hidden = true;
  els.accAvatarFallback.hidden = false;
  els.accAvatarFallback.textContent = (state.account ? state.account.name[0] : '?').toUpperCase();
});

function setBusy(busy) {
  state.busy = busy;
  els.btnPlay.disabled = busy || !state.account;
}

function persist() {
  window.api.saveConfig({
    ram: parseInt(els.ram.value, 10),
    loader: state.loader,
    joinServer: els.joinServer.checked,
    discordRpc: els.discordRpc.checked,
    gameDir: state.gameDir,
  });
}

// ── модалка входа ───────────────────────────────────────────────────────
function openLogin() {
  els.nickError.hidden = true;
  els.msError.hidden = true;
  els.nickInput.value = state.account && state.account.type === 'offline' ? state.account.name : '';
  openOverlay(els.loginOverlay);
  setTimeout(() => els.nickInput.focus(), 30);
}
function closeLogin() {
  closeOverlay(els.loginOverlay);
}

async function doNickLogin() {
  const nick = els.nickInput.value.trim();
  if (!NICK_RE.test(nick)) {
    els.nickError.textContent = 'Ник: 3–16 символов, латиница/цифры/подчёркивание';
    els.nickError.hidden = false;
    return;
  }
  const res = await window.api.offlineLogin(nick);
  if (res && res.ok) {
    state.account = res.account;
    closeLogin();
    els.status.textContent = 'Привет, ' + res.account.name + '! Готов к запуску';
    updateAccountUI();
  } else {
    els.nickError.textContent = (res && res.error) || 'Не удалось войти';
    els.nickError.hidden = false;
  }
}

async function doMsLogin() {
  els.msError.hidden = true;
  els.btnMsLogin.disabled = true;
  const res = await window.api.msLogin();
  els.btnMsLogin.disabled = false;
  if (res && res.ok) {
    state.account = res.account;
    closeLogin();
    els.status.textContent = 'Вы вошли как ' + res.account.name;
    updateAccountUI();
  } else {
    els.msError.textContent = (res && res.error) || 'Вход не удался';
    els.msError.hidden = false;
  }
}

// ── вкладки ─────────────────────────────────────────────────────────────
// Косметика временно выключена: кнопка скрыта (hidden в index.html), а вкладка
// недоступна даже по прямому вызову. Вернуть — true здесь + снять hidden.
const COSMETICS_ENABLED = true;

function setTab(tab) {
  if (tab === 'cosmetics' && !COSMETICS_ENABLED) tab = 'game';
  state.tab = tab;
  for (const b of els.tabs.querySelectorAll('.tab')) {
    b.classList.toggle('active', b.dataset.tab === tab);
  }
  els.viewGame.hidden = tab !== 'game';
  els.viewMods.hidden = tab !== 'mods';
  els.viewCosmetics.hidden = tab !== 'cosmetics';
  if (tab === 'cosmetics') loadCosmetics();
  if (tab === 'mods') {
    refreshModsView();
    // при первом заходе сразу показываем подборку
    if (!state.lastHits.length && !els.modQuery.value.trim()
        && !(state.contentType === 'mod' && state.loader === 'vanilla')) {
      doSearch();
    }
  }
}

function setContentType(ctype) {
  state.contentType = ctype;
  state.lastHits = [];
  els.modQuery.value = '';
  state.filterQuery = '';
  els.secResults.hidden = true;
  for (const b of els.contentTypes.querySelectorAll('.ctype')) {
    b.classList.toggle('active', b.dataset.ctype === ctype);
  }
  refreshModsView();
  if (!(ctype === 'mod' && state.loader === 'vanilla')) doSearch();
}

// ── моды ────────────────────────────────────────────────────────────────
function modIcon(url, title) {
  const wrap = document.createElement('div');
  wrap.className = 'mod-icon';
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); wrap.textContent = (title || '?')[0].toUpperCase(); });
    wrap.appendChild(img);
  }
  if (!url) wrap.textContent = (title || '?')[0].toUpperCase();
  return wrap;
}

function toggleEl(checked, onChange) {
  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const slider = document.createElement('span');
  slider.className = 'slider';
  label.append(input, slider);
  input.addEventListener('change', () => onChange(input.checked, input));
  return label;
}

function installedRow(mod, bundled, foreign) {
  const row = document.createElement('div');
  row.className = 'mod-row' + (mod.enabled ? '' : ' mod-off') + (foreign ? ' mod-foreign' : '');
  row.appendChild(modIcon(mod.iconUrl, mod.title));

  const meta = document.createElement('div');
  meta.className = 'mod-meta';
  const t = document.createElement('div');
  t.className = 'mod-title';
  t.textContent = mod.title;
  const s = document.createElement('div');
  s.className = 'mod-sub';
  s.textContent = foreign
    ? 'мод для ' + (mod.loader === 'fabric' ? 'Fabric' : 'Forge') + ' — заработает при смене сборки, файл на месте'
    : bundled ? 'Сборка Mist MC' : (mod.versionNumber ? 'v' + mod.versionNumber : 'установлен из Modrinth');
  meta.append(t, s);
  row.appendChild(meta);

  // клик по строке (не по управлению) — карточка мода; у вшитых нет projectId
  if (!bundled && mod.projectId) {
    row.classList.add('clickable');
    row.addEventListener('click', (e) => {
      if (e.target.closest('.mod-controls')) return;
      openModModal(mod);
    });
  }

  const controls = document.createElement('div');
  controls.className = 'mod-controls';
  const ctype = state.contentType;
  if (foreign) {
    const badge = document.createElement('span');
    badge.className = 'mod-dl';
    badge.textContent = mod.loader === 'fabric' ? 'Fabric' : 'Forge';
    controls.appendChild(badge);
    const del = document.createElement('button');
    del.className = 'mod-del';
    del.title = 'Удалить';
    del.textContent = '✕';
    del.addEventListener('click', async () => {
      const res = await window.api.modRemove(ctype, mod.fileName);
      if (res && res.ok) refreshModsView();
    });
    controls.appendChild(del);
    row.appendChild(controls);
    return row;
  }
  controls.appendChild(toggleEl(mod.enabled, async (on, input) => {
    input.disabled = true;
    const res = await window.api.modToggle(ctype, mod.fileName, on, bundled);
    input.disabled = false;
    if (!res || !res.ok) {
      input.checked = !on;
      els.status.textContent = 'Не удалось переключить: ' + ((res && res.error) || '?');
      return;
    }
    mod.enabled = on;
    row.classList.toggle('mod-off', !on);
  }));
  if (!bundled) {
    const del = document.createElement('button');
    del.className = 'mod-del';
    del.title = 'Удалить';
    del.textContent = '✕';
    del.addEventListener('click', async () => {
      const res = await window.api.modRemove(ctype, mod.fileName);
      if (res && res.ok) {
        state.installedIds.delete(mod.projectId);
        refreshModsView();
        renderResults(state.lastHits);
      }
    });
    controls.appendChild(del);
  }
  row.appendChild(controls);
  return row;
}

async function refreshModsView() {
  // моды бессмысленны на Vanilla; паки и шейдеры от загрузчика не зависят
  const isVanilla = state.contentType === 'mod' && state.loader === 'vanilla';
  els.modsBody.hidden = isVanilla;
  els.modsVanilla.hidden = !isVanilla;
  els.modsLoaderHint.textContent = isVanilla ? '' : CTYPE_HINTS[state.contentType]();
  if (isVanilla) return;

  const data = await window.api.modsList(state.contentType, state.loader);
  els.listInstalled.replaceChildren();
  // фильтр установленных по строке поиска — чтобы не листать всё подряд
  const q = state.filterQuery.toLowerCase();
  const match = (m) => !q
    || (m.title || '').toLowerCase().includes(q)
    || (m.slug || '').toLowerCase().includes(q)
    || (m.fileName || '').toLowerCase().includes(q);
  const currentAll = (data.user || []).filter((m) => !m.loader || m.loader === state.loader);
  state.installedIds = new Set(currentAll.map((m) => m.projectId));
  const bundled = (data.bundled || []).filter(match);
  const current = currentAll.filter(match);
  const foreign = (data.user || []).filter((m) => m.loader && m.loader !== state.loader).filter(match);
  for (const m of bundled) els.listInstalled.appendChild(installedRow(m, true, false));
  for (const m of current) els.listInstalled.appendChild(installedRow(m, false, false));
  for (const m of foreign) els.listInstalled.appendChild(installedRow(m, false, true));
  if (!els.listInstalled.children.length) {
    const empty = document.createElement('div');
    empty.className = 'mods-empty';
    empty.textContent = q
      ? 'Среди установленных ничего не найдено по «' + state.filterQuery + '»'
      : 'Пока пусто — поставь что-нибудь из каталога или найди через поиск.';
    els.listInstalled.appendChild(empty);
  }
  stagger(els.listInstalled);
}

function renderResults(hits) {
  state.lastHits = hits;
  els.listResults.replaceChildren();
  if (!hits.length) {
    const empty = document.createElement('div');
    empty.className = 'mods-empty';
    empty.textContent = 'Ничего не нашлось.';
    els.listResults.appendChild(empty);
    return;
  }
  for (const h of hits) {
    const row = document.createElement('div');
    row.className = 'mod-row';
    row.appendChild(modIcon(h.iconUrl, h.title));

    const meta = document.createElement('div');
    meta.className = 'mod-meta';
    const t = document.createElement('div');
    t.className = 'mod-title';
    t.textContent = h.title;
    const dl = document.createElement('span');
    dl.className = 'mod-dl';
    dl.textContent = h.rating
      ? '👍 ' + h.rating.likes + (h.rating.dislikes ? ' · 👎 ' + h.rating.dislikes : '')
      : '⬇ ' + fmtDownloads(h.downloads);
    t.appendChild(dl);
    // счётчик оценок появится, когда ответит сайт (в топе он уже в строке)
    if (!h.rating) {
      const vote = document.createElement('span');
      vote.className = 'mod-dl mod-votes';
      vote.dataset.ratingFor = h.projectId;
      vote.hidden = true;
      t.appendChild(vote);
    }
    const s = document.createElement('div');
    s.className = 'mod-sub';
    s.textContent = h.description;
    meta.append(t, s);
    row.appendChild(meta);

    row.classList.add('clickable');
    row.addEventListener('click', (e) => {
      if (e.target.closest('.mod-controls')) return;
      openModModal(h);
    });

    const controls = document.createElement('div');
    controls.className = 'mod-controls';
    const btn = document.createElement('button');
    btn.className = 'btn-accent btn-install';
    if (state.installedIds.has(h.projectId)) {
      btn.textContent = '✓ Установлен';
      btn.disabled = true;
    } else {
      btn.textContent = 'Установить';
      btn.addEventListener('click', async () => {
        const ctype = state.contentType;
        btn.disabled = true;
        btn.textContent = 'Скачиваю…';
        const res = await window.api.modInstall(h, ctype, state.loader);
        if (res && res.ok) {
          btn.textContent = '✓ Установлен';
          state.installedIds.add(h.projectId);
          refreshModsView();
          // разруливатель зависимостей менял версии/выключал моды — расскажем
          if (res.notes && res.notes.length) els.modsLoaderHint.textContent = res.notes.join(' · ');
        } else {
          btn.textContent = 'Установить';
          btn.disabled = false;
          els.modsLoaderHint.textContent = 'Ошибка: ' + ((res && res.error) || 'не удалось установить');
        }
      });
    }
    controls.appendChild(btn);
    row.appendChild(controls);
    els.listResults.appendChild(row);
  }
  stagger(els.listResults);
  loadRatings(hits.map((h) => h.projectId));
}

const CTYPE_POPULAR_TITLES = {
  mod: 'Популярные моды',
  resourcepack: 'Популярные ресурспаки',
  shader: 'Популярные шейдеры',
};

const CTYPE_TOP_TITLES = {
  mod: 'Топ модов по оценкам игроков',
  resourcepack: 'Топ ресурспаков по оценкам игроков',
  shader: 'Топ шейдеров по оценкам игроков',
};

/** Записи топа приводим к виду карточек поиска (готовые оценки уже внутри). */
function topToHits(top) {
  return (top || []).map((e) => ({
    projectId: e.projectId,
    slug: e.slug || e.projectId,
    title: e.title || e.slug || e.projectId,
    description: 'Оценка игроков Mist MC: ' + (e.score > 0 ? '+' : '') + e.score,
    iconUrl: e.iconUrl || '',
    downloads: 0,
    rating: { likes: e.likes, dislikes: e.dislikes, mine: state.ratings.get(e.projectId)?.mine || 0 },
  }));
}

let searching = false;
async function doSearch() {
  if (searching || (state.contentType === 'mod' && state.loader === 'vanilla')) return;
  searching = true;
  const q = els.modQuery.value.trim();
  const topMode = state.resultsMode === 'top' && !q;
  els.resultsTitle.textContent = q
    ? 'Результаты: «' + q + '»'
    : topMode ? CTYPE_TOP_TITLES[state.contentType] : CTYPE_POPULAR_TITLES[state.contentType];
  els.secResults.hidden = false;
  // топ и поиск поднимаем над «Установленными» — иначе за ними приходилось скроллить
  els.secResults.classList.toggle('first', topMode || !!q);
  els.modsBody.scrollTop = 0;
  els.listResults.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'mods-empty';
  loading.textContent = q ? 'Ищу на Modrinth…' : topMode ? 'Считаю оценки игроков…' : 'Загружаю подборку…';
  els.listResults.appendChild(loading);
  // пустой запрос = кураторская подборка (или топ игроков, если выбран режим)
  let res;
  if (q) {
    res = await window.api.modsSearch(q, state.contentType, state.loader);
  } else if (topMode) {
    const t = await window.api.communityTop(state.contentType);
    res = t && t.ok
      ? { ok: true, hits: topToHits(t.top) }
      : { ok: false, error: 'Топ недоступен: ' + ((t && t.error) || 'сайт не отвечает') };
  } else {
    res = await window.api.modsPopular(state.contentType, state.loader);
  }
  searching = false;
  if (res && res.ok && topMode && !res.hits.length) {
    els.listResults.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'mods-empty';
    empty.textContent = 'Пока никто не голосовал. Открой мод и поставь 👍 — попадёт в топ.';
    els.listResults.appendChild(empty);
    state.lastHits = [];
    return;
  }
  if (res && res.ok) {
    renderResults(res.hits);
  } else {
    els.listResults.replaceChildren();
    const err = document.createElement('div');
    err.className = 'mods-empty';
    err.textContent = (res && res.error) || 'Modrinth недоступен';
    els.listResults.appendChild(err);
  }
}

// ── мини-рендер Markdown (описания Modrinth) ───────────────────────────
// Безопасен для XSS: DOM строится только через textContent/атрибуты, сырой
// HTML из описания в разметку не попадает (картинки конвертируем, теги режем).
function mdDecodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ({
    amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
  }[e]));
}

const HTTPS_RE = /^https:\/\//i;

function mdLink(url, child) {
  const a = document.createElement('a');
  a.href = '#';
  a.appendChild(child);
  a.addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(url); });
  return a;
}

function mdImage(url, alt, cls) {
  const img = document.createElement('img');
  img.className = cls;
  img.alt = alt || '';
  img.src = url;
  img.addEventListener('error', () => img.remove()); // битую картинку не показываем
  return img;
}

function mdInline(el, text) {
  // Токены. ПЕРВЫМ идёт бейдж [![alt](картинка)](ссылка) — им начинается почти
  // каждое описание на Modrinth; без отдельной ветки внешние скобки съедала
  // ветка ссылки, и на экран лезли куски разметки вида «![Environment]()».
  const re = new RegExp([
    /\[!\[([^\]]*)\]\(([^)\s]*)\)\]\(([^)\s]*)\)/,   // 1 alt, 2 картинка, 3 ссылка
    /!\[([^\]]*)\]\(([^)\s]*)\)/,                    // 4 alt, 5 картинка
    /\[([^\]]+)\]\(([^)\s]*)\)/,                     // 6 текст, 7 ссылка
    /\*\*([^*]+)\*\*/,                               // 8 жирный
    /`([^`]+)`/,                                     // 9 код
  ].map((r) => r.source).join('|'), 'g');
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[2] !== undefined) {
      // бейдж: маленькая картинка, по клику — ссылка
      if (HTTPS_RE.test(m[2])) {
        const img = mdImage(m[2], m[1], 'md-badge');
        el.appendChild(HTTPS_RE.test(m[3]) ? mdLink(m[3], img) : img);
      } else if (m[1] && HTTPS_RE.test(m[3])) {
        el.appendChild(mdLink(m[3], document.createTextNode(m[1])));
      }
      // иначе бейдж без пригодных ссылок — молча пропускаем, не сорим разметкой
    } else if (m[5] !== undefined) {
      if (HTTPS_RE.test(m[5])) el.appendChild(mdImage(m[5], m[4], 'md-img'));
      else if (m[4]) el.appendChild(document.createTextNode(m[4]));
    } else if (m[6] !== undefined) {
      const txt = document.createTextNode(m[6]);
      el.appendChild(HTTPS_RE.test(m[7]) ? mdLink(m[7], txt) : txt);
    } else if (m[8] !== undefined) {
      const b = document.createElement('b');
      b.textContent = m[8];
      el.appendChild(b);
    } else if (m[9] !== undefined) {
      const c = document.createElement('code');
      c.textContent = m[9];
      el.appendChild(c);
    }
    last = re.lastIndex;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

function renderMarkdown(md) {
  const frag = document.createDocumentFragment();
  if (!md) return frag;
  let s = md.replace(/\r\n/g, '\n');
  // HTML-вставки, которыми любят злоупотреблять описания на Modrinth:
  // <img> превращаем в markdown-картинку, блочные теги — в переводы строк,
  // остальные теги вырезаем (текст внутри остаётся).
  s = s.replace(/<img[^>]*?src=["']([^"']+)["'][^>]*>/gi, (_, u) => (/^https:\/\//i.test(u) ? '\n![](' + u + ')\n' : '\n'));
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(p|div|h[1-6]|details|summary|center|ul|ol|li|blockquote|table|thead|tbody|tr|td|th)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]{1,300}?>/g, '');
  s = mdDecodeEntities(s);

  let para = [];
  let list = null;
  let inCode = false;
  let codeLines = [];
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    mdInline(p, para.join(' '));
    frag.appendChild(p);
    para = [];
  };
  const flushList = () => {
    if (list) { frag.appendChild(list); list = null; }
  };
  for (const raw of s.split('\n')) {
    const t = raw.trim();
    if (/^```/.test(t)) {
      if (inCode) {
        const pre = document.createElement('pre');
        pre.textContent = codeLines.join('\n');
        frag.appendChild(pre);
        codeLines = [];
      } else { flushPara(); flushList(); }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }
    if (!t) { flushPara(); flushList(); continue; }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const el = document.createElement('div');
      el.className = 'md-h md-h' + Math.min(3, h[1].length);
      mdInline(el, h[2]);
      frag.appendChild(el);
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(t)) { flushPara(); flushList(); frag.appendChild(document.createElement('hr')); continue; }
    const li = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      if (!list) list = document.createElement('ul');
      const item = document.createElement('li');
      mdInline(item, li[1]);
      list.appendChild(item);
      continue;
    }
    flushList();
    para.push(t);
  }
  if (inCode && codeLines.length) {
    const pre = document.createElement('pre');
    pre.textContent = codeLines.join('\n');
    frag.appendChild(pre);
  }
  flushPara();
  flushList();
  return frag;
}

// ── модалка мода (карточка как на Modrinth) ────────────────────────────
const modm = { gallery: [], idx: 0, project: null, token: 0, showOriginal: false };

// тело модалки: русский автоперевод по умолчанию, по кнопке — оригинал
function modmRenderBody() {
  const p = modm.project;
  if (!p) return;
  const hasRu = !!(p.bodyRu || p.descriptionRu);
  els.modmLang.hidden = !hasRu;
  els.modmLinkSep.hidden = !hasRu; // разделитель нужен, только если есть вторая ссылка
  els.modmLang.textContent = modm.showOriginal ? 'показать оригинал ⇄ перевод' : 'оригинал (EN)';
  const useRu = hasRu && !modm.showOriginal;
  els.modmBody.replaceChildren();
  const desc = useRu && p.descriptionRu ? p.descriptionRu : p.description;
  if (desc) {
    const lead = document.createElement('p');
    lead.textContent = desc;
    lead.style.color = 'var(--text-dim)';
    els.modmBody.appendChild(lead);
  }
  els.modmBody.appendChild(renderMarkdown(useRu && p.bodyRu ? p.bodyRu : p.body));
  replayAnim(els.modmBody, 'md-fade');
}

function modmShowImage() {
  if (!modm.gallery.length) { els.modmGallery.hidden = true; return; }
  els.modmGallery.hidden = false;
  els.modmGalImg.src = modm.gallery[modm.idx].url;
  els.modmGalImg.alt = modm.gallery[modm.idx].title || '';
  replayAnim(els.modmGalImg, 'gal-fade');
  els.modmGalCount.textContent = (modm.idx + 1) + ' / ' + modm.gallery.length;
  const many = modm.gallery.length > 1;
  els.modmPrev.hidden = !many;
  els.modmNext.hidden = !many;
}

// ── оценки игроков ──────────────────────────────────────────────────────
function applyRating(projectId, r) {
  if (!r) return;
  state.ratings.set(projectId, r);
}

/** Подтянуть оценки для показанных карточек и обновить бейджи в списке. */
async function loadRatings(ids) {
  const need = ids.filter(Boolean);
  if (!need.length) return;
  const res = await window.api.communityRatings(need);
  if (!res || !res.ok) return; // сайт недоступен — просто не показываем оценки
  for (const r of res.ratings || []) applyRating(r.projectId, r);
  // дорисовываем счётчики в уже отрисованных строках
  for (const el of document.querySelectorAll('[data-rating-for]')) {
    const r = state.ratings.get(el.dataset.ratingFor);
    if (r && (r.likes || r.dislikes)) {
      el.textContent = '👍 ' + r.likes + (r.dislikes ? ' · 👎 ' + r.dislikes : '');
      el.hidden = false;
    }
  }
  if (modm.project && state.ratings.has(modm.project.projectId)) modmRenderVote();
}

function modmRenderVote() {
  const p = modm.project;
  if (!p) return;
  const r = state.ratings.get(p.projectId) || { likes: 0, dislikes: 0, mine: 0 };
  els.modmLikes.textContent = r.likes;
  els.modmDislikes.textContent = r.dislikes;
  els.modmLike.classList.toggle('voted', r.mine > 0);
  els.modmDislike.classList.toggle('voted', r.mine < 0);
  const noAcc = !state.account;
  els.modmLike.disabled = noAcc;
  els.modmDislike.disabled = noAcc;
  els.modmLike.title = noAcc ? 'Войдите, чтобы оценивать' : 'Нравится';
  els.modmDislike.title = noAcc ? 'Войдите, чтобы оценивать' : 'Не нравится';
}

async function sendVote(value) {
  const p = modm.project;
  if (!p || !p.projectId) return;
  const cur = state.ratings.get(p.projectId) || { likes: 0, dislikes: 0, mine: 0 };
  // повторный клик по своей оценке снимает её
  const next = cur.mine === value ? 0 : value;
  els.modmLike.disabled = true;
  els.modmDislike.disabled = true;
  const res = await window.api.communityVote({
    projectId: p.projectId, slug: p.slug, title: p.title,
    iconUrl: p.iconUrl || '', type: state.contentType,
  }, next);
  if (res && res.ok && res.rating) {
    applyRating(p.projectId, res.rating);
    els.modmHint.textContent = '';
  } else {
    els.modmHint.textContent = 'Оценка не сохранилась: ' + ((res && res.error) || 'сайт недоступен');
  }
  modmRenderVote();
}

function modmUpdateInstallBtn() {
  const p = modm.project;
  if (!p) return;
  if (state.installedIds.has(p.projectId)) {
    els.modmInstall.textContent = '✓ Установлен';
    els.modmInstall.disabled = true;
  } else {
    els.modmInstall.textContent = '⬇ Скачать';
    els.modmInstall.disabled = false;
  }
}

async function openModModal(hit) {
  const token = ++modm.token;
  modm.project = { ...hit };
  modm.gallery = [];
  modm.idx = 0;
  modm.showOriginal = false;
  els.modmLang.hidden = true;
  els.modmLinkSep.hidden = true;
  // мгновенно показываем то, что уже знаем из строки списка
  els.modmTitle.textContent = hit.title || hit.slug || '';
  els.modmDownloads.textContent = hit.downloads ? '⬇ ' + fmtDownloads(hit.downloads) : '';
  els.modmHint.textContent = '';
  els.modmIcon.replaceChildren(modIcon(hit.iconUrl, hit.title).firstChild || document.createTextNode((hit.title || '?')[0].toUpperCase()));
  els.modmGallery.hidden = true;
  els.modmBody.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'md-loading';
  loading.textContent = 'Загружаю описание с Modrinth…';
  els.modmBody.appendChild(loading);
  modmUpdateInstallBtn();
  modmRenderVote();
  loadRatings([hit.projectId]);
  openOverlay(els.modOverlay);

  const res = await window.api.modDetails(hit.slug || hit.projectId);
  if (token !== modm.token || els.modOverlay.hidden) return; // закрыли/открыли другой
  els.modmBody.replaceChildren();
  if (!res || !res.ok) {
    const err = document.createElement('div');
    err.className = 'md-loading';
    err.textContent = (res && res.error) || 'Modrinth недоступен — попробуй ещё раз.';
    els.modmBody.appendChild(err);
    return;
  }
  const p = res.project;
  modm.project = p;
  els.modmTitle.textContent = p.title;
  els.modmDownloads.textContent = '⬇ ' + fmtDownloads(p.downloads);
  els.modmIcon.replaceChildren(modIcon(p.iconUrl, p.title).firstChild || document.createTextNode((p.title || '?')[0].toUpperCase()));
  modm.gallery = p.gallery || [];
  modm.idx = 0;
  modmShowImage();
  modmRenderBody();
  modmUpdateInstallBtn();
  modmRenderVote();
}

function closeModModal() {
  modm.token++;
  closeOverlay(els.modOverlay);
  // картинку чистим после анимации — иначе кадр закрытия «мигает» пустотой
  setTimeout(() => { if (els.modOverlay.hidden) els.modmGalImg.src = ''; }, CLOSE_MS + 20);
}

els.modmClose.addEventListener('click', closeModModal);
els.modOverlay.addEventListener('click', (e) => { if (e.target === els.modOverlay) closeModModal(); });
// Клавиатура в карточке: Esc закрывает, стрелки листают галерею. Стрелки ловим
// только когда карточка открыта и фокус не в поле ввода.
document.addEventListener('keydown', (e) => {
  if (els.modOverlay.hidden) return;
  if (e.key === 'Escape') { closeModModal(); return; }
  if (modm.gallery.length < 2) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    modm.idx = (modm.idx + step + modm.gallery.length) % modm.gallery.length;
    modmShowImage();
  }
});
els.modmPrev.addEventListener('click', () => {
  modm.idx = (modm.idx - 1 + modm.gallery.length) % modm.gallery.length;
  modmShowImage();
});
els.modmNext.addEventListener('click', () => {
  modm.idx = (modm.idx + 1) % modm.gallery.length;
  modmShowImage();
});
els.modmLike.addEventListener('click', () => sendVote(1));
els.modmDislike.addEventListener('click', () => sendVote(-1));
els.modmLang.addEventListener('click', () => {
  modm.showOriginal = !modm.showOriginal;
  modmRenderBody();
});
els.modmLink.addEventListener('click', () => {
  const p = modm.project;
  if (p && p.slug) window.api.openExternal('https://modrinth.com/' + (state.contentType === 'mod' ? 'mod' : state.contentType) + '/' + p.slug);
});
els.modmInstall.addEventListener('click', async () => {
  const p = modm.project;
  if (!p || !p.projectId) return;
  els.modmInstall.disabled = true;
  els.modmInstall.textContent = 'Скачиваю…';
  els.modmHint.textContent = '';
  const res = await window.api.modInstall({
    projectId: p.projectId, slug: p.slug, title: p.title,
    iconUrl: p.iconUrl || '', description: p.description || '',
  }, state.contentType, state.loader);
  if (res && res.ok) {
    state.installedIds.add(p.projectId);
    els.modmInstall.textContent = '✓ Установлен';
    refreshModsView();
    renderResults(state.lastHits);
    // что сделал разруливатель зависимостей (замены версий, выключения)
    if (res.notes && res.notes.length) els.modmHint.textContent = res.notes.join(' · ');
  } else {
    els.modmInstall.disabled = false;
    els.modmInstall.textContent = '⬇ Скачать';
    els.modmHint.textContent = 'Ошибка: ' + ((res && res.error) || 'не удалось установить');
  }
});

// ── Косметика и искры ───────────────────────────────────────────────────
const cosm = {
  catalog: [], owned: new Set(), equipped: {}, balance: 0, slotTitles: {},
  drawings: {}, loaded: false,
  models: {},      // id → модель из пака (коробки + текстуры)
  thumbs: {},      // id → снимок вещи для карточки
  selected: null,  // что показываем в примерочной
  viewer: null,
  filter: '',      // раздел витрины: пусто = всё
  cards: new Map(),// id → карточка в списке, чтобы точечно обновлять
};

/** Скин игрока для примерочной: поставленный в лаунчере (с сайта), иначе
 *  скин аккаунта, иначе стандартный. */
function skinUrl() {
  if (skinState.mistUrl) return skinState.mistUrl;
  const nick = state.account && state.account.name;
  return 'https://mc-heads.net/skin/' + encodeURIComponent(nick || 'MHF_Steve');
}

/** Обновить знание «какой скин стоит на сайте» и перерисовать манекен. */
async function refreshMistSkin() {
  const res = await window.api.skinState().catch(() => null);
  const url = (res && res.ok && res.url) || null;
  if (url === skinState.mistUrl) return;
  skinState.mistUrl = url;
  if (cosm.viewer) {
    const item = cosm.selected ? cosm.models[cosm.selected] : null;
    const sel = cosm.selected ? cosm.catalog.find((c) => c.id === cosm.selected) : null;
    cosm.viewer.setParts(window.Model3D.buildScene(item || null, sel && sel.hmcSlot, skinUrl(), sel && sel.id));
  }
}

/** В разделе «Скин» показываем выбранный файл сразу, до отправки. */
function skinPreviewUrl() {
  return skinState.picked || skinUrl();
}

const skinState = { picked: null, slim: false, mistUrl: null };

/** Скопировать в буфер и мигнуть подтверждением на самом элементе. */
function copyText(text, el) {
  const done = () => {
    if (!el) return;
    const was = el.textContent;
    el.textContent = 'скопировано';
    el.classList.add('is-copied');
    setTimeout(() => { el.textContent = was; el.classList.remove('is-copied'); }, 900);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
    return;
  }
  // запасной путь: скрытое поле и старая команда копирования
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* не вышло — молча */ }
  ta.remove();
  done();
}

/** Показать вещь на персонаже. Список при этом НЕ пересобираем — только
 *  подсветку карточки: пересборка на каждый чих и давала мельтешение. */
function pickCosmetic(item) {
  cosm.selected = item ? item.id : null;
  els.cosmViewName.textContent = item ? item.name : 'Выбери вещь';
  els.cosmViewName.classList.toggle('cosm-copy', !!item);
  els.cosmViewName.onclick = item ? () => copyText(item.name + ' (' + item.id + ')', els.cosmViewName) : null;
  els.cosmViewName.title = item ? 'Нажми, чтобы скопировать название' : '';
  els.cosmViewHint.textContent = item
    ? (cosm.models[item.id] ? 'Крути мышью' : 'Модель ещё не подъехала')
    : 'Крути мышью';
  for (const [id, card] of cosm.cards) card.classList.toggle('is-picked', id === cosm.selected);
  if (!cosm.viewer) return;
  const model = item ? cosm.models[item.id] : null;
  cosm.viewer.setParts(window.Model3D.buildScene(model, item && item.hmcSlot, skinUrl(), item && item.id));
  if (item) cosm.viewer.lookAtSlot(item.hmcSlot);
}

/** Подставить снимок в уже нарисованную карточку. */
function setCardThumb(id, url) {
  const card = cosm.cards.get(id);
  if (!card) return;
  const preview = card.querySelector('.cosm-preview');
  if (!preview) return;
  const img = document.createElement('img');
  img.className = 'cosm-thumb';
  img.src = url;
  preview.replaceChildren(img);
}

/** Модели из пака + снимки для карточек. */
async function loadCosmeticModels() {
  if (!window.Model3D) return;
  const res = await window.api.cosmeticAssets();
  if (!res || !res.ok) {
    els.cosmViewHint.textContent = 'Модели недоступны: ' + ((res && res.error) || '?');
    return;
  }
  cosm.models = res.models || {};
  if (!cosm.selected) {
    const first = cosm.catalog.find((c) => cosm.models[c.id]);
    if (first) pickCosmetic(first);
  } else {
    pickCosmetic(cosm.catalog.find((c) => c.id === cosm.selected));
  }
  // снимки делаем по очереди: у страницы один общий контекст на все карточки
  const skin = skinUrl();
  for (const item of cosm.catalog) {
    const model = cosm.models[item.id];
    if (!model || cosm.thumbs[item.id]) continue;
    // на карточке показываем ТОЛЬКО вещь: игрок в таком размере лишний
    // eslint-disable-next-line no-await-in-loop
    const url = await new Promise((resolve) =>
      window.Model3D.thumbnail(window.Model3D.itemScene(model), 128, resolve));
    if (!url) continue;
    cosm.thumbs[item.id] = url;
    setCardThumb(item.id, url); // точечно, без пересборки всего списка
  }
}

function cosmCard(item) {
  const card = document.createElement('div');
  card.className = 'cosm-card';
  if (cosm.selected === item.id) card.classList.add('is-picked');
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // клик по кнопке — не выбор вещи
    pickCosmetic(item);
  });

  // на карточке — сама вещь, снятая с той же модели, что и в игре
  const preview = document.createElement('div');
  preview.className = 'cosm-preview';
  const thumb = cosm.thumbs[item.id];
  if (thumb) {
    const img = document.createElement('img');
    img.className = 'cosm-thumb';
    img.src = thumb;
    img.alt = item.name;
    preview.appendChild(img);
  } else {
    const dot = document.createElement('span');
    dot.className = 'cosm-dot';
    dot.style.setProperty('--dot', item.color);
    preview.appendChild(dot);
  }
  card.appendChild(preview);

  const name = document.createElement('div');
  name.className = 'cosm-name cosm-copy';
  name.textContent = item.name;
  // клик по названию копирует его вместе с техническим именем: так проще
  // сказать, какая именно вещь сидит криво, не выписывая руками
  name.title = 'Нажми, чтобы скопировать название';
  name.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(`${item.name} (${item.id})`, name);
  });
  const desc = document.createElement('div');
  desc.className = 'cosm-desc';
  desc.textContent = item.desc;
  card.append(name, desc);

  const owned = cosm.owned.has(item.id);
  const worn = cosm.equipped[item.slot] === item.id;

  // у рисованных вещей состояние заявки видно сразу на карточке: иначе игрок,
  // закрывший лаунчер после отправки, не поймёт, почему в игре ничего нет
  if (item.drawable && owned) {
    const st = document.createElement('div');
    st.className = 'cosm-state';
    const d = cosm.drawings[item.drawable];
    if (!d) st.textContent = 'Ещё не нарисовано';
    else if (d.status === 'pending') st.textContent = 'На проверке у модератора';
    else if (d.status === 'rejected') st.textContent = 'Отклонено: ' + (d.reason || 'без причины');
    else if (d.liveSha1) st.textContent = 'Одобрено — видят все';
    else st.textContent = 'Ещё не нарисовано';
    st.classList.toggle('is-warn', !!d && d.status === 'rejected');
    card.appendChild(st);
  }

  const foot = document.createElement('div');
  foot.className = 'cosm-foot';

  // рисованные вещи: после покупки открывается редактор, картинка идёт на проверку
  if (owned && item.drawable) {
    const btn = document.createElement('button');
    btn.className = 'btn-secondary cosm-btn';
    btn.textContent = 'Нарисовать';
    btn.addEventListener('click', () => openDrawEditor(item.drawable));
    foot.appendChild(btn);
  }

  if (owned) {
    const btn = document.createElement('button');
    btn.className = worn ? 'btn-accent cosm-btn' : 'btn-secondary cosm-btn';
    btn.textContent = worn ? 'Надето' : 'Надеть';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await window.api.cosmeticsAction('equip', worn ? null : item.id, item.slot);
      if (res && res.ok) { cosm.equipped = res.equipped || {}; renderCosmetics(); }
      else { btn.disabled = false; els.cosmHint.textContent = 'Не вышло: ' + ((res && res.error) || '?'); }
    });
    foot.appendChild(btn);
  } else {
    if (item.priceSparks != null) {
      const btn = document.createElement('button');
      const enough = cosm.balance >= item.priceSparks;
      btn.className = 'btn-accent cosm-btn';
      btn.textContent = item.priceSparks + ' искр';
      btn.disabled = !enough || !state.account;
      btn.title = !state.account ? 'Войдите в аккаунт'
        : enough ? 'Купить за искры' : 'Не хватает искр — играй через лаунчер';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Покупаю…';
        const res = await window.api.cosmeticsAction('buy', item.id);
        if (res && res.ok) {
          cosm.balance = res.balance;
          (res.owned || []).forEach((x) => cosm.owned.add(x));
          els.cosmHint.textContent = 'Куплено! Нажми «Надеть».';
          renderCosmetics();
        } else {
          els.cosmHint.textContent = 'Не вышло: ' + ((res && res.error) || '?');
          renderCosmetics();
        }
      });
      foot.appendChild(btn);
    }
    if (item.priceRub != null) {
      const rub = document.createElement('button');
      rub.className = 'btn-secondary cosm-btn';
      rub.textContent = item.priceRub + ' ₽';
      rub.title = 'Купить за рубли на сайте';
      rub.addEventListener('click', () => window.api.openExternal('https://mistmc.gg/shop'));
      foot.appendChild(rub);
    }
  }
  card.appendChild(foot);
  return card;
}

function renderCosmetics() {
  els.walletBalance.textContent = state.account ? cosm.balance : '—';
  els.cosmGrid.replaceChildren();
  cosm.cards.clear();

  // раздел «Скин» — не вещь из каталога, у него своя панель
  const skinMode = cosm.filter === 'skin';
  els.cosmSkin.hidden = !skinMode;
  els.cosmGrid.hidden = skinMode;
  if (skinMode) {
    if (cosm.viewer) cosm.viewer.setParts(window.Model3D.buildScene(null, null, skinPreviewUrl()));
    els.cosmViewName.textContent = 'Твой скин';
    els.cosmViewHint.textContent = 'Крути мышью';
    return;
  }

  if (!cosm.catalog.length) {
    const empty = document.createElement('div');
    empty.className = 'mods-empty';
    empty.textContent = 'Каталог недоступен — сайт не отвечает.';
    els.cosmGrid.appendChild(empty);
    return;
  }
  // группируем по слотам: в каждом надета одна вещь, и так это понятнее
  const bySlot = new Map();
  for (const item of cosm.catalog) {
    if (cosm.filter && item.slot !== cosm.filter) continue;
    if (!bySlot.has(item.slot)) bySlot.set(item.slot, []);
    bySlot.get(item.slot).push(item);
  }
  for (const [slot, items] of bySlot) {
    const title = document.createElement('div');
    title.className = 'cosm-slot-title';
    const worn = items.find((i) => cosm.equipped[slot] === i.id);
    title.textContent = (cosm.slotTitles[slot] || slot) + (worn ? ' · надето: ' + worn.name : '');
    els.cosmGrid.appendChild(title);
    const row = document.createElement('div');
    row.className = 'cosm-row';
    for (const item of items) {
      const card = cosmCard(item);
      cosm.cards.set(item.id, card);
      row.appendChild(card);
    }
    els.cosmGrid.appendChild(row);
  }
}

async function loadCosmetics() {
  const res = await window.api.cosmeticsList();
  if (!res || !res.ok) {
    cosm.catalog = [];
    renderCosmetics();
    els.cosmHint.textContent = 'Сайт недоступен: ' + ((res && res.error) || '?');
    return;
  }
  cosm.catalog = res.catalog || [];
  cosm.owned = new Set(res.owned || []);
  cosm.equipped = res.equipped || {};
  cosm.balance = res.balance || 0;
  cosm.slotTitles = res.slotTitles || {};
  cosm.loaded = true;
  renderCosmetics();

  // примерочную поднимаем один раз, при первом заходе на вкладку
  if (!cosm.viewer && window.Model3D && els.cosmView) {
    const v = new window.Model3D.Viewer(els.cosmView);
    if (v.ok) {
      cosm.viewer = v;
      v.setParts(window.Model3D.buildScene(null, null, skinUrl()));
    } else {
      els.cosmViewHint.textContent = 'Трёхмерный просмотр недоступен на этой машине';
    }
  }
  if (cosm.viewer && !Object.keys(cosm.models).length) loadCosmeticModels();
  refreshMistSkin(); // свой скин с сайта — подтягиваем в фоне, манекен обновится сам

  // состояние заявок тянем отдельно: каталог нужен сразу, а статус может и подождать
  if (cosm.catalog.some((c) => c.drawable)) {
    const drawn = await window.api.drawingsList();
    if (drawn && drawn.ok) {
      cosm.drawings = drawn.drawings || {};
      draw.drawings = cosm.drawings;
      renderCosmetics();
    }
  }
}

// ── Разделы витрины и свой скин ─────────────────────────────────────────
function bindCosmeticsTabs() {
  els.cosmTypes.querySelectorAll('.ctype').forEach((btn) => {
    btn.addEventListener('click', () => {
      cosm.filter = btn.dataset.slot || '';
      els.cosmTypes.querySelectorAll('.ctype').forEach((b) => b.classList.toggle('active', b === btn));
      els.cosmScroll.scrollTop = 0;
      renderCosmetics();
      // вернулись из раздела скина — показываем выбранную вещь снова
      if (cosm.filter !== 'skin' && cosm.selected) {
        pickCosmetic(cosm.catalog.find((c) => c.id === cosm.selected));
      }
    });
  });

  els.skinPick.addEventListener('click', () => els.skinFile.click());
  els.skinFile.addEventListener('change', () => {
    const file = els.skinFile.files && els.skinFile.files[0];
    els.skinFile.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        // ванильный скин — 64×64; старые 64×32 сервер не примет
        if (image.width !== 64 || image.height !== 64) {
          els.skinHint.textContent = `Нужен скин 64×64, а этот ${image.width}×${image.height}.`;
          return;
        }
        skinState.picked = reader.result;
        els.skinHint.textContent = 'Видно в примерочной. Жми «Применить», чтобы поставить на сервере.';
        if (cosm.viewer) cosm.viewer.setParts(window.Model3D.buildScene(null, null, skinState.picked));
      };
      image.onerror = () => { els.skinHint.textContent = 'Не удалось прочитать PNG.'; };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  els.skinSlim.addEventListener('change', () => { skinState.slim = els.skinSlim.checked; });

  els.skinApply.addEventListener('click', async () => {
    if (!skinState.picked) { els.skinHint.textContent = 'Сначала выбери файл.'; return; }
    els.skinApply.disabled = true;
    els.skinHint.textContent = 'Ставлю…';
    const png = skinState.picked.split(',')[1];
    const res = await window.api.skinApply(png, skinState.slim);
    els.skinApply.disabled = false;
    els.skinHint.textContent = res && res.ok
      ? 'Готово. На сервере обновится в течение минуты — перезаходить не надо.'
      : 'Не вышло: ' + ((res && res.error) || '?');
    if (res && res.ok) refreshMistSkin(); // манекен примерочной — в новый скин
  });

  els.skinReset.addEventListener('click', async () => {
    els.skinHint.textContent = 'Возвращаю…';
    const res = await window.api.skinReset();
    if (res && res.ok) {
      skinState.picked = null;
      skinState.mistUrl = null;
      els.skinHint.textContent = 'Вернул твой обычный скин.';
      if (cosm.viewer) cosm.viewer.setParts(window.Model3D.buildScene(null, null, skinUrl()));
    } else {
      els.skinHint.textContent = 'Не вышло: ' + ((res && res.error) || '?');
    }
  });
}

// ── Редактор плаща и флага ──────────────────────────────────────────────
// Игрок рисует ЛИЦЕВУЮ сторону вещи, остальное текстуры (изнанку плаща, его
// торцы, древко флага) достраиваем сами — иначе пришлось бы объяснять
// развёртку, а получили бы прозрачные рёбра и «плащ наизнанку».
// Готовая картинка уходит на модерацию: до одобрения её видит только автор.

const PALETTE = [
  '#000000', '#3f3f46', '#71717a', '#a1a1aa', '#e4e4e7', '#ffffff',
  '#7f1d1d', '#ef4444', '#f97316', '#f59e0b', '#fde047', '#84cc16',
  '#15803d', '#22c55e', '#14b8a6', '#0ea5e9', '#1d4ed8', '#4f46e5',
  '#7c3aed', '#a855f7', '#d946ef', '#ec4899', '#7c2d12', '#c2a878',
];

const draw = {
  kind: 'cape',
  canvas: null,     // { w, h, draw: { x, y, w, h }, elytra?: {...} } — приходит с сайта
  img: null,        // ImageData ТЕКУЩЕЙ зоны рисования (ссылка на zones[zone])
  zone: 'face',     // face = лицо вещи; elytra = крылья (только у плаща)
  zones: {},        // ImageData по зонам
  scale: 10,
  tool: 'pen',
  color: '#a855f7',
  history: [],
  painting: false,
  drawings: {},     // состояние заявок с сайта
};

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function pxIndex(x, y) { return (y * draw.img.width + x) * 4; }

function setPx(x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= draw.img.width || y >= draw.img.height) return;
  const i = pxIndex(x, y);
  draw.img.data[i] = rgb[0];
  draw.img.data[i + 1] = rgb[1];
  draw.img.data[i + 2] = rgb[2];
  draw.img.data[i + 3] = alpha;
}

function getPx(x, y) {
  const i = pxIndex(x, y);
  const d = draw.img.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

function pushHistory() {
  draw.history.push(new Uint8ClampedArray(draw.img.data));
  if (draw.history.length > 30) draw.history.shift();
}

/** Заливка области одного цвета (4-связная, без рекурсии — стек). */
function floodFill(sx, sy, rgb) {
  const target = getPx(sx, sy);
  const same = (p) => p[0] === target[0] && p[1] === target[1] && p[2] === target[2] && p[3] === target[3];
  if (same([rgb[0], rgb[1], rgb[2], 255])) return;
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= draw.img.width || y >= draw.img.height) continue;
    if (!same(getPx(x, y))) continue;
    setPx(x, y, rgb, 255);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

function renderDrawCanvas() {
  const cv = els.drawCanvas;
  const s = draw.scale;
  cv.width = draw.img.width * s;
  cv.height = draw.img.height * s;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // шахматка под прозрачностью — иначе не видно, где дырки
  for (let y = 0; y < draw.img.height; y++) {
    for (let x = 0; x < draw.img.width; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#241640' : '#1c1030';
      ctx.fillRect(x * s, y * s, s, s);
      const p = getPx(x, y);
      if (p[3]) {
        ctx.fillStyle = `rgba(${p[0]},${p[1]},${p[2]},${p[3] / 255})`;
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  }
  renderDrawPreview();
}

// Силуэт крыла ванильных элитр (зона 22..46×0..22 в единицах 64×32): бит x —
// колонка u=22+x. Лицевая грань у ванили прозрачная, крыло сужается к низу.
// Тот же список живёт на сайте (lib/crm/capeElytra.ts) — там им режется отдача.
const WING_MASK = [
  261632, 3072, 1044480, 2093056, 4186112, 4186112, 4186112, 8380416,
  8380416, 8380416, 8380416, 16760833, 16760833, 16760833, 16760833,
  16760833, 16744449, 16744449, 16744449, 16711681, 16711681, 16646145,
];

/** Подрезать зону элитр по ванильному силуэту (для предпросмотра — как отдаст сайт). */
function applyWingMask(ctx, s) {
  const img = ctx.getImageData(22 * s, 0, 24 * s, 22 * s);
  for (let y = 0; y < img.height; y++) {
    const bits = WING_MASK[Math.floor(y / s)] || 0;
    for (let x = 0; x < img.width; x++) {
      if (!((bits >> Math.floor(x / s)) & 1)) img.data[(y * img.width + x) * 4 + 3] = 0;
    }
  }
  ctx.putImageData(img, 22 * s, 0);
}

/** Полная текстура: лицо от игрока + достроенное нами.
 *  previewElytra — режим примерочной: пустые элитры достраиваем из плаща и
 *  режем по ванильному силуэту (ровно как сделает сайт при отдаче). На
 *  отправку модератору идёт ЧИСТАЯ версия без этих украшательств. */
function composeTexture(previewElytra) {
  const { w, h, draw: rect } = draw.canvas;
  draw.zones[draw.zone] = draw.img; // текущая зона могла быть только в draw.img
  const face = draw.zones.face || draw.img;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.putImageData(face, rect.x, rect.y);

  if (draw.kind === 'cape') {
    // изнанка: зеркальная копия потемнее — со спины плащ так и выглядит
    const tmp = document.createElement('canvas');
    tmp.width = rect.w;
    tmp.height = rect.h;
    const tctx = tmp.getContext('2d');
    tctx.putImageData(face, 0, 0);
    // Раскладка ванильного плаща: лицо, торец шириной rect.x, потом изнанка.
    // Считать её как rect.x + rect.w * 2 нельзя — изнанка уезжает мимо развёртки
    // и внутренняя сторона плаща получается прозрачной.
    const innerX = rect.x + rect.w + rect.x;
    ctx.save();
    ctx.translate(innerX + rect.w, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.fillRect(innerX, rect.y, rect.w, rect.h);
    ctx.restore();

    // торцы: растягиваем крайние ряды и столбцы, чтобы рёбра не просвечивали
    ctx.drawImage(tmp, 0, 0, rect.w, 1, rect.x, 0, rect.w, rect.y);                  // верх
    ctx.drawImage(tmp, 0, rect.h - 1, rect.w, 1, rect.x + rect.w, 0, rect.w, rect.y); // низ
    ctx.drawImage(tmp, 0, 0, 1, rect.h, 0, rect.y, rect.x, rect.h);                  // левый
    ctx.drawImage(tmp, rect.w - 1, 0, 1, rect.h, rect.x + rect.w, rect.y, rect.x, rect.h); // правый

    // зона элитр: рисунок игрока, если он есть; пустую зону НЕ трогаем —
    // тогда сайт при отдаче моду сам построит крылья из плаща
    let wings = draw.zones.elytra;
    if (previewElytra && !hasInk(wings)) {
      // примерочная: показываем, что построит сайт — лицо плаща, растянутое 32→40
      const er0 = elytraRect();
      const fc = document.createElement('canvas');
      fc.width = rect.w;
      fc.height = rect.h;
      fc.getContext('2d').putImageData(face, 0, 0);
      const sc = document.createElement('canvas');
      sc.width = er0.w;
      sc.height = er0.h;
      const sctx = sc.getContext('2d');
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(fc, 0, 0, rect.w, rect.h, 0, 0, er0.w, er0.h);
      wings = sctx.getImageData(0, 0, er0.w, er0.h);
    }
    if (hasInk(wings)) {
      const er = elytraRect();               // лицевая грань крыла (uv 24,2)
      const s = draw.canvas.w / 64;
      const ew = document.createElement('canvas');
      ew.width = er.w;
      ew.height = er.h;
      ew.getContext('2d').putImageData(wings, 0, 0);
      ctx.putImageData(wings, er.x, er.y);
      // задняя грань (uv 36,2) — ПРЯМАЯ копия: именно её игра показывает
      // (лицевую ваниль держит прозрачной), зеркало читалось отражённым
      ctx.putImageData(wings, 36 * s, er.y);
      // кромки крыла: бока (uv 22 и 34, ширина 2) и верх/низ (y 0..2)
      ctx.drawImage(ew, 0, 0, 1, er.h, 22 * s, er.y, 2 * s, er.h);
      ctx.drawImage(ew, er.w - 1, 0, 1, er.h, 34 * s, er.y, 2 * s, er.h);
      ctx.drawImage(ew, 0, 0, er.w, 1, 24 * s, 0, er.w, 2 * s);
      ctx.drawImage(ew, 0, er.h - 1, er.w, 1, 34 * s, 0, er.w, 2 * s);
    }
    if (previewElytra) applyWingMask(ctx, draw.canvas.w / 64);
  } else {
    ctx.fillStyle = '#7a542d'; // патч древка — модель берёт цвет отсюда
    ctx.fillRect(56, 56, 4, 4);
  }
  return cv;
}

/**
 * Предпросмотр в редакторе — та же примерочная, что на витрине: рисуешь и
 * сразу видишь вещь на своём персонаже, а не догадываешься по развёртке.
 * Перерисовку придерживаем: собирать текстуру на каждый пиксель мазка накладно.
 */
let drawPreviewTimer = null;
function renderDrawPreview() {
  if (!draw.previewViewer) return;
  clearTimeout(drawPreviewTimer);
  drawPreviewTimer = setTimeout(async () => {
    // во вкладке «Элитры» примеряем крылья, в остальных — саму вещь
    const previewKind = draw.kind === 'cape' && draw.zone === 'elytra' ? 'elytra' : draw.kind;
    const png = composeTexture(draw.kind === 'cape').toDataURL('image/png');
    const res = await window.api.cosmeticDrawnModel(previewKind, png);
    if (!res || !res.ok || !draw.previewViewer) return;
    draw.previewViewer.setParts(window.Model3D.buildScene(
      res.model, draw.kind === 'flag' ? 'OFFHAND' : 'BACKPACK', skinUrl(),
    ));
  }, 220);
}

/** Прямоугольник зоны элитр на холсте плаща: лицевая грань крыла uv(24,2) 10×20.
 *  Сайт присылает его в canvas.elytra; на случай старого сайта считаем сами. */
function elytraRect() {
  if (draw.canvas.elytra) return draw.canvas.elytra;
  const s = draw.canvas.w / 64;
  return { x: 24 * s, y: 2 * s, w: 10 * s, h: 20 * s };
}

function zoneRect(zone) {
  return (zone || draw.zone) === 'elytra' ? elytraRect() : draw.canvas.draw;
}

function drawTemplate(zone) {
  const { w: dw, h: dh } = zoneRect(zone);
  const img = new ImageData(dw, dh);
  // элитры по умолчанию ПУСТЫЕ: пустая зона = «крылья соберём из плаща сами»
  if ((zone || draw.zone) === 'elytra') return img;
  const base = draw.kind === 'cape' ? [124, 58, 237] : [245, 158, 11];
  const edge = draw.kind === 'cape' ? [232, 226, 245] : [253, 230, 138];
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = (y * dw + x) * 4;
      const isEdge = x === 0 || y === 0 || x === dw - 1 || y === dh - 1;
      const c = isEdge ? edge : base;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }
  return img;
}

function hasInk(img) {
  if (!img) return false;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) return true;
  return false;
}

/** Панель «Плащ/Элитры»: из разметки, а если её там нет — собираем из кода.
 *  Клики вешаем ровно один раз (метка wired). */
function ensureZoneBar() {
  if (!els.drawZones) {
    const bar = document.createElement('div');
    bar.id = 'draw-zones';
    bar.className = 'content-types';
    for (const [zone, label] of [['face', 'Плащ'], ['elytra', 'Элитры']]) {
      const b = document.createElement('button');
      b.className = 'ctype' + (zone === 'face' ? ' active' : '');
      b.dataset.zone = zone;
      b.textContent = label;
      bar.appendChild(b);
    }
    els.drawCanvas.parentElement.insertBefore(bar, els.drawCanvas);
    els.drawZones = bar;
  }
  if (!els.drawZones.dataset.wired) {
    els.drawZones.dataset.wired = '1';
    els.drawZones.querySelectorAll('.ctype').forEach((btn) => {
      btn.addEventListener('click', () => setDrawZone(btn.dataset.zone));
    });
  }
}

/** Переключить зону редактора (Плащ ↔ Элитры). */
function setDrawZone(zone) {
  if (draw.zone === zone) return;
  draw.zones[draw.zone] = draw.img;
  draw.zone = zone;
  draw.img = draw.zones[zone] || drawTemplate(zone);
  draw.zones[zone] = draw.img;
  draw.history = []; // отмена не должна тянуть мазки из другой зоны
  fitDrawScale();
  els.drawZones.querySelectorAll('.ctype').forEach((b) => b.classList.toggle('active', b.dataset.zone === zone));
  els.drawHint.textContent = zone === 'elytra'
    ? 'Крылья в полёте. Оставишь пустыми — соберём их из рисунка плаща сами.'
    : '';
  renderDrawCanvas();
}

/** Масштаб клетки по размерам окна — зоны разной высоты, пересчитываем при переключении. */
function fitDrawScale() {
  const rect = zoneRect();
  const maxW = 360;
  // −370: как раньше −330, плюс строка вкладок «Плащ/Элитры» над холстом
  const maxH = Math.max(160, window.innerHeight - 370);
  draw.scale = Math.max(3, Math.min(Math.floor(maxW / rect.w), Math.floor(maxH / rect.h)));
}

/** Забрать зоны рисования из загруженной картинки. Возвращает { face?, elytra? }. */
function imageToZones(image) {
  const { w, h, draw: rect } = draw.canvas;
  const er = draw.kind === 'cape' ? elytraRect() : null;
  const cut = (sx, sy, sw, sh, dw, dh) => {
    const tmp = document.createElement('canvas');
    tmp.width = dw;
    tmp.height = dh;
    const ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
    return ctx.getImageData(0, 0, dw, dh);
  };

  // размер точь-в-точь текущая зона — кладём прямо в неё
  const cur = zoneRect();
  if (image.width === cur.w && image.height === cur.h) {
    const out = {};
    out[draw.zone] = cut(0, 0, cur.w, cur.h, cur.w, cur.h);
    return out;
  }
  // полный холст: разбираем на обе зоны
  if (image.width === w && image.height === h) {
    const out = { face: cut(rect.x, rect.y, rect.w, rect.h, rect.w, rect.h) };
    if (er) {
      const wings = cut(er.x, er.y, er.w, er.h, er.w, er.h);
      if (hasInk(wings)) out.elytra = wings;
    }
    return out;
  }
  // обычный плащ Minecraft 64×32: лицо + зона элитр, растянутые вдвое
  if (draw.kind === 'cape' && image.width === 64 && image.height === 32) {
    const out = { face: cut(1, 1, 10, 16, rect.w, rect.h) };
    if (er) {
      const wings = cut(24, 2, 10, 20, er.w, er.h);
      if (hasInk(wings)) out.elytra = wings;
    }
    return out;
  }
  // любой другой размер (например 32×32) — растягиваем в текущую зону как есть:
  // пиксели пересэмплируются «ближайшим соседом», без мыла. Флаг _scaled
  // вынимает вызывающий — в draw.zones он попасть не должен.
  if (image.width > 0 && image.height > 0 && image.width <= 4096 && image.height <= 4096) {
    const out = { _scaled: true };
    out[draw.zone] = cut(0, 0, image.width, image.height, cur.w, cur.h);
    return out;
  }
  return null;
}

// ── Черновики: рисунок автосохраняется локально и переживает перезапуск ──
function zoneToDataUrl(img) {
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

let draftSaveTimer = null;
function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    if (!draw.canvas || !window.api.draftSave) return;
    draw.zones[draw.zone] = draw.img;
    const zones = {};
    for (const z of ['face', 'elytra']) {
      if (draw.zones[z]) zones[z] = zoneToDataUrl(draw.zones[z]);
    }
    window.api.draftSave(draw.kind, zones).catch(() => {});
  }, 600);
}

function dataUrlToImageData(url, w, h) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadDraft(kind) {
  try {
    if (!window.api.draftLoad) return null;
    const d = await window.api.draftLoad(kind);
    if (!d || !d.zones) return null;
    const out = {};
    for (const z of ['face', 'elytra']) {
      if (!d.zones[z]) continue;
      if (z === 'elytra' && kind !== 'cape') continue;
      const r = zoneRect(z);
      const img = await dataUrlToImageData(d.zones[z], r.w, r.h);
      if (img) out[z] = img;
    }
    return Object.keys(out).length ? out : null;
  } catch (_) {
    return null;
  }
}

function drawStatusText(kind) {
  const d = draw.drawings[kind];
  if (!d) return 'Ещё ничего не отправлял.';
  if (d.status === 'pending') return 'На проверке у модератора. В игре пока видишь только ты.';
  if (d.status === 'rejected') return 'Отклонено: ' + (d.reason || 'без причины') + '. Перерисуй и отправь снова.';
  if (d.liveSha1) return 'Одобрено — вещь видят все на сервере.';
  return 'Ещё ничего не отправлял.';
}

async function openDrawEditor(kind) {
  draw.kind = kind;
  els.drawTitle.textContent = kind === 'cape' ? 'Свой плащ' : 'Свой флаг';
  els.drawSub.textContent = kind === 'cape'
    ? 'Рисуешь лицевую сторону — изнанку и края достроим сами. Вкладка «Элитры» — свой рисунок для крыльев (пустая = соберём из плаща). Готовое уходит модератору.'
    : 'Рисуешь полотнище — древко добавим сами. Готовое уходит модератору.';
  els.drawHint.textContent = '';

  const res = await window.api.drawingsList();
  if (!res || !res.ok) {
    els.drawHint.textContent = 'Сайт недоступен: ' + ((res && res.error) || '?');
    return;
  }
  draw.canvas = res.canvas[kind];
  draw.drawings = res.drawings || {};
  draw.textureUrl = res.textureUrl || '';
  els.drawStatus.textContent = drawStatusText(kind);

  draw.history = [];
  draw.zone = 'face';
  draw.zones = { face: drawTemplate('face') };
  if (kind === 'cape') draw.zones.elytra = drawTemplate('elytra');
  // если что-то уже нарисовано — подставляем это, чтобы правка была правкой
  const mine = draw.drawings[kind];
  const sha = mine && (mine.pendSha1 || mine.liveSha1);
  if (sha) {
    const loaded = await loadTextureBySha(sha);
    if (loaded) {
      delete loaded._scaled;
      Object.assign(draw.zones, loaded);
    }
  }
  // черновик важнее отправленного: игрок возвращается ровно туда, где бросил
  const draft = await loadDraft(kind);
  if (draft) {
    Object.assign(draw.zones, draft);
    els.drawHint.textContent = 'Черновик восстановлен — продолжай с того же места.';
  }
  draw.img = draw.zones.face;
  fitDrawScale();
  // переключатель зон — только у плаща. Страховка: если панели нет в
  // разметке (старый index.html и т.п.) — собираем её из кода прямо здесь.
  ensureZoneBar();
  els.drawZones.style.display = kind === 'cape' ? 'flex' : 'none';
  els.drawZones.querySelectorAll('.ctype').forEach((b) => b.classList.toggle('active', b.dataset.zone === 'face'));
  if (!draw.previewViewer && window.Model3D) {
    const v = new window.Model3D.Viewer(els.drawPreview, { dist: 3.2 });
    if (v.ok) draw.previewViewer = v;
  }
  renderDrawCanvas();
  openOverlay(els.drawOverlay);
}

/** Своя прошлая картинка — сайт отдаёт её по контрольной сумме. */
function loadTextureBySha(sha) {
  if (!draw.textureUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(imageToZones(img));
    img.onerror = () => resolve(null);
    img.src = draw.textureUrl + sha;
  });
}

function bindDrawEditor() {
  const overlay = els.drawOverlay;
  const palette = els.drawPalette;
  for (const hex of PALETTE) {
    const b = document.createElement('button');
    b.className = 'draw-swatch';
    b.style.background = hex;
    b.title = hex;
    b.addEventListener('click', () => {
      draw.color = hex;
      els.drawColor.value = hex;
      markSwatch(hex);
    });
    palette.appendChild(b);
  }
  const markSwatch = (hex) => {
    palette.querySelectorAll('.draw-swatch').forEach((b) => {
      b.classList.toggle('is-on', b.title.toLowerCase() === String(hex).toLowerCase());
    });
  };
  markSwatch(draw.color);
  els.drawColor.addEventListener('input', () => { draw.color = els.drawColor.value; markSwatch(draw.color); });

  overlay.querySelectorAll('.draw-tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draw.tool = btn.dataset.tool;
      overlay.querySelectorAll('.draw-tool[data-tool]').forEach((b) => b.classList.toggle('is-on', b === btn));
    });
  });

  const cellAt = (e) => {
    const r = els.drawCanvas.getBoundingClientRect();
    return [
      Math.floor((e.clientX - r.left) / (r.width / draw.img.width)),
      Math.floor((e.clientY - r.top) / (r.height / draw.img.height)),
    ];
  };
  const paint = (e, first) => {
    if (!draw.img) return;
    const [x, y] = cellAt(e);
    if (x < 0 || y < 0 || x >= draw.img.width || y >= draw.img.height) return;
    if (draw.tool === 'pick') {
      const p = getPx(x, y);
      if (p[3]) {
        const hex = '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        draw.color = hex;
        els.drawColor.value = hex;
        markSwatch(hex);
      }
      return;
    }
    if (first) pushHistory();
    if (draw.tool === 'fill') floodFill(x, y, hexToRgb(draw.color));
    else if (draw.tool === 'erase') setPx(x, y, [0, 0, 0], 0);
    else setPx(x, y, hexToRgb(draw.color), 255);
    renderDrawCanvas();
    scheduleDraftSave();
  };

  els.drawCanvas.addEventListener('pointerdown', (e) => {
    draw.painting = true;
    els.drawCanvas.setPointerCapture(e.pointerId);
    paint(e, true);
  });
  els.drawCanvas.addEventListener('pointermove', (e) => { if (draw.painting) paint(e, false); });
  els.drawCanvas.addEventListener('pointerup', () => { draw.painting = false; });
  els.drawCanvas.addEventListener('pointercancel', () => { draw.painting = false; });

  els.drawUndo.addEventListener('click', () => {
    const prev = draw.history.pop();
    if (!prev) return;
    draw.img.data.set(prev);
    renderDrawCanvas();
    scheduleDraftSave();
  });
  els.drawClear.addEventListener('click', () => {
    pushHistory();
    draw.img = drawTemplate();
    draw.zones[draw.zone] = draw.img;
    renderDrawCanvas();
    scheduleDraftSave();
  });
  document.addEventListener('keydown', (e) => {
    if (overlay.hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      els.drawUndo.click();
    }
  });

  els.drawImport.addEventListener('click', () => els.drawFile.click());
  els.drawFile.addEventListener('change', () => {
    const file = els.drawFile.files && els.drawFile.files[0];
    els.drawFile.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const got = imageToZones(image);
        if (!got) {
          const r = zoneRect();
          const full = draw.canvas;
          els.drawHint.textContent = `Не удалось разобрать картинку: подойдёт ${r.w}×${r.h}, весь холст ${full.w}×${full.h}`
            + (draw.kind === 'cape' ? ', обычный плащ 64×32' : '') + ' или любой PNG до 4096×4096.';
          return;
        }
        const scaled = got._scaled;
        delete got._scaled;
        pushHistory();
        Object.assign(draw.zones, got);
        draw.img = draw.zones[draw.zone] || drawTemplate();
        draw.zones[draw.zone] = draw.img;
        const r = zoneRect();
        els.drawHint.textContent = scaled
          ? `Картинка ${image.width}×${image.height} растянута под зону ${r.w}×${r.h}.`
          : (got.elytra && got.face ? 'Картинка загружена: плащ и элитры.' : 'Картинка загружена.');
        renderDrawCanvas();
        scheduleDraftSave();
      };
      image.onerror = () => { els.drawHint.textContent = 'Не удалось прочитать PNG.'; };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  els.drawSend.addEventListener('click', async () => {
    els.drawSend.disabled = true;
    els.drawHint.textContent = 'Отправляю…';
    try {
      const png = composeTexture().toDataURL('image/png').split(',')[1];
      const res = await window.api.drawingSubmit(draw.kind, png);
      if (res && res.ok) {
        draw.drawings = res.drawings || draw.drawings;
        els.drawStatus.textContent = drawStatusText(draw.kind);
        els.drawHint.textContent = 'Отправлено модератору.';
        // рисунок теперь хранит сайт — локальный черновик своё отработал
        if (window.api.draftClear) window.api.draftClear(draw.kind).catch(() => {});
        loadCosmetics();
      } else {
        els.drawHint.textContent = 'Не вышло: ' + ((res && res.error) || '?');
      }
    } catch (e) {
      els.drawHint.textContent = 'Не вышло: ' + e.message;
    } finally {
      els.drawSend.disabled = false;
    }
  });

  els.drawClose.addEventListener('click', () => closeOverlay(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay); });
}

// ── Внешний вид лаунчера (шестерёнка) ───────────────────────────────────
// Тема живёт в CSS-переменных: акцент задаёт кнопки/вкладки, цвет фона —
// всю подложку, из него же выводим оттенки карточек, чтобы слои не слиплись.
const THEME_DEFAULT = { accent: '#a855f7', bg: '#0f0518', bgOpacity: 45, bgScale: 100, bgX: 50, bgY: 50, blocks: {} };

// ── блоки интерфейса: прозрачность и положение настраивает игрок ─────────
// Ключ стабильный (хранится в теме), селектор — где блок живёт в разметке.
// theme.blocks = { <ключ>: { o: 20..100, x: px, y: px } }; отсутствие записи
// или {o:100,x:0,y:0} = как нарисовано.
const UI_BLOCKS = {
  tabs:       { sel: '#tabs',                        name: 'Вкладки' },
  hero:       { sel: '#view-game .hero',             name: 'Заголовок' },
  play:       { sel: '#view-game .card',             name: 'Панель запуска' },
  log:        { sel: '#logbox',                      name: 'Журнал' },
  mods_head:  { sel: '#view-mods .mods-head',        name: 'Панель поиска' },
  mods_my:    { sel: '#sec-installed',               name: 'Мои моды' },
  mods_find:  { sel: '#sec-results',                 name: 'Результаты поиска' },
  cosm_head:  { sel: '#view-cosmetics .cosm-head',   name: 'Шапка косметики' },
  cosm_types: { sel: '#cosm-types',                  name: 'Разделы косметики' },
  cosm_fit:   { sel: '#view-cosmetics .cosm-fitting', name: 'Примерочная' },
  cosm_list:  { sel: '#cosm-scroll',                 name: 'Витрина' },
  cosm_skin:  { sel: '#cosm-skin',                   name: 'Свой скин' },
};

function blockEl(key) {
  const def = UI_BLOCKS[key];
  return def ? document.querySelector(def.sel) : null;
}

/** Применить сохранённые прозрачность/сдвиг/размер ко всем блокам. */
function applyBlocks(theme) {
  const conf = (theme && theme.blocks) || {};
  for (const key of Object.keys(UI_BLOCKS)) {
    const el = blockEl(key);
    if (!el) continue;
    el.classList.add('ui-block');
    el.dataset.blockName = UI_BLOCKS[key].name;
    const b = conf[key] || {};
    const o = Math.max(20, Math.min(100, b.o ?? 100));
    el.style.opacity = o === 100 ? '' : String(o / 100);
    const x = Math.round(b.x || 0);
    const y = Math.round(b.y || 0);
    el.style.translate = (x || y) ? `${x}px ${y}px` : '';
    const s = Math.max(50, Math.min(150, b.s ?? 100));
    el.style.scale = s === 100 ? '' : String(s / 100);
  }
}
const ACCENT_PRESETS = ['#a855f7', '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#94a3b8'];
const BG_PRESETS = ['#0f0518', '#0b1020', '#0a1410', '#160b0b', '#111111', '#1c1917'];

const hex2rgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb2hex = (r) => '#' + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (rgb, target, k) => rgb.map((v, i) => v + (target[i] - v) * k);

/** Воспринимаемая яркость 0..1 — по ней решаем, светлая тема или тёмная. */
function luminance(rgb) {
  const f = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

function applyTheme(theme) {
  const t = Object.assign({}, THEME_DEFAULT, theme || {});
  const root = document.documentElement.style;
  const acc = hex2rgb(t.accent) || hex2rgb(THEME_DEFAULT.accent);
  const bg = hex2rgb(t.bg) || hex2rgb(THEME_DEFAULT.bg);

  root.setProperty('--accent', rgb2hex(acc));
  root.setProperty('--accent-hover', rgb2hex(mix(acc, [0, 0, 0], 0.18)));  // темнее для нажатого
  root.setProperty('--accent-glow', `rgba(${acc.join(',')},0.35)`);
  root.setProperty('--accent-glow-strong', `rgba(${acc.join(',')},0.7)`);
  root.setProperty('--accent-soft', `rgba(${acc.join(',')},0.18)`);
  root.setProperty('--border', `rgba(${acc.join(',')},0.25)`);
  // текст на самой заливке акцента: на светлом акценте белый не читается
  root.setProperty('--on-accent', luminance(acc) > 0.55 ? '#141018' : '#ffffff');

  // На светлом фоне слои должны ТЕМНЕТЬ, а текст становиться тёмным — иначе
  // получается белым по оранжевому: карточки сливаются, текст не читается.
  // Порог по яркости врал (оранжевый #e08a4a считался «тёмным»), поэтому
  // сравниваем КОНТРАСТ обоих вариантов текста и берём тот, что читается лучше.
  const INK_DARK = [26, 20, 32];
  const INK_LIGHT = [243, 232, 255];
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const lbg = luminance(bg);
  const light = contrast(lbg, luminance(INK_DARK)) > contrast(lbg, luminance(INK_LIGHT));
  const layer = light ? [0, 0, 0] : [255, 255, 255];
  root.setProperty('--navy-deep', rgb2hex(bg));
  root.setProperty('--navy', rgb2hex(mix(bg, layer, 0.05)));
  root.setProperty('--card', rgb2hex(mix(bg, layer, 0.08)));
  root.setProperty('--card-2', rgb2hex(mix(bg, layer, 0.13)));
  root.setProperty('--input-bg', rgb2hex(mix(bg, layer, light ? 0.05 : 0.03)));
  root.setProperty('--deep', rgb2hex(mix(bg, light ? [255, 255, 255] : [0, 0, 0], 0.35)));

  const ink = light ? [26, 20, 32] : [243, 232, 255];
  root.setProperty('--text', rgb2hex(ink));
  root.setProperty('--text-dim', rgb2hex(mix(ink, bg, 0.35)));
  root.setProperty('--hint', rgb2hex(mix(ink, bg, 0.5)));
  root.setProperty('--log-text', rgb2hex(mix(ink, bg, 0.2)));
  root.setProperty('--hover-veil', light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)');
  root.setProperty('--overlay', light
    ? `rgba(${mix(bg, [0, 0, 0], 0.25).map(Math.round).join(',')},0.55)`
    : `rgba(${mix(bg, [0, 0, 0], 0.5).map(Math.round).join(',')},0.72)`);
  document.body.classList.toggle('theme-light', light);
  applyBlocks(t);
}

/**
 * Фон окна: картинка, гифка или видео в общем слое. Масштаб и положение
 * работают одинаково для всех — как в редакторе баннера: object-position
 * выбирает видимую часть, scale приближает. Поверх — вуаль цвета фона,
 * ею регулируется насыщенность (100% = чистая картинка).
 */
/**
 * Раскладка кадра: media заполняет рамку целиком (как «обложка»), zoom
 * дополнительно приближает, а точка фокуса fx/fy (0..1) выбирает, какая часть
 * видна. Смещение считаем в пикселях и зажимаем так, чтобы край картинки
 * никогда не заехал внутрь рамки — щелей по краям не бывает по построению.
 * Возвращает запас хода в пикселях: по нему перетаскивание идёт ровно
 * за курсором, а не «примерно».
 */
function layoutBg(frame, el, zoom, fx, fy) {
  const nw = el.naturalWidth || el.videoWidth || 0;
  const nh = el.naturalHeight || el.videoHeight || 0;
  const fw = frame.clientWidth;
  const fh = frame.clientHeight;
  if (!nw || !nh || !fw || !fh) return { slackX: 0, slackY: 0 };
  const cover = Math.max(fw / nw, fh / nh);
  const s = cover * (zoom || 1);
  const w = nw * s;
  const h = nh * s;
  const slackX = Math.max(0, w - fw);
  const slackY = Math.max(0, h - fh);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = (-slackX * fx) + 'px';
  el.style.top = (-slackY * fy) + 'px';
  return { slackX, slackY };
}

function applyBackground(media, theme) {
  const t = Object.assign({}, THEME_DEFAULT, theme || state.theme);
  const root = document.documentElement.style;
  const box = $('bg-media');
  const img = $('bg-img');
  const vid = $('bg-video');
  if (!box) return;

  if (!media || !media.url) {
    box.hidden = true;
    img.hidden = true; vid.hidden = true;
    img.removeAttribute('src'); vid.removeAttribute('src');
    root.setProperty('--bg-veil', 'transparent');
    return;
  }
  const bg = hex2rgb(t.bg) || [15, 5, 24];
  const pct = Math.max(0, Math.min(100, t.bgOpacity ?? 45));
  root.setProperty('--bg-veil', `rgba(${bg.join(',')},${(1 - pct / 100).toFixed(3)})`);

  box.hidden = false;
  const isVideo = media.kind === 'video';
  vid.hidden = !isVideo;
  img.hidden = isVideo;
  const target = isVideo ? vid : img;
  const other = isVideo ? img : vid;
  other.removeAttribute('src');
  // src меняем только при смене файла: переустановка перезапускала бы видео
  if (target.getAttribute('src') !== media.url) {
    target.src = media.url;
    if (isVideo) vid.play().catch(() => { /* автозапуск без звука разрешён */ });
  }
  const place = () => layoutBg(box, target, (t.bgScale ?? 100) / 100, (t.bgX ?? 50) / 100, (t.bgY ?? 50) / 100);
  place();
  // размеры известны только после загрузки файла — раскладываем ещё раз
  target.onload = place;
  target.onloadedmetadata = place;
}

// окно можно растянуть — кадр обязан пересчитаться под новый размер
window.addEventListener('resize', () => {
  if (state.bgMedia) applyBackground(state.bgMedia, state.theme);
});

(() => {
  const overlay = $('settings-overlay');
  if (!overlay) return;
  const accentHex = $('accent-hex');
  const accentPicker = $('accent-picker');
  const bgHex = $('bg-hex');
  const bgPicker = $('bg-picker');
  const opacityInput = $('bg-opacity');
  const opacityVal = $('bg-opacity-val');
  const adjustBox = $('bg-adjust');
  const scaleInput = $('bg-scale');
  const scaleVal = $('bg-scale-val');
  const preview = $('bg-preview');
  const prevImg = $('bg-preview-img');
  const prevVid = $('bg-preview-video');
  const clearBtn = $('bg-image-clear');
  const imgHint = $('bg-image-hint');

  /** Превью — уменьшенная копия окна: тот же файл, та же раскладка кадра,
   *  поэтому видно ровно то, что окажется на фоне. */
  let prevSlack = { slackX: 0, slackY: 0 };
  function syncPreview() {
    const m = state.bgMedia;
    if (!m || !m.url) { prevImg.hidden = true; prevVid.hidden = true; return; }
    const isVideo = m.kind === 'video';
    prevVid.hidden = !isVideo;
    prevImg.hidden = isVideo;
    const target = isVideo ? prevVid : prevImg;
    if (target.getAttribute('src') !== m.url) {
      target.src = m.url;
      if (isVideo) prevVid.play().catch(() => {});
    }
    const t = Object.assign({}, THEME_DEFAULT, state.theme);
    const place = () => {
      prevSlack = layoutBg(preview, target, (t.bgScale ?? 100) / 100, (t.bgX ?? 50) / 100, (t.bgY ?? 50) / 100);
    };
    place();
    target.onload = place;
    target.onloadedmetadata = place;
  }

  function buildSwatches(host, presets, onPick) {
    host.replaceChildren();
    for (const c of presets) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c;
      b.dataset.color = c;
      b.title = c;
      b.addEventListener('click', () => onPick(c));
      host.appendChild(b);
    }
  }
  function markActive(host, color) {
    for (const b of host.querySelectorAll('.swatch')) {
      b.classList.toggle('active', b.dataset.color.toLowerCase() === String(color).toLowerCase());
    }
  }

  function syncInputs() {
    const t = Object.assign({}, THEME_DEFAULT, state.theme);
    accentHex.value = t.accent;
    accentPicker.value = t.accent;
    bgHex.value = t.bg;
    bgPicker.value = t.bg;
    opacityInput.value = t.bgOpacity ?? 45;
    opacityVal.textContent = opacityInput.value;
    // общий ползунок блоков: если у всех одна прозрачность — показываем её,
    // разнобой (крутили по отдельности) — показываем 100, чтобы не врать
    const bAll = $('blocks-opacity');
    if (bAll) {
      const os = Object.keys(UI_BLOCKS).map((k) => ((t.blocks || {})[k] || {}).o ?? 100);
      const uniform = os.every((v) => v === os[0]);
      bAll.value = uniform ? os[0] : 100;
      $('blocks-opacity-val').textContent = bAll.value;
    }
    markActive($('accent-swatches'), t.accent);
    markActive($('bg-swatches'), t.bg);
    const hasImg = !!state.bgMedia;
    clearBtn.hidden = !hasImg;
    adjustBox.hidden = !hasImg;
    scaleInput.value = t.bgScale ?? 100;
    scaleVal.textContent = scaleInput.value;
    syncPreview();
    imgHint.textContent = hasImg
      ? 'Картинка установлена. Регулируй насыщенность, чтобы текст читался.'
      : 'PNG или JPG. Ляжет под интерфейс.';
  }

  // Перетаскивание палитры сыплет событиями по десятку раз в секунду. Раньше
  // на КАЖДОЕ шли пересчёт темы, перерисовка панели и запись конфига на диск —
  // отсюда лаги. Теперь: перекраска не чаще кадра, сохранение — после паузы,
  // а на время таскания переходы отключаются (иначе все кнопки без конца
  // перезапускают анимацию цвета).
  let rafId = 0;
  let saveTimer = 0;
  let liveTimer = 0;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.api.saveConfig({ theme: state.theme }), 400);
  }
  function markLive() {
    document.body.classList.add('theme-live');
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => document.body.classList.remove('theme-live'), 250);
  }

  /** live=true — идёт перетаскивание: только перекраска, без панели и диска. */
  function setTheme(patch, persist = true, live = false) {
    state.theme = Object.assign({}, THEME_DEFAULT, state.theme, patch);
    if (live) markLive();
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        applyTheme(state.theme);
        applyBackground(state.bgMedia, state.theme);
      });
    }
    if (!live) syncInputs();
    if (persist) scheduleSave();
  }
  window.__setTheme = setTheme; // используется при загрузке конфига

  buildSwatches($('accent-swatches'), ACCENT_PRESETS, (c) => setTheme({ accent: c }));
  buildSwatches($('bg-swatches'), BG_PRESETS, (c) => setTheme({ bg: c }));

  // input — тянут ползунок (живой предпросмотр), change — отпустили (фиксируем)
  accentPicker.addEventListener('input', () => setTheme({ accent: accentPicker.value }, false, true));
  accentPicker.addEventListener('change', () => setTheme({ accent: accentPicker.value }));
  bgPicker.addEventListener('input', () => setTheme({ bg: bgPicker.value }, false, true));
  bgPicker.addEventListener('change', () => setTheme({ bg: bgPicker.value }));
  const hexHandler = (input, key) => () => {
    const v = input.value.trim();
    if (hex2rgb(v)) setTheme({ [key]: v.startsWith('#') ? v : '#' + v });
  };
  accentHex.addEventListener('change', hexHandler(accentHex, 'accent'));
  bgHex.addEventListener('change', hexHandler(bgHex, 'bg'));

  opacityInput.addEventListener('input', () => {
    opacityVal.textContent = opacityInput.value;
    markLive();
    applyBackground(state.bgMedia, { ...state.theme, bgOpacity: parseInt(opacityInput.value, 10) });
  });
  opacityInput.addEventListener('change', () => setTheme({ bgOpacity: parseInt(opacityInput.value, 10) }));

  scaleInput.addEventListener('input', () => {
    scaleVal.textContent = scaleInput.value;
    markLive();
    setTheme({ bgScale: parseInt(scaleInput.value, 10) }, false, true);
  });
  scaleInput.addEventListener('change', () => setTheme({ bgScale: parseInt(scaleInput.value, 10) }));

  // Перетаскивание: сдвиг курсора переводим в долю ЗАПАСА ХОДА кадра, поэтому
  // картинка едет ровно за мышью. Если запаса нет (кадр ровно по рамке) —
  // по этой оси ничего не двигается, и это правильно: двигать нечего.
  let drag = null;
  preview.addEventListener('mousedown', (e) => {
    if (!state.bgMedia) return;
    e.preventDefault();
    const t = Object.assign({}, THEME_DEFAULT, state.theme);
    drag = { x: e.clientX, y: e.clientY, bx: t.bgX ?? 50, by: t.bgY ?? 50 };
    preview.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const dx = prevSlack.slackX ? ((e.clientX - drag.x) / prevSlack.slackX) * 100 : 0;
    const dy = prevSlack.slackY ? ((e.clientY - drag.y) / prevSlack.slackY) * 100 : 0;
    setTheme({ bgX: clamp(drag.bx - dx), bgY: clamp(drag.by - dy) }, false, true);
    syncPreview(); // превью двигается сразу, не дожидаясь кадра отрисовки окна
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    preview.classList.remove('dragging');
    window.api.saveConfig({ theme: state.theme }); // фиксируем выбранный кадр
  });

  $('bg-reset-crop').addEventListener('click', () => {
    setTheme({ bgScale: 100, bgX: 50, bgY: 50 });
  });

  $('bg-image-pick').addEventListener('click', async () => {
    const res = await window.api.pickBgImage();
    if (res && res.canceled) return;
    if (!res || !res.ok) {
      imgHint.textContent = 'Не вышло: ' + ((res && res.error) || 'неизвестная ошибка');
      return;
    }
    state.bgMedia = res.media || null;
    setTheme({ bgImage: res.name, bgScale: 100, bgX: 50, bgY: 50 });
  });
  clearBtn.addEventListener('click', async () => {
    await window.api.clearBgImage();
    state.bgMedia = null;
    setTheme({ bgImage: null });
  });
  $('theme-reset').addEventListener('click', async () => {
    if (state.bgMedia) await window.api.clearBgImage();
    state.bgMedia = null;
    state.theme = Object.assign({}, THEME_DEFAULT, { bgImage: null });
    applyTheme(state.theme);
    applyBackground(null);
    syncInputs();
    window.api.saveConfig({ theme: state.theme });
  });

  // ── настройка блоков: общий ползунок + режим перетаскивания ────────────
  (() => {
    const allInput = $('blocks-opacity');
    const allVal = $('blocks-opacity-val');
    const editBar = $('blocks-edit-bar');
    if (!allInput) return;

    const blocksConf = () => JSON.parse(JSON.stringify(state.theme.blocks || {}));

    allInput.addEventListener('input', () => { allVal.textContent = allInput.value; });
    allInput.addEventListener('change', () => {
      // общий ползунок выставляет ЛИЧНУЮ прозрачность каждому блоку разом;
      // сдвиги не трогаем — «сразу» касается только прозрачности
      const v = parseInt(allInput.value, 10);
      const blocks = blocksConf();
      for (const key of Object.keys(UI_BLOCKS)) blocks[key] = { ...(blocks[key] || {}), o: v };
      setTheme({ blocks });
    });

    $('blocks-reset').addEventListener('click', () => {
      allInput.value = 100;
      allVal.textContent = '100';
      setTheme({ blocks: {} });
    });

    // режим редактирования: настройки закрываются, блоки таскаются мышью
    let editing = false;
    let drag = null; // { key, el, startX, startY, baseX, baseY }
    let saveTimer = 0;

    const scheduleBlocksSave = (blocks) => {
      state.theme.blocks = blocks;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => setTheme({ blocks }), 400);
    };

    function setEditing(on) {
      editing = on;
      document.body.classList.toggle('blocks-edit', on);
      editBar.hidden = !on;
    }

    $('blocks-edit').addEventListener('click', () => {
      closeOverlay(overlay);
      setEditing(true);
    });
    $('blocks-edit-done').addEventListener('click', () => setEditing(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && editing) setEditing(false);
    });

    const keyOf = (target) => {
      const el = target.closest && target.closest('.ui-block');
      if (!el) return null;
      for (const [key, def] of Object.entries(UI_BLOCKS)) {
        if (document.querySelector(def.sel) === el) return { key, el };
      }
      return null;
    };

    // ── физика броска: отпустил на скорости — блок летит и отскакивает ──
    const flings = new Map(); // key → rafId (один полёт на блок)

    function saveBlockPos(key, x, y) {
      const blocks = blocksConf();
      blocks[key] = { ...(blocks[key] || {}), x: Math.round(x), y: Math.round(y) };
      scheduleBlocksSave(blocks);
    }

    /** Диапазон сдвига, при котором блок не вылетает за окно. */
    function slack(el, x, y) {
      const r = el.getBoundingClientRect();
      // rect уже со сдвигом (x,y) — вычитаем его и получаем «родное» место
      const left = r.left - x;
      const top = r.top - y;
      return {
        minX: -left, maxX: window.innerWidth - (left + r.width),
        minY: -top, maxY: window.innerHeight - (top + r.height),
      };
    }

    function fling(key, el, x, y, vx, vy) {
      cancelAnimationFrame(flings.get(key) || 0);
      const lim = slack(el, x, y);
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        x += vx * dt;
        y += vy * dt;
        // отскок от краёв окна с затуханием
        if (x < lim.minX) { x = lim.minX; vx = -vx * 0.55; }
        if (x > lim.maxX) { x = lim.maxX; vx = -vx * 0.55; }
        if (y < lim.minY) { y = lim.minY; vy = -vy * 0.55; }
        if (y > lim.maxY) { y = lim.maxY; vy = -vy * 0.55; }
        // трение
        const k = Math.exp(-3.2 * dt);
        vx *= k; vy *= k;
        el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
        if (Math.hypot(vx, vy) > 25) {
          flings.set(key, requestAnimationFrame(step));
        } else {
          flings.delete(key);
          saveBlockPos(key, x, y);
        }
      };
      flings.set(key, requestAnimationFrame(step));
    }

    document.addEventListener('pointerdown', (e) => {
      if (!editing || e.button !== 0) return;
      const hit = keyOf(e.target);
      if (!hit) return;
      e.preventDefault();
      cancelAnimationFrame(flings.get(hit.key) || 0);
      flings.delete(hit.key);
      const b = (state.theme.blocks || {})[hit.key] || {};
      drag = { ...hit, startX: e.clientX, startY: e.clientY, baseX: b.x || 0, baseY: b.y || 0,
        trail: [{ t: performance.now(), x: e.clientX, y: e.clientY }] };
    });
    document.addEventListener('pointermove', (e) => {
      if (!editing || !drag) return;
      const x = Math.round(drag.baseX + e.clientX - drag.startX);
      const y = Math.round(drag.baseY + e.clientY - drag.startY);
      drag.el.style.translate = (x || y) ? `${x}px ${y}px` : '';
      drag.cur = { x, y };
      // хвост последних точек — из него считаем скорость броска
      drag.trail.push({ t: performance.now(), x: e.clientX, y: e.clientY });
      if (drag.trail.length > 6) drag.trail.shift();
    });
    document.addEventListener('pointerup', () => {
      if (!editing || !drag) return;
      const d = drag;
      drag = null;
      if (!d.cur) return;
      // скорость по хвосту движения (px/с)
      const a = d.trail[0];
      const b = d.trail[d.trail.length - 1];
      const dt = Math.max(0.001, (b.t - a.t) / 1000);
      const vx = (b.x - a.x) / dt;
      const vy = (b.y - a.y) / dt;
      if (Math.hypot(vx, vy) > 350) {
        fling(d.key, d.el, d.cur.x, d.cur.y, vx, vy); // бросили — летит и отскакивает
      } else {
        saveBlockPos(d.key, d.cur.x, d.cur.y);
      }
    });
    // колесо над блоком: прозрачность; с Shift — размер (шаг 5%)
    document.addEventListener('wheel', (e) => {
      if (!editing) return;
      const hit = keyOf(e.target);
      if (!hit) return;
      e.preventDefault();
      const blocks = blocksConf();
      const b = blocks[hit.key] || {};
      const dir = (e.shiftKey ? (e.deltaY || e.deltaX) : e.deltaY) < 0 ? 5 : -5;
      if (e.shiftKey) {
        const next = Math.max(50, Math.min(150, (b.s ?? 100) + dir));
        blocks[hit.key] = { ...b, s: next };
        hit.el.style.scale = next === 100 ? '' : String(next / 100);
      } else {
        const next = Math.max(20, Math.min(100, (b.o ?? 100) + dir));
        blocks[hit.key] = { ...b, o: next };
        hit.el.style.opacity = next === 100 ? '' : String(next / 100);
      }
      scheduleBlocksSave(blocks);
    }, { passive: false });
  })();

  $('btn-settings').addEventListener('click', () => { syncInputs(); openOverlay(overlay); });
  $('settings-close').addEventListener('click', () => closeOverlay(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay); });
})();

// ── init ────────────────────────────────────────────────────────────────
async function init() {
  const { config, versionInfo, account, bgMedia, arch } = await window.api.getConfig();
  // тему применяем первым делом, чтобы не мигнуть стандартной
  state.theme = config.theme || {};
  state.bgMedia = bgMedia || null;
  applyTheme(state.theme);
  applyBackground(state.bgMedia, state.theme);
  if (arch === 'ia32') {
    // 32-битный JVM не поднимет кучу больше ~1 ГБ — ползунок честно урезаем
    els.ram.min = 512;
    els.ram.max = 1024;
    els.ram.step = 128;
    const scale = els.ram.closest('.field')?.querySelector('.hint.scale');
    if (scale) {
      const [lo, hi] = scale.querySelectorAll('span');
      if (lo) lo.textContent = '512 МБ';
      if (hi) hi.textContent = '1 ГБ';
    }
  }
  els.ram.value = Math.min(config.ram || 4096, parseInt(els.ram.max, 10));
  els.ramVal.textContent = els.ram.value;
  els.joinServer.checked = config.joinServer !== false;
  els.discordRpc.checked = config.discordRpc !== false;
  state.gameDir = config.gameDir || '';
  els.gameDir.value = state.gameDir;
  state.loader = config.loader || 'fabric';
  state.account = account || null;
  els.mcVer.textContent = versionInfo.mc;
  els.verLine.textContent = (versionInfo.launcher ? 'v' + versionInfo.launcher + ' · ' : '')
    + 'Fabric ' + versionInfo.fabric + ' / Forge ' + versionInfo.forge;

  for (const btn of els.loader.querySelectorAll('.seg')) {
    btn.classList.toggle('active', btn.dataset.val === state.loader);
  }
  els.loaderHint.textContent = LOADER_HINTS[state.loader];
  updateAccountUI();
  if (!state.account) openLogin();
}

// ── события ─────────────────────────────────────────────────────────────
els.ram.addEventListener('input', () => { els.ramVal.textContent = els.ram.value; });
els.ram.addEventListener('change', persist);
els.joinServer.addEventListener('change', persist);
els.discordRpc.addEventListener('change', persist);

els.loader.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  state.loader = btn.dataset.val;
  for (const b of els.loader.querySelectorAll('.seg')) b.classList.toggle('active', b === btn);
  els.loaderHint.textContent = LOADER_HINTS[state.loader];
  persist();
});

els.btnDir.addEventListener('click', async () => {
  const dir = await window.api.pickDir();
  if (dir) { state.gameDir = dir; els.gameDir.value = dir; persist(); }
});
els.btnOpenDir.addEventListener('click', async () => {
  const res = await window.api.openGameDir();
  if (res && !res.ok) els.status.textContent = 'Не удалось открыть папку: ' + (res.error || '?');
});

els.tabs.addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) setTab(b.dataset.tab);
});

els.btnHeaderLogin.addEventListener('click', openLogin);
els.accChip.addEventListener('click', (e) => {
  e.stopPropagation();
  els.accMenu.hidden = !els.accMenu.hidden;
});
document.addEventListener('click', (e) => {
  if (!els.accMenu.hidden && !els.accMenu.contains(e.target)) els.accMenu.hidden = true;
});
els.menuSwitch.addEventListener('click', () => { els.accMenu.hidden = true; openLogin(); });
els.menuLogout.addEventListener('click', async () => {
  els.accMenu.hidden = true;
  await window.api.logout();
  state.account = null;
  els.status.textContent = 'Вы вышли из аккаунта';
  updateAccountUI();
  openLogin();
});

els.modalClose.addEventListener('click', closeLogin);
els.loginOverlay.addEventListener('click', (e) => { if (e.target === els.loginOverlay) closeLogin(); });
els.btnNickLogin.addEventListener('click', doNickLogin);
els.nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doNickLogin(); });
els.btnMsLogin.addEventListener('click', doMsLogin);

els.btnModSearch.addEventListener('click', doSearch);
els.modQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
// набор текста сразу фильтрует установленные (локально, без сети)
let filterTimer = null;
els.modQuery.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    state.filterQuery = els.modQuery.value.trim();
    refreshModsView();
  }, 150);
});
els.contentTypes.addEventListener('click', (e) => {
  const b = e.target.closest('.ctype');
  if (b && b.dataset.ctype !== state.contentType) setContentType(b.dataset.ctype);
});
els.resultsMode.addEventListener('click', (e) => {
  const b = e.target.closest('.segm');
  if (!b || b.dataset.mode === state.resultsMode) return;
  state.resultsMode = b.dataset.mode;
  for (const x of els.resultsMode.querySelectorAll('.segm')) x.classList.toggle('active', x === b);
  els.modQuery.value = '';   // топ показывается только для пустого поиска
  state.filterQuery = '';
  refreshModsView();
  doSearch();
});

els.btnPlay.addEventListener('click', async () => {
  if (!state.account) { openLogin(); return; }
  persist();
  setBusy(true);
  els.logbox.hidden = false;
  setProgress(-1);
  const res = await window.api.launch({
    ram: parseInt(els.ram.value, 10),
    loader: state.loader,
    joinServer: els.joinServer.checked,
    gameDir: state.gameDir,
  });
  if (!res || !res.ok) {
    els.status.textContent = 'Ошибка: ' + (res && res.error ? res.error : 'неизвестно');
    setProgress(0);
    setBusy(false);
  }
});

els.btnLog.addEventListener('click', () => { els.logbox.hidden = !els.logbox.hidden; });
els.linkSite.addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal('https://mistmc.gg'); });
els.btnMin.addEventListener('click', () => window.api.minimize());
els.btnClose.addEventListener('click', () => window.api.close());

window.api.onStatus((t) => { els.status.textContent = t; });
window.api.onProgress((d) => { setProgress(d.percent); if (d.label) els.status.textContent = d.label; });
window.api.onLog((l) => log(l));
window.api.onLaunchError((msg) => {
  els.status.textContent = 'Ошибка запуска: ' + msg;
  setBusy(false);
  setProgress(0);
});
window.api.onAuthExpired(() => {
  state.account = null;
  updateAccountUI();
  openLogin();
});
// Мягкое обновление: одна кнопка в футере. Пока качается — показывает процент;
// клик в любой момент = «обнови и перезапусти» (тихая установка без мастера NSIS).
let updClicked = false;
let updVersion = '';
if (window.api.onUpdateState) {
  window.api.onUpdateState((d) => {
    if (!d || d.state === 'error') { if (!updClicked) els.btnUpdate.hidden = true; return; }
    if (d.version) updVersion = d.version;
    els.btnUpdate.hidden = false;
    if (d.state === 'available') {
      els.btnUpdate.disabled = false;
      els.btnUpdate.textContent = '⬆ Обновить до ' + updVersion;
    } else if (d.state === 'downloading') {
      const pct = typeof d.percent === 'number' && d.percent >= 0 ? ' ' + d.percent + '%' : '…';
      els.btnUpdate.textContent = updClicked ? '⬇ Загрузка' + pct + ' — установится сам' : '⬆ Обновить · ⬇' + pct;
    } else if (d.state === 'ready') {
      // если юзер уже нажал — main сам тихо переустановит и перезапустит
      els.btnUpdate.disabled = false;
      els.btnUpdate.textContent = updClicked ? '⬆ Устанавливаю…' : '⬆ Обновить до ' + updVersion;
    }
    els.btnUpdate.title = 'Мягкое обновление: скачается и тихо перезапустит лаунчер — без окон установщика.';
  });
  els.btnUpdate.addEventListener('click', () => {
    updClicked = true;
    els.btnUpdate.disabled = true;
    els.btnUpdate.textContent = '⬆ Обновляю…';
    window.api.updateRestart();
  });
}
window.api.onState((s) => {
  if (s.state === 'running') {
    els.status.textContent = 'Игра запущена';
    setProgress(100);
  } else if (s.state === 'idle') {
    setBusy(false);
  } else if (s.state === 'working') {
    setBusy(true);
  }
});

bindCosmeticsTabs();
bindDrawEditor();
init();

// ── Код сборки: поделиться своим набором модов и применить чужой ──
(() => {
  const overlay = $('build-overlay');
  const codeInput = $('build-code');
  const makeBtn = $('build-make');
  const copyBtn = $('build-copy');
  const shareHint = $('build-share-hint');
  const applyInput = $('build-input');
  const applyBtn = $('build-apply');
  const resultsBox = $('build-results');
  if (!overlay) return;

  function open(focusApply) {
    resultsBox.hidden = true;
    resultsBox.textContent = '';
    shareHint.textContent = '';
    // сбрасываем прошлый код: набор модов мог измениться с прошлого открытия
    codeInput.value = '';
    makeBtn.hidden = false;
    copyBtn.hidden = true;
    previewed = null;
    $('apply-parts').hidden = true;
    applyBtn.textContent = 'Применить';
    $('build-apply-hint').textContent = 'Доставим недостающие моды. Твои моды не удалятся.';
    openOverlay(overlay);
    if (focusApply) setTimeout(() => applyInput.focus(), 40);
  }

  $('btn-share-build').addEventListener('click', () => open(false));
  $('btn-apply-build').addEventListener('click', () => open(true));
  $('build-close').addEventListener('click', () => closeOverlay(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay); });

  const shareParts = () => ({
    configs: $('share-configs').checked,
    options: $('share-options').checked,
    shaders: $('share-shaders').checked,
  });
  const applyParts = () => ({
    configs: $('apply-configs').checked,
    options: $('apply-options').checked,
    shaders: $('apply-shaders').checked,
  });

  /** «5 модов · настройки модов (12) · управление» — что лежит в коде. */
  function describeBuild(items, info) {
    const parts = [];
    if (items) parts.push(items + ' ' + (items === 1 ? 'позиция' : items < 5 ? 'позиции' : 'позиций'));
    if (info && info.configs) parts.push('настройки модов (' + info.configs + ')');
    if (info && info.options) parts.push('управление и графика');
    if (info && info.shaders) parts.push('настройки шейдеров (' + info.shaders + ')');
    return parts.join(' · ') || 'пусто';
  }

  makeBtn.addEventListener('click', async () => {
    makeBtn.disabled = true;
    makeBtn.textContent = 'Создаю…';
    const res = await window.api.buildShare(state.loader, shareParts());
    makeBtn.disabled = false;
    makeBtn.textContent = 'Создать код';
    if (res && res.ok) {
      codeInput.value = res.code;
      // «Копировать» встаёт НА МЕСТО «Создать код»: три элемента в строку
      // не помещались и кнопку выдавливало за край модалки
      makeBtn.hidden = true;
      copyBtn.hidden = false;
      const what = res.filesInfo
        ? ' В коде: ' + describeBuild(0, res.filesInfo).replace(/^ · /, '') + '.'
        : '';
      shareHint.textContent = (res.reused
        ? 'Этот код уже был создан для такой же сборки — им и делись.'
        : 'Готово! Отправь код друзьям — у них соберётся то же самое.') + what;
    } else {
      codeInput.value = '';
      makeBtn.hidden = false;
      copyBtn.hidden = true;
      shareHint.textContent = 'Не получилось: ' + ((res && res.error) || 'сайт недоступен');
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!codeInput.value) return;
    try {
      await navigator.clipboard.writeText(codeInput.value);
      copyBtn.textContent = '✓ Скопировано';
      setTimeout(() => { copyBtn.textContent = 'Копировать'; }, 1500);
    } catch (_) {
      codeInput.select(); // буфер недоступен — пусть скопирует руками
    }
  });

  // Если в коде есть чужие настройки, сперва показываем что там и даём галочки:
  // молча заменять человеку раскладку клавиш нельзя.
  let previewed = null; // код, который уже показали
  const partsBox = $('apply-parts');
  const applyHint = $('build-apply-hint');

  applyInput.addEventListener('input', () => {
    if (previewed && previewed !== applyInput.value.trim().toUpperCase()) {
      previewed = null;
      partsBox.hidden = true;
      applyBtn.textContent = 'Применить';
      applyHint.textContent = 'Доставим недостающие моды. Твои моды не удалятся.';
    }
  });

  applyBtn.addEventListener('click', async () => {
    const code = applyInput.value.trim();
    if (!code) { applyInput.focus(); return; }

    if (previewed !== code.toUpperCase()) {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Смотрю…';
      const pv = await window.api.buildPreview(code);
      applyBtn.disabled = false;
      applyBtn.textContent = 'Применить';
      if (!pv || !pv.ok) {
        resultsBox.hidden = false;
        resultsBox.textContent = '✖ ' + ((pv && pv.error) || 'код не найден');
        return;
      }
      previewed = code.toUpperCase();
      applyHint.textContent = 'Сборка игрока ' + pv.author + ': ' + describeBuild(pv.items, pv.filesInfo);
      if (pv.filesInfo) {
        // показываем только те галочки, что реально есть в коде
        partsBox.hidden = false;
        $('apply-configs').closest('.checkbox').hidden = !pv.filesInfo.configs;
        $('apply-options').closest('.checkbox').hidden = !pv.filesInfo.options;
        $('apply-shaders').closest('.checkbox').hidden = !pv.filesInfo.shaders;
        applyBtn.textContent = 'Установить';
        return; // второй клик — установка
      }
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Применяю…';
    resultsBox.hidden = false;
    resultsBox.textContent = 'Скачиваю моды сборки…';
    const res = await window.api.buildApply(code, applyParts());
    applyBtn.disabled = false;
    applyBtn.textContent = 'Применить';
    previewed = null;
    partsBox.hidden = true;
    if (!res || !res.ok) {
      resultsBox.textContent = '✖ ' + ((res && res.error) || 'не удалось применить код');
      return;
    }
    const s = res.summary || {};
    const lines = ['Сборка игрока ' + (res.author || '?') + ':'];
    if (s.installed?.length) lines.push('✓ поставлено: ' + s.installed.join(', '));
    if (s.already?.length) lines.push('• уже было: ' + s.already.join(', '));
    if (s.failed?.length) lines.push('✖ не вышло: ' + s.failed.join('; '));
    if (s.files?.written) {
      lines.push('⚙ настроек применено: ' + s.files.written
        + (s.files.backedUp ? ' (прежние сохранены как *.bak-build)' : ''));
    }
    if (!s.installed?.length && !s.already?.length && !s.files?.written) {
      lines.push('в сборке нечего ставить');
    }
    resultsBox.textContent = lines.join('\n');
    refreshModsView();
  });
})();

// ── Перенос из другого лаунчера ──
(() => {
  const overlay = document.getElementById('migrate-overlay');
  const closeBtn = document.getElementById('migrate-close');
  const openBtn = document.getElementById('btn-migrate');
  const sourceSel = document.getElementById('migrate-source');
  const browseBtn = document.getElementById('migrate-browse');
  const hint = document.getElementById('migrate-source-hint');
  const runBtn = document.getElementById('migrate-run');
  const resultsBox = document.getElementById('migrate-results');
  if (!overlay || !openBtn) return;

  let sources = [];  // найденные лаунчеры [{dir,label,stats}]
  let manual = null; // папка, выбранная вручную через «Обзор…»

  function statsLine(st) {
    if (!st) return '';
    const parts = [];
    if (st.options) parts.push('настройки');
    if (st.servers) parts.push('сервера');
    if (st.resourcepacks) parts.push('паки: ' + st.resourcepacks);
    if (st.shaderpacks) parts.push('шейдеры: ' + st.shaderpacks);
    if (st.saves) parts.push('миры: ' + st.saves);
    if (st.configs) parts.push('конфиги: ' + st.configs);
    return parts.length ? 'Найдено: ' + parts.join(', ') : 'Похоже, папка пустая.';
  }

  function renderSources() {
    sourceSel.innerHTML = '';
    const all = manual ? [...sources, manual] : sources;
    if (!all.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Другие лаунчеры не найдены — выбери папку вручную';
      sourceSel.appendChild(o);
    }
    for (const s of all) {
      const o = document.createElement('option');
      o.value = s.dir;
      o.textContent = s.label;
      sourceSel.appendChild(o);
    }
    if (manual) sourceSel.value = manual.dir;
    updateHint();
  }

  function currentSource() {
    const all = manual ? [...sources, manual] : sources;
    return all.find((s) => s.dir === sourceSel.value) || null;
  }

  function updateHint() {
    const s = currentSource();
    if (!s) { hint.textContent = ''; return; }
    let t = statsLine(s.stats);
    if (s.looksLikeMinecraft === false) t = '⚠ Не похоже на папку Minecraft. ' + t;
    hint.textContent = t;
  }

  async function openMigrate() {
    openOverlay(overlay);
    resultsBox.hidden = true;
    resultsBox.textContent = '';
    sources = (await window.api.migrateScan()) || [];
    renderSources();
  }
  openBtn.addEventListener('click', openMigrate);
  // дубль в футере: из «Дополнительно» кнопку никто не находил
  const footerBtn = document.getElementById('btn-migrate-footer');
  if (footerBtn) footerBtn.addEventListener('click', openMigrate);
  closeBtn.addEventListener('click', () => closeOverlay(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(overlay); });
  sourceSel.addEventListener('change', updateHint);

  browseBtn.addEventListener('click', async () => {
    const picked = await window.api.migratePick();
    if (!picked) return;
    manual = picked;
    renderSources();
  });

  runBtn.addEventListener('click', async () => {
    const s = currentSource();
    if (!s) { hint.textContent = 'Сначала выбери папку.'; return; }
    runBtn.disabled = true;
    runBtn.textContent = 'Переношу…';
    const parts = {
      options: document.getElementById('mig-options').checked,
      servers: document.getElementById('mig-servers').checked,
      resourcepacks: document.getElementById('mig-resourcepacks').checked,
      shaderpacks: document.getElementById('mig-shaderpacks').checked,
      saves: document.getElementById('mig-saves').checked,
      configs: document.getElementById('mig-configs').checked,
    };
    const results = (await window.api.migrateRun(s.dir, parts)) || [];
    resultsBox.textContent = results.join('\n');
    resultsBox.hidden = false;
    runBtn.disabled = false;
    runBtn.textContent = 'Перенести';
  });
})();
