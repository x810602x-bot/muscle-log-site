import * as db from './db.js?v=94d1c11';
import { $, toast } from './util.js?v=94d1c11';
import * as today from './today.js?v=94d1c11';
import * as trends from './trends.js?v=94d1c11';
import * as body from './body.js?v=94d1c11';
import * as foods from './foods.js?v=94d1c11';
import * as recipes from './recipes.js?v=94d1c11';
import * as settings from './settings.js?v=94d1c11';

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

async function boot() {
  const session = await db.getSession();
  $('#login').hidden = !!session;
  $('#app').hidden = !session;
  if (session) show(location.hash.slice(1));
}

window.addEventListener('hashchange', () => show(location.hash.slice(1)));
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) show(btn.dataset.tab);
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#login-email').value;
  const password = $('#login-password').value;
  const error = $('#login-error');
  error.hidden = true;
  try {
    await db.signIn(email, password);
    await boot();
  } catch (err) {
    error.textContent = err.message === 'Invalid login credentials' ? 'Email 或密碼不對' : err.message;
    error.hidden = false;
  }
});

boot().catch(fail);

// 瀏覽器會把首頁留著好幾分鐘，改版後看到的還是舊的。打開或切回來時問一次線上的版本號
// （發布時加在 app.js?v= 後面），不一樣就換到新版；網址帶新版本號，才不會又拿到留著的舊首頁。
async function refreshIfStale() {
  const mine = new URL(import.meta.url).searchParams.get('v');
  if (!mine || document.querySelector('dialog[open]')) return; // 本機開發沒有版本號；正在填東西就先不換
  const html = await fetch(`index.html?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text()).catch(() => '');
  const latest = html.match(/app\.js\?v=(\w+)/)?.[1];
  const tried = new URLSearchParams(location.search).get('v'); // 已經換過這一版還是舊的就不再換，免得一直重載
  if (latest && latest !== mine && latest !== tried) location.replace(`${location.pathname}?v=${latest}${location.hash}`);
}
refreshIfStale();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshIfStale();
});
