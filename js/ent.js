import * as db from './db.js?v=f62ec67';
import { $, esc, localDate, openDialog, toast } from './util.js?v=f62ec67';

// 耳鼻喉紀錄分頁：每次看診記一筆「這位醫生說了什麼」（診所、醫師、為什麼去、診斷、檢查、藥、對開刀的看法、備註）。
// 用途（2026-10-28 使用者說明）：鼻中膈彎曲＋鼻腔黏膜常紅腫，想開刀，會頻繁看不同醫生，把每位的說法收集起來比較、評估。
// 所以卡片右上角標每位醫生對開刀的立場，清單上面一行小結。
let logs = [];

const SURGERY = { yes: '建議開刀', no: '不建議開刀', wait: '再觀察' };
const FIELDS = ['clinic', 'doctor', 'reason', 'diagnosis', 'exam', 'treatment', 'surgery', 'surgery_note'];

export async function show() {
  logs = await db.listEntLogs();
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
  $('#ent-summary').textContent = `看了 ${logs.length} 次、${stance.size} 位醫師${counts.length ? '：' + counts.map(([label, n]) => `${label} ${n}`).join('、') : '，還沒有醫師談到開刀'}`;
}

function renderList() {
  const line = (label, text) => (text ? `<span class="ent-line"><b>${label}</b>${esc(text)}</span>` : '');
  $('#ent-list').innerHTML = logs.length ? logs.map((l) => {
    const d = l.details ?? {};
    const when = new Date(l.logged_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'narrow' });
    const who = [d.clinic, d.doctor].filter(Boolean).join(' · ');
    return `<li><button class="ent-card" data-id="${l.id}">
      <span class="ent-head"><span class="ent-when">${esc(when)}</span>${who ? `<span class="ent-who">${esc(who)}</span>` : ''}${d.surgery ? `<span class="ent-tag ${d.surgery}">${SURGERY[d.surgery]}</span>` : ''}</span>
      ${line('為什麼去：', d.reason)}
      ${d.diagnosis ? `<span class="ent-say">${esc(d.diagnosis)}</span>` : ''}
      ${line('檢查：', d.exam)}${line('藥／治療：', d.treatment)}${line('開刀：', d.surgery_note)}
      ${l.note ? `<span class="ent-line note">${esc(l.note)}</span>` : ''}
    </button></li>`;
  }).join('') : '<li class="empty">還沒有記錄：看完醫生按上面的「記一筆」</li>';
}

async function edit(l) {
  const d = l?.details ?? {};
  $('#ent-date').value = l ? localDate(new Date(l.logged_at)) : localDate();
  for (const f of FIELDS) $(`#ent-${f.replace('_', '-')}`).value = d[f] ?? '';
  $('#ent-note').value = l?.note ?? '';
  // 以前填過的診所、醫師當候選
  for (const [f, list] of [['clinic', '#ent-clinic-list'], ['doctor', '#ent-doctor-list']]) {
    const seen = [...new Set(logs.map((x) => x.details?.[f]).filter(Boolean))];
    $(list).innerHTML = seen.map((x) => `<option value="${esc(x)}">`).join('');
  }
  const del = $('#ent-delete');
  del.hidden = !l;
  delete del.dataset.armed;
  del.textContent = '刪除';

  const result = await openDialog($('#ent-dialog'));
  if (result === 'delete') {
    await db.deleteEntLog(l.id);
    toast('已刪除');
    return show();
  }
  if (result !== 'ok') return;
  const details = Object.fromEntries(FIELDS.map((f) => [f, $(`#ent-${f.replace('_', '-')}`).value.trim() || null]));
  await db.saveEntLog({
    id: l?.id, logged_at: new Date(`${$('#ent-date').value}T12:00`).toISOString(),
    severity: null, details, note: $('#ent-note').value.trim() || null,
  });
  toast('已記錄');
  show();
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
