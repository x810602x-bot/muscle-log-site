import * as db from './db.js?v=087c7e0';
import { $, toast } from './util.js?v=087c7e0';
import * as today from './today.js?v=087c7e0';
import * as trends from './trends.js?v=087c7e0';
import * as body from './body.js?v=087c7e0';
import * as foods from './foods.js?v=087c7e0';
import * as recipes from './recipes.js?v=087c7e0';
import * as settings from './settings.js?v=087c7e0';

const pages = { today, trends, body, foods, recipes, settings };

function show(tab) {
  if (!pages[tab]) tab = 'today';
  for (const el of document.querySelectorAll('.page')) el.hidden = el.id !== `page-${tab}`;
  for (const btn of document.querySelectorAll('#tabs button')) {
    btn.toggleAttribute('aria-current', btn.dataset.tab === tab);
  }
  history.replaceState(null, '', `#${tab}`);
  pages[tab].show().catch(fail);
}

function fail(err) {
  console.error(err);
  toast(`出錯了：${err.message}`);
}
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

// 登入狀態決定看到哪一個畫面：沒登入／登入了但不在白名單／正常用
let currentUid;   // undefined＝還沒決定過
let booted = false;

async function applySession(session) {
  const uid = session?.user?.id ?? null;
  if (uid === currentUid) return; // token 換新之類的，畫面不用重來
  currentUid = uid;

  const allowed = session ? await db.amIAllowed() : false;
  $('#login').hidden = !!session;
  $('#denied').hidden = !session || allowed;
  $('#app').hidden = !session || !allowed;

  if (session && !allowed) $('#denied-email').textContent = session.user.email ?? '';
  if (session && allowed) {
    fillAccount(session.user);
    show(location.hash.slice(1));
  }
  if (!booted) { booted = true; refreshIfStale(); }
}

// 右上角的帳號鈕：Google 大頭貼，載不到就用名字第一個字
function fillAccount(user) {
  const meta = user.user_metadata ?? {};
  const name = meta.full_name || meta.name || user.email || '';
  const avatar = $('#account-avatar');
  $('#account-name').textContent = name;
  $('#account-email').textContent = user.email ?? '';
  $('#account-initial').textContent = (name[0] ?? '?').toUpperCase();
  avatar.hidden = !(meta.avatar_url || meta.picture);
  if (!avatar.hidden) avatar.src = meta.avatar_url || meta.picture;
}

window.addEventListener('hashchange', () => show(location.hash.slice(1)));
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) show(btn.dataset.tab);
});

$('#google-login').addEventListener('click', async () => {
  const error = $('#login-error');
  error.hidden = true;
  try {
    await db.signInWithGoogle(); // 跳去 Google，回來會再進 applySession
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

// 帳號小選單：點按鈕開關，點外面或 Esc 收起來
const accountMenu = $('#account-menu');
function toggleAccount(open) {
  accountMenu.hidden = !open;
  $('#account').setAttribute('aria-expanded', String(open));
}
$('#account').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAccount(accountMenu.hidden);
});
document.addEventListener('click', (e) => {
  if (!accountMenu.hidden && !accountMenu.contains(e.target)) toggleAccount(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleAccount(false);
});

for (const id of ['#logout', '#denied-switch']) {
  $(id).addEventListener('click', async () => {
    await db.signOut();
    location.replace(location.pathname);
  });
}

// 註冊 sw.js：手機的瀏覽器看到它才會給「安裝／加到主畫面」
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

db.onAuth((session) => applySession(session).catch(fail));

// 瀏覽器會把首頁留著好幾分鐘，改版後看到的還是舊的。打開或切回來時問一次線上的版本號
// （發布時加在 app.js?v= 後面），不一樣就換到新版；網址帶新版本號，才不會又拿到留著的舊首頁。
async function refreshIfStale() {
  const mine = new URL(import.meta.url).searchParams.get('v');
  const q = new URLSearchParams(location.search);
  // 本機開發沒有版本號；正在填東西、或 Google 剛跳回來（網址還帶著 code）就先不換
  if (!mine || q.has('code') || q.has('error') || document.querySelector('dialog[open]')) return;
  const html = await fetch(`index.html?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text()).catch(() => '');
  const latest = html.match(/app\.js\?v=(\w+)/)?.[1];
  const tried = new URLSearchParams(location.search).get('v'); // 已經換過這一版還是舊的就不再換，免得一直重載
  if (latest && latest !== mine && latest !== tried) location.replace(`${location.pathname}?v=${latest}${location.hash}`);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshIfStale();
});
