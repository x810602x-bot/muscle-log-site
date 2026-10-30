import { $, esc, fmt, numOrNull, toast } from './util.js?v=f62ec67';
import * as db from './db.js?v=f62ec67';
import { NUTRIENTS, autoStandard } from './nutrition.js?v=f62ec67';
import { loadTargets, saveTargets, dailyTargets, perDayOf, perKgOf } from './targets.js?v=f62ec67';

let weight = null;

// 表單上現在填的值 → settings.targets 的格式
const readForm = () => Object.fromEntries(NUTRIENTS.map((n) => [n.log, {
  per_kg: numOrNull($(`#set-targets [data-per-kg="${n.log}"]`).value),
}]));

// 「每公斤」跟「一天多少」填哪一格都行，另一格用最新體重換算；存的只有每公斤
function syncPair(edited) {
  const { perKg, perDay } = edited.dataset;
  if (weight == null || !(perKg ?? perDay)) return;
  const value = numOrNull(edited.value);
  if (perKg) $(`#set-targets [data-per-day="${perKg}"]`).value = value == null ? '' : perDayOf(value, weight);
  else $(`#set-targets [data-per-kg="${perDay}"]`).value = value == null ? '' : perKgOf(value, weight);
}

function renderResults() {
  const targets = dailyTargets(readForm(), weight);
  for (const n of NUTRIENTS) {
    const target = n.target(targets);
    $(`#set-targets [data-result="${n.log}"]`).textContent = target == null ? '—' : `${n.limit ? '上限 ' : ''}${fmt(target, n.digits)} ${n.unit}`;
  }
}

// 「顯示哪些按鈕」取消勾選的分頁（settings.hidden_tabs）：電腦左邊、手機下排都藏起來
export function applyTabs(hidden = []) {
  for (const btn of document.querySelectorAll('#tabs button[data-tab]')) btn.hidden = hidden.includes(btn.dataset.tab);
}

export async function show() {
  const [{ perKg, weight: latest, weighedAt }, settings] = await Promise.all([loadTargets(), db.getSettings()]);
  // 顯示哪些按鈕：照左側／下排的順序，一個分頁一個勾選
  const hidden = settings.hidden_tabs ?? [];
  $('#tabs-picks').innerHTML = [...document.querySelectorAll('#tabs button[data-tab]')].map((btn) =>
    `<label class="check"><input type="checkbox" value="${btn.dataset.tab}"${hidden.includes(btn.dataset.tab) ? '' : ' checked'}>${esc(btn.textContent.trim())}</label>`).join('');
  weight = latest;
  $('#set-weight').textContent = latest != null
    ? `體重自動抓歐姆龍最新一筆：${fmt(latest, 2)} kg（${new Date(weighedAt).toLocaleDateString('zh-TW')} 量的）`
    : '還沒有體重資料：先到「身體」匯入歐姆龍，「每公斤」的項目才算得出來。';
  // 標準值只能看；要照自己的狀況吃就填目標值
  const input = (kind, n, name) => `<td><input data-${kind}="${n.log}" type="number" inputmode="decimal" step="any" min="0" aria-label="${n.label} 目標值（${name}）"${kind === 'per-day' && weight == null ? ' disabled' : ''}></td>`;
  $('#set-targets').innerHTML = `<thead><tr><th>項目</th><th>標準值</th><th>目標值<br><small>每公斤</small></th><th>目標值<br><small>一天多少</small></th><th>今天用的</th></tr></thead><tbody>${
    NUTRIENTS.map((n) => `<tr><th>${n.label} <small>${n.unit}</small></th><td>${fmt(autoStandard(n, weight), n.digits)}</td>
      ${input('per-kg', n, '每公斤')}${input('per-day', n, '一天多少')}<td data-result="${n.log}"></td></tr>`).join('')}</tbody>`;
  for (const n of NUTRIENTS) {
    const input = $(`#set-targets [data-per-kg="${n.log}"]`);
    input.value = perKg[n.log]?.per_kg ?? '';
    syncPair(input);
  }
  renderResults();
}

$('#settings-form').addEventListener('input', (e) => {
  syncPair(e.target);
  renderResults();
});
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveTargets(readForm());
  toast('已儲存');
});

// 至少留一個
$('#tabs-form').addEventListener('input', (e) => {
  if (!$('#tabs-picks input:checked')) e.target.checked = true;
});
$('#tabs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hidden = [...document.querySelectorAll('#tabs-picks input:not(:checked)')].map((b) => b.value);
  await db.saveSettings({ hidden_tabs: hidden });
  applyTabs(hidden);
  toast('已儲存');
});
