import * as db from './db.js?v=d3a5e70';
import { $, esc, localDate, openDialog, toast } from './util.js?v=d3a5e70';
import { diaryText } from './diary-text.js';
import { ENT_FIELDS as FIELDS, entPrefill, entForm, entRow } from './records.js?v=d3a5e70'; // 家裡電腦上的勲助理直接記也用這一份

// 就醫紀錄分頁（2026-11-18 從「耳鼻喉紀錄」改名：不只記耳鼻喉科；程式裡的 ent 是舊名）：每次看診記一筆「這位醫生說了什麼」（診所、醫師、為什麼去、診斷、檢查、藥、對開刀的看法、備註）。
// 用途（2026-10-28 使用者說明）：鼻中膈彎曲＋鼻腔黏膜常紅腫，想開刀，會頻繁看不同醫生，把每位的說法收集起來比較、評估。
// 所以卡片右上角標每位醫生對開刀的立場，清單上面一行小結。
// 開刀相關的只有設定頁勾了「要記醫生對開刀的看法」的帳號才出現（2026-11-18：另一個帳號記婦產科，用不到）。
let logs = [];
let surgeryOn = false; // settings.ent_surgery
let diary = new Map(); // 看診那幾天的日曆：'YYYY-MM-DD' → 那天那一筆（2026-11-18 加：卡片上帶出那天日曆記了什麼，不用重填）
const dayOf = (l) => localDate(new Date(l.logged_at));

// 看診記錄跟「要不要記開刀」一起抓；class="surgery-only" 的（頁面說明後半、記錄框的開刀那格）跟著藏
async function load() {
  const [list, settings] = await Promise.all([db.listEntLogs(), db.getSettings()]);
  logs = list;
  surgeryOn = !!settings.ent_surgery;
  for (const el of document.querySelectorAll('.surgery-only')) el.hidden = !surgeryOn;
  const days = logs.map(dayOf).sort();
  diary = new Map(days.length ? (await db.listDiary(days[0], days.at(-1))).map((r) => [r.day, r]) : []);
}

const SURGERY = { yes: '建議開刀', no: '不建議開刀', wait: '再觀察' };
const dateOf = (t) => localDate(new Date(t));
// 備註裡的網址（例如醫院掛號頁，看診當天點開看地圖）抽出來變成卡片下面可以點的連結；卡片本身是按鈕，連結不能放在裡面
const URL_RE = /https?:\/\/[^\s，。、；）)／]+/g;

export async function show() {
  await load();
  renderSummary();
  renderList();
}

// 幾次看診、幾位醫師（同名算同一位）、各自最新一次對開刀的立場
function renderSummary() {
  if (!logs.length) { $('#ent-summary').textContent = ''; return; }
  const stance = new Map(); // 醫師 → 最新一筆的立場（logs 最新在前，第一次看到的就是最新）
  for (const l of logs) {
    const d = l.details ?? {};
    const who = d.doctor || d.clinic || ''; // 沒填醫師、診所的全部算同一位
    if (!stance.has(who)) stance.set(who, d.surgery || '');
  }
  const counts = Object.keys(SURGERY).map((k) => [SURGERY[k], [...stance.values()].filter((v) => v === k).length]).filter(([, n]) => n);
  const talk = counts.length ? '：' + counts.map(([label, n]) => `${label} ${n}`).join('、') : '，還沒有醫師談到開刀';
  $('#ent-summary').textContent = `看了 ${logs.length} 次、${stance.size} 位醫師${surgeryOn ? talk : ''}`;
}

function renderList() {
  const line = (label, text) => (text ? `<span class="ent-line"><b>${label}</b>${esc(text)}</span>` : '');
  $('#ent-list').innerHTML = logs.length ? logs.map((l) => {
    const d = l.details ?? {};
    const when = new Date(l.logged_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'narrow' });
    const who = [d.clinic, d.doctor].filter(Boolean).join(' · ');
    const urls = l.note?.match(URL_RE) ?? [];
    const note = l.note?.replace(URL_RE, '').trim();
    return `<li><button class="ent-card" data-id="${l.id}">
      <span class="ent-head"><span class="ent-when">${esc(when)}</span>${who ? `<span class="ent-who">${esc(who)}</span>` : ''}${surgeryOn && d.surgery ? `<span class="ent-tag ${d.surgery}">${SURGERY[d.surgery]}</span>` : ''}</span>
      ${line('為什麼去：', d.reason)}
      ${d.diagnosis ? `<span class="ent-say">${esc(d.diagnosis)}</span>` : ''}
      ${line('檢查：', d.exam)}${line('藥／治療：', d.treatment)}${surgeryOn ? line('開刀：', d.surgery_note) : ''}
      ${note ? `<span class="ent-line note">${esc(note)}</span>` : ''}
      ${line('那天日曆：', diaryText(diary.get(dayOf(l))))}
    </button>${urls.map((u) => `<a class="ent-link" href="${esc(u)}" target="_blank" rel="noopener">打開連結 · ${esc(u.replace(/^https?:\/\/([^/?#]+).*$/, '$1'))}</a>`).join('')}</li>`;
  }).join('') : '<li class="empty">還沒有記錄：看完醫生按上面的「記一筆」</li>';
}

async function edit(l) {
  const form = entForm(l, dateOf);
  $('#ent-date').value = form.date;
  for (const f of FIELDS) $(`#ent-${f.replace('_', '-')}`).value = form[f];
  $('#ent-note').value = form.note;
  // 以前填過的診所、醫師當候選
  for (const [f, list] of [['clinic', '#ent-clinic-list'], ['doctor', '#ent-doctor-list']]) {
    const seen = [...new Set(logs.map((x) => x.details?.[f]).filter(Boolean))];
    $(list).innerHTML = seen.map((x) => `<option value="${esc(x)}">`).join('');
  }
  const del = $('#ent-delete');
  del.hidden = !l?.id;
  delete del.dataset.armed;
  del.textContent = '刪除';

  const result = await openDialog($('#ent-dialog'));
  if (result === 'delete') {
    await db.deleteEntLog(l.id);
    toast('已刪除');
    return show();
  }
  if (result !== 'ok') return;
  const typed = { date: $('#ent-date').value, ...Object.fromEntries(FIELDS.map((f) => [f, $(`#ent-${f.replace('_', '-')}`).value])), note: $('#ent-note').value };
  await db.saveEntLog({ id: l?.id, ...entRow(typed) });
  toast('已記錄');
  show();
  return true;
}

// 問 Claude 的助理整理好的看診記錄：帶進同一個框，看過按儲存才存；有存回傳 true。
// 要改哪一筆（代號、同一天同一家診所）、沒提到的欄位留原本的，規則在 records.js 的 entPrefill
export async function openEntEditor(draft) {
  await load();
  return edit(entPrefill(draft, logs, dateOf));
}

// 刪除跟私密紀錄一樣要按兩次：第一次變「再按一次確認刪除」，第二次才真的刪
$('#ent-delete').addEventListener('click', (e) => {
  e.preventDefault();
  const btn = e.currentTarget;
  if (btn.dataset.armed) btn.closest('dialog').close('delete');
  else { btn.dataset.armed = '1'; btn.textContent = '再按一次確認刪除'; }
});

$('#ent-new').addEventListener('click', () => edit(null));
$('#ent-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  const l = btn && logs.find((x) => x.id === btn.dataset.id);
  if (l) edit(l);
});
