'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  username: $('username'),
  usernameHint: $('username-hint'),
  ram: $('ram'),
  ramVal: $('ram-val'),
  joinServer: $('joinServer'),
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
  btnMin: $('btn-min'),
  btnClose: $('btn-close'),
};

let state = {
  loader: 'fabric',
  gameDir: '',
};

const LOADER_HINTS = {
  fabric: 'Fabric — рекомендуется, с модами Mist MC',
  forge: 'Forge — для модпаков на Forge',
  vanilla: 'Vanilla — чистый клиент без модов',
};

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

function validateName() {
  const v = els.username.value.trim();
  const ok = /^[A-Za-z0-9_]{3,16}$/.test(v);
  els.usernameHint.style.color = v && !ok ? 'var(--danger)' : '';
  return ok;
}

function persist() {
  window.api.saveConfig({
    username: els.username.value.trim(),
    ram: parseInt(els.ram.value, 10),
    loader: state.loader,
    joinServer: els.joinServer.checked,
    gameDir: state.gameDir,
  });
}

async function init() {
  const { config, versionInfo } = await window.api.getConfig();
  els.username.value = config.username || '';
  els.ram.value = config.ram || 4096;
  els.ramVal.textContent = els.ram.value;
  els.joinServer.checked = config.joinServer !== false;
  state.gameDir = config.gameDir || '';
  els.gameDir.value = state.gameDir;
  state.loader = config.loader || 'fabric';
  els.mcVer.textContent = versionInfo.mc;
  els.verLine.textContent = 'Fabric ' + versionInfo.fabric + ' / Forge ' + versionInfo.forge;

  for (const btn of els.loader.querySelectorAll('.seg')) {
    btn.classList.toggle('active', btn.dataset.val === state.loader);
  }
  els.loaderHint.textContent = LOADER_HINTS[state.loader];
  validateName();
}

els.ram.addEventListener('input', () => { els.ramVal.textContent = els.ram.value; });
els.ram.addEventListener('change', persist);
els.username.addEventListener('input', validateName);
els.username.addEventListener('change', persist);
els.joinServer.addEventListener('change', persist);

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

els.btnPlay.addEventListener('click', async () => {
  if (!validateName()) {
    els.username.focus();
    els.status.textContent = 'Введите корректный ник';
    return;
  }
  persist();
  els.btnPlay.disabled = true;
  els.logbox.hidden = false;
  setProgress(-1);
  const res = await window.api.launch({
    username: els.username.value.trim(),
    ram: parseInt(els.ram.value, 10),
    loader: state.loader,
    joinServer: els.joinServer.checked,
    gameDir: state.gameDir,
  });
  if (!res || !res.ok) {
    els.status.textContent = 'Ошибка: ' + (res && res.error ? res.error : 'неизвестно');
    setProgress(0);
    els.btnPlay.disabled = false;
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
  els.btnPlay.disabled = false;
  setProgress(0);
});
window.api.onState((s) => {
  if (s.state === 'running') {
    els.status.textContent = 'Игра запущена';
    setProgress(100);
  } else if (s.state === 'idle') {
    els.btnPlay.disabled = false;
  } else if (s.state === 'working') {
    els.btnPlay.disabled = true;
  }
});

init();
