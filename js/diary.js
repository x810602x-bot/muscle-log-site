import * as db from './db.js?v=00735aa';
import { $, esc, localDate, openDialog, toast } from './util.js?v=00735aa';

// 日曆分頁（2026-10-29，月曆照 P.C. 那個 App 的樣子）：一整個月，點一天就記那天：生理期、日記、避孕藥第幾天、
// 性行為（有無前戲、多久、潤滑液品牌）、會不會痛。一天一筆存 diary_logs（day 唯一）。
// 生理期、日記以外的欄位都放 picks（jsonb）：{ pill_day, vaseline: 'yes'|'no'（舊的 true＝有擦）, foreplay: 'yes'|'no', foreplay_min, lube, pain: ['vestibule', …],
// swab: [[x, y], …]（棉棒測試畫的紅圈，座標是圖 viewBox 330×300 裡的位置）}，
// 要加減項目改 index.html 的 diary-dialog 跟這裡就好，不用動資料庫。
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
const RECENT_ROWS = 10; // 潤滑液品牌的建議：看最近幾筆記過的
const PILL_STOP = '2026-11-05'; // 這天起沒吃避孕藥了，記錄框不再出現「服用避孕藥第幾天」（那天已經有填的照樣顯示）
let cur = new Date(); // 正在看的月份（只用年、月）
let rows = new Map(); // day → 那天那一筆

export async function show() {
  const y = cur.getFullYear(), m = cur.getMonth();
  const first = localDate(new Date(y, m, 1)), last = localDate(new Date(y, m + 1, 0));
  const [month, latest] = await Promise.all([db.listDiary(first, last), db.listDiaryRecent(RECENT_ROWS)]);
  rows = new Map(month.map((r) => [r.day, r]));
  const brands = [...new Set(latest.map((r) => r.picks?.lube).filter(Boolean))];
  $('#diary-lube-list').innerHTML = brands.map((b) => `<option value="${esc(b)}">`).join('');
  $('#diary-month').textContent = `${y} 年 ${m + 1} 月`;
  const today = localDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // 星期一開頭
  const days = new Date(y, m + 1, 0).getDate();
  $('#diary-grid').innerHTML = '<span></span>'.repeat(lead) + Array.from({ length: days }, (_, i) => {
    const day = localDate(new Date(y, m, i + 1));
    const r = rows.get(day);
    const cls = ['diary-day', r?.period && 'period', day === today && 'today'].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-day="${day}"><span>${i + 1}</span>${r && hasContent(r) ? '<span class="dot"></span>' : ''}</button>`;
  }).join('');
}

// 生理期以外有沒有記東西（月曆上畫點用）
const hasContent = (r) => !!(r.note || Object.values(r.picks ?? {}).some((v) => (Array.isArray(v) ? v.length : v)));

const setPressed = (btn, on) => btn.setAttribute('aria-pressed', on ? 'true' : 'false');
// 棉棒測試：點圖畫紅圈，點到已有的紅圈就拿掉
const SWAB_R = 10;
let swab = [];
function drawSwab() {
  $('#diary-swab-marks').innerHTML = swab.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${SWAB_R}" fill="rgba(224,49,49,.25)" stroke="#e03131" stroke-width="2.5"/>`).join('');
}
$('#diary-swab').addEventListener('click', (e) => {
  const svg = e.currentTarget;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const x = Math.round(pt.x), y = Math.round(pt.y);
  const hit = swab.findIndex(([sx, sy]) => Math.hypot(sx - x, sy - y) <= SWAB_R + 4);
  if (hit >= 0) swab.splice(hit, 1); else swab.push([x, y]);
  drawSwab();
});

const pressedKeys = (sel) => [...document.querySelectorAll(`${sel} .chip[aria-pressed="true"]`)].map((b) => b.dataset.key);

async function edit(day) {
  const r = rows.get(day) ?? {};
  const p = r.picks ?? {};
  const d = new Date(`${day}T12:00`);
  $('#diary-title').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 週${WEEKDAY[d.getDay()]}`;
  setPressed($('#diary-period'), !!r.period);
  $('#diary-note').value = r.note ?? '';
  $('#diary-pill').value = p.pill_day ?? '';
  $('#diary-pill').closest('label').hidden = day >= PILL_STOP && !p.pill_day;
  $('#diary-foreplay-min').value = p.foreplay_min ?? '';
  $('#diary-lube').value = p.lube ?? '';
  const vaseline = p.vaseline === true ? 'yes' : p.vaseline;
  for (const b of document.querySelectorAll('#diary-daily .chip')) setPressed(b, vaseline === b.dataset.key);
  for (const b of document.querySelectorAll('#diary-foreplay .chip')) setPressed(b, p.foreplay === b.dataset.key);
  for (const b of document.querySelectorAll('#diary-pain .chip')) setPressed(b, !!p.pain?.includes(b.dataset.key));
  swab = (p.swab ?? []).map(([x, y]) => [x, y]);
  drawSwab();

  if (await openDialog($('#diary-dialog')) !== 'ok') return;
  const picks = {};
  const pill = Number($('#diary-pill').value);
  if (pill > 0) picks.pill_day = pill;
  const [vas] = pressedKeys('#diary-daily');
  if (vas) picks.vaseline = vas;
  const [foreplay] = pressedKeys('#diary-foreplay');
  if (foreplay) picks.foreplay = foreplay;
  const min = Number($('#diary-foreplay-min').value);
  if (min > 0) picks.foreplay_min = min;
  const lube = $('#diary-lube').value.trim();
  if (lube) picks.lube = lube;
  const pain = pressedKeys('#diary-pain');
  if (pain.length) picks.pain = pain;
  if (swab.length) picks.swab = swab;
  const row = { day, period: $('#diary-period').getAttribute('aria-pressed') === 'true', picks, note: $('#diary-note').value.trim() || null };
  if (!row.period && !hasContent(row)) {
    if (r.id) { await db.deleteDiary(day); toast('這天清空了'); }
  } else {
    await db.saveDiary(row);
    toast('已記錄');
  }
  show();
}

$('#diary-dialog').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-key]');
  if (!chip) return;
  const on = chip.getAttribute('aria-pressed') === 'true';
  if (['diary-foreplay', 'diary-daily'].includes(chip.parentElement.id)) for (const b of chip.parentElement.querySelectorAll('.chip')) setPressed(b, false); // 有／無前戲、有／沒擦凡士林只能選一個
  if (chip.parentElement.id === 'diary-pain' && !on) { // 「不痛」跟三種痛不能同時選
    for (const b of chip.parentElement.querySelectorAll('.chip')) if ((b.dataset.key === 'none') !== (chip.dataset.key === 'none')) setPressed(b, false);
  }
  setPressed(chip, !on);
});
$('#diary-period').addEventListener('click', (e) => setPressed(e.currentTarget, e.currentTarget.getAttribute('aria-pressed') !== 'true'));

$('#diary-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-day]');
  if (btn) edit(btn.dataset.day);
});
$('#diary-prev').addEventListener('click', () => { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); show(); });
$('#diary-next').addEventListener('click', () => { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); show(); });
$('#diary-today').addEventListener('click', () => { cur = new Date(); show(); });
