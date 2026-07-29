'use strict';

const $ = (id) => document.getElementById(id);

// Мок для предпросмотра в обычном браузере (без Electron): дизайн смотрибелен,
// кнопки не падают. В собранном лаунчере window.api приходит из preload.
if (!window.api) {
  const noop = () => {};
  window.api = {
    getConfig: async () => ({
      config: { ram: 4096, loader: 'fabric', joinServer: true, gameDir: 'C:\\…\\.mistmc' },
      versionInfo: { mc: '1.21.11', fabric: '0.19.3', forge: '61.1.0' },
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
    openExternal: noop, minimize: noop, close: noop,
    onProgress: noop, onStatus: noop, onLog: noop, onState: noop,
    onLaunchError: noop, onAuthExpired: noop,
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
  els.loginOverlay.hidden = false;
  setTimeout(() => els.nickInput.focus(), 30);
}
function closeLogin() {
  els.loginOverlay.hidden = true;
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
      : 'Пока пусто — выбери что-нибудь из подборки ниже или найди через поиск.';
    els.listInstalled.appendChild(empty);
  }
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
    dl.textContent = '⬇ ' + fmtDownloads(h.downloads);
    t.appendChild(dl);
    const s = document.createElement('div');
    s.className = 'mod-sub';
    s.textContent = h.description;
    meta.append(t, s);
    row.appendChild(meta);

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
}

const CTYPE_POPULAR_TITLES = {
  mod: 'Популярные моды',
  resourcepack: 'Популярные ресурспаки',
  shader: 'Популярные шейдеры',
};

let searching = false;
async function doSearch() {
  if (searching || (state.contentType === 'mod' && state.loader === 'vanilla')) return;
  searching = true;
  const q = els.modQuery.value.trim();
  els.resultsTitle.textContent = q ? 'Результаты: «' + q + '»' : CTYPE_POPULAR_TITLES[state.contentType];
  els.secResults.hidden = false;
  els.listResults.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'mods-empty';
  loading.textContent = q ? 'Ищу на Modrinth…' : 'Загружаю подборку…';
  els.listResults.appendChild(loading);
  // пустой запрос = кураторская подборка с русскими описаниями
  const res = q
    ? await window.api.modsSearch(q, state.contentType, state.loader)
    : await window.api.modsPopular(state.contentType, state.loader);
  searching = false;
  if (res && res.ok) {
    renderResults(res.hits);
    // сразу показываем найденное, а не заставляем листать мимо установленных
    if (q) els.secResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    els.listResults.replaceChildren();
    const err = document.createElement('div');
    err.className = 'mods-empty';
    err.textContent = (res && res.error) || 'Modrinth недоступен';
    els.listResults.appendChild(err);
  }
}

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
  els.verLine.textContent = 'Fabric ' + versionInfo.fabric + ' / Forge ' + versionInfo.forge;

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
if (window.api.onUpdateReady) {
  window.api.onUpdateReady((d) => {
    els.btnUpdate.hidden = false;
    els.btnUpdate.title = 'Версия ' + (d && d.version ? d.version : '') + ' скачана. Установится и за секунду перезапустит лаунчер.';
  });
  els.btnUpdate.addEventListener('click', () => window.api.updateRestart());
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
    overlay.hidden = false;
    resultsBox.hidden = true;
    resultsBox.textContent = '';
    sources = (await window.api.migrateScan()) || [];
    renderSources();
  }
  openBtn.addEventListener('click', openMigrate);
  // дубль в футере: из «Дополнительно» кнопку никто не находил
  const footerBtn = document.getElementById('btn-migrate-footer');
  if (footerBtn) footerBtn.addEventListener('click', openMigrate);
  closeBtn.addEventListener('click', () => { overlay.hidden = true; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
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
