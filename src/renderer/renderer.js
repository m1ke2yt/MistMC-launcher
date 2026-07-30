'use strict';

const $ = (id) => document.getElementById(id);

// Мок для предпросмотра в обычном браузере (без Electron): дизайн смотрибелен,
// кнопки не падают. В собранном лаунчере window.api приходит из preload.
if (!window.api) {
  const noop = () => {};
  window.api = {
    getConfig: async () => ({
      config: { ram: 4096, loader: 'fabric', joinServer: true, gameDir: 'C:\\…\\.mistmc' },
      versionInfo: { mc: '1.21.11', fabric: '0.19.3', forge: '61.1.0', launcher: '1.5.1' },
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

function log(line) {
  els.logbox.textContent += (line + '\n');
  els.logbox.scrollTop = els.logbox.scrollHeight;
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
function setTab(tab) {
  state.tab = tab;
  for (const b of els.tabs.querySelectorAll('.tab')) {
    b.classList.toggle('active', b.dataset.tab === tab);
  }
  els.viewGame.hidden = tab !== 'game';
  els.viewMods.hidden = tab !== 'mods';
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.modOverlay.hidden) closeModModal(); });
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
  } else {
    els.modmInstall.disabled = false;
    els.modmInstall.textContent = '⬇ Скачать';
    els.modmHint.textContent = 'Ошибка: ' + ((res && res.error) || 'не удалось установить');
  }
});

// ── init ────────────────────────────────────────────────────────────────
async function init() {
  const { config, versionInfo, account } = await window.api.getConfig();
  els.ram.value = config.ram || 4096;
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
