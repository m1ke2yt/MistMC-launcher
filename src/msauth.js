'use strict';

// Вход через Microsoft (лицензия). Поток: OAuth (tenant consumers) → Xbox Live →
// XSTS → Minecraft Services → профиль. Требует одобренного в Microsoft AppID,
// иначе api.minecraftservices.com отдаёт 403.
//
// Основной путь — СИСТЕМНЫЙ БРАУЗЕР (loopback + PKCE): у браузера кэш и живые
// сессии Microsoft, вход мгновенный. Требует redirect URI `http://localhost`
// в Azure (платформа Mobile and desktop applications). Electron-окно осталось
// запасным путём, если браузер не открылся/вход не завершился.

const { BrowserWindow, shell } = require('electron');
const http = require('http');
const crypto = require('crypto');

const REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPE = 'XboxLive.signin offline_access';
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function resultHtml(ok) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Mist MC</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0f0518;color:#f3e8ff;font-family:'Segoe UI',sans-serif;text-align:center">
<div><div style="font-size:44px;margin-bottom:12px">${ok ? '✅' : '❌'}</div>
<h2 style="margin:0 0 8px;color:#a855f7">${ok ? 'Вход выполнен' : 'Вход не удался'}</h2>
<p style="color:#b9a6d6">${ok ? 'Можно закрыть вкладку и вернуться в лаунчер Mist MC.' : 'Закрой вкладку и попробуй ещё раз в лаунчере.'}</p>
</div></body></html>`;
}

// Вход через системный браузер: loopback-редирект + PKCE (S256).
function getAuthCodeViaBrowser(clientId) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const server = http.createServer();

    server.once('error', (e) => reject(new Error('локальный порт: ' + e.message)));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirect = 'http://localhost:' + port;
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Время входа истекло (5 минут)'));
      }, 300000);

      server.on('request', (req, res) => {
        const u = new URL(req.url, redirect);
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error_description') || u.searchParams.get('error');
        if (!code && !err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultHtml(!!code));
        clearTimeout(timer);
        server.close();
        if (code) resolve({ code, redirect, verifier });
        else reject(new Error(err || 'Вход не завершён'));
      });

      const authUrl = `${AUTHORITY}/authorize?` + new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirect,
        scope: SCOPE,
        prompt: 'select_account',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      shell.openExternal(authUrl).catch((e) => {
        clearTimeout(timer);
        server.close();
        reject(new Error('браузер не открылся: ' + e.message));
      });
    });
  });
}

// Открывает окно входа Microsoft и возвращает authorization code.
function getAuthCode(clientId, parent) {
  return new Promise((resolve, reject) => {
    const authUrl = `${AUTHORITY}/authorize?` + new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: SCOPE,
      prompt: 'select_account',
    }).toString();

    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent,
      modal: !!parent,
      autoHideMenuBar: true,
      title: 'Вход Microsoft',
      backgroundColor: '#0f0518', // не слепим белым, пока Microsoft думает
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.setMenuBarVisibility(false);

    let settled = false;
    const finish = (url) => {
      if (settled || !url || url.indexOf(REDIRECT) !== 0) return;
      const u = new URL(url);
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error_description') || u.searchParams.get('error');
      settled = true;
      win.removeAllListeners('closed');
      win.destroy();
      if (code) resolve(code);
      else reject(new Error(err || 'Вход не завершён'));
    };
    win.webContents.on('will-redirect', (_e, url) => finish(url));
    win.webContents.on('will-navigate', (_e, url) => finish(url));
    win.on('closed', () => { if (!settled) reject(new Error('Окно входа закрыто')); });
    // мгновенная тёмная заставка, затем навигация на страницу Microsoft:
    // у части провайдеров login.microsoftonline.com отвечает медленно,
    // и без заставки окно висело пустым белым
    const splash = 'data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'background:#0f0518;color:#b9a6d6;font-family:Segoe UI,sans-serif">' +
      '<div style="text-align:center"><div style="font-size:34px;margin-bottom:10px">✦</div>' +
      'Открываю вход Microsoft…<br><small>если долго — проверь VPN/интернет</small></div></body>');
    win.loadURL(splash);
    win.webContents.once('did-finish-load', () => { if (!settled) win.loadURL(authUrl); });
  });
}

async function postForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('token ' + res.status + ': ' + text.slice(0, 200));
  return JSON.parse(text);
}

async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  });
  return res;
}

function xstsErrorMessage(xerr) {
  switch (String(xerr)) {
    case '2148916233': return 'У этого аккаунта Microsoft нет профиля Xbox — создайте его на xbox.com и попробуйте снова.';
    case '2148916235': return 'Xbox Live недоступен в стране вашего аккаунта.';
    case '2148916236':
    case '2148916237': return 'Аккаунту нужно пройти проверку возраста (adult verification).';
    case '2148916238': return 'Детский аккаунт: добавьте его в семью взрослого на xbox.com.';
    default: return 'Xbox (XSTS) отказал в доступе (код ' + xerr + ').';
  }
}

// Из токенов Microsoft получаем игровой профиль и Minecraft-токен.
async function toMinecraft(msTokens) {
  const msAccess = msTokens.access_token;

  const xblRes = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccess },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (!xblRes.ok) throw new Error('Xbox Live: ' + xblRes.status);
  const xbl = await xblRes.json();
  const xblToken = xbl.Token;
  const uhs = xbl.DisplayClaims.xui[0].uhs;

  const xstsRes = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (xstsRes.status === 401) {
    const j = await xstsRes.json().catch(() => ({}));
    throw new Error(xstsErrorMessage(j.XErr));
  }
  if (!xstsRes.ok) throw new Error('XSTS: ' + xstsRes.status);
  const xsts = await xstsRes.json();
  const xstsToken = xsts.Token;

  const mcRes = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
  });
  if (mcRes.status === 403) {
    throw new Error('APP_NOT_APPROVED');
  }
  if (!mcRes.ok) throw new Error('Minecraft auth: ' + mcRes.status);
  const mc = await mcRes.json();
  const mcAccess = mc.access_token;

  const profRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + mcAccess },
  });
  if (profRes.status === 404) throw new Error('NO_MINECRAFT');
  if (!profRes.ok) throw new Error('Профиль Minecraft: ' + profRes.status);
  const prof = await profRes.json();

  return {
    name: prof.name,
    uuid: prof.id,
    accessToken: mcAccess,
    refreshToken: msTokens.refresh_token,
  };
}

// Интерактивный вход через Electron-окно (тёмная заставка вместо белого экрана).
// Браузерный путь (getAuthCodeViaBrowser) готов, но включится основным только
// после добавления redirect `http://localhost` в Azure — иначе Microsoft отдаёт
// ошибку redirect и loopback висит на таймауте. Флаг BROWSER_LOGIN переключает.
const BROWSER_LOGIN = true;

async function login(clientId, parent) {
  if (BROWSER_LOGIN) {
    try {
      const auth = await getAuthCodeViaBrowser(clientId);
      const tokens = await postForm(`${AUTHORITY}/token`, {
        client_id: clientId,
        code: auth.code,
        grant_type: 'authorization_code',
        redirect_uri: auth.redirect,
        scope: SCOPE,
        code_verifier: auth.verifier,
      });
      return await toMinecraft(tokens);
    } catch (e) {
      if (/access_denied|отмен|declined/i.test(String(e && e.message))) throw new Error('Вход отменён.');
      // технический сбой браузера → штатное окно
    }
  }
  const code = await getAuthCode(clientId, parent);
  const tokens = await postForm(`${AUTHORITY}/token`, {
    client_id: clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT,
    scope: SCOPE,
  });
  return toMinecraft(tokens);
}

// Тихое обновление по refresh-токену (без окна).
async function refresh(clientId, refreshToken) {
  const tokens = await postForm(`${AUTHORITY}/token`, {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPE,
  });
  return toMinecraft(tokens);
}

module.exports = { login, refresh };
