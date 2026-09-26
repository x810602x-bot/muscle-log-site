import * as db from './db.js?v=087c7e0';
import { $, fmt, numOrNull, dailyTargets, autoStandard, toast, NUTRIENTS } from './util.js?v=087c7e0';

let weight = null;

// 表單上現在填的值 → settings.targets 的格式
const readForm = () => Object.fromEntries(NUTRIENTS.map((n) => [n.log, {
  per_kg: numOrNull($(`#set-targets [data-per-kg="${n.log}"]`).value),
}]));

// 「每公斤」跟「一天多少」填哪一格都行，另一格用最新體重換算；存的只有每公斤
const round = (value, digits) => +value.toFixed(digits);
function syncPair(edited) {
  const { perKg, perDay } = edited.dataset;
  if (weight == null || !(perKg ?? perDay)) return;
  const value = numOrNull(edited.value);
  if (perKg) $(`#set-targets [data-per-day="${perKg}"]`).value = value == null ? '' : round(value * weight, 1);
  else $(`#set-targets [data-per-kg="${perDay}"]`).value = value == null ? '' : round(value / weight, 4);
}

function renderResults() {
  const targets = dailyTargets({ targets: readForm() }, weight);
  for (const n of NUTRIENTS) {
    const target = targets[n.log];
    $(`#set-targets [data-result="${n.log}"]`).textContent = target == null ? '—' : `${n.limit ? '上限 ' : ''}${fmt(target, n.digits)} ${n.unit}`;
  }
}

export async function show() {
  const [settings, latest] = await Promise.all([db.getSettings(), db.latestWeight()]);
  weight = latest?.weight ?? null;
  $('#set-weight').textContent = latest
    ? `體重自動抓歐姆龍最新一筆：${fmt(latest.weight, 2)} kg（${new Date(latest.measured_at).toLocaleDateString('zh-TW')} 量的）`
    : '還沒有體重資料：先到「身體」匯入歐姆龍，「每公斤」的項目才算得出來。';
  // 標準值只能看；要照自己的狀況吃就填目標值
  const input = (kind, n, name) => `<td><input data-${kind}="${n.log}" type="number" inputmode="decimal" step="any" min="0" aria-label="${n.label} 目標值（${name}）"${kind === 'per-day' && weight == null ? ' disabled' : ''}></td>`;
  $('#set-targets').innerHTML = `<thead><tr><th>項目</th><th>標準值</th><th>目標值<br><small>每公斤</small></th><th>目標值<br><small>一天多少</small></th><th>今天用的</th></tr></thead><tbody>${
    NUTRIENTS.map((n) => `<tr><th>${n.label} <small>${n.unit}</small></th><td>${fmt(autoStandard(n, weight), n.digits)}</td>
      ${input('per-kg', n, '每公斤')}${input('per-day', n, '一天多少')}<td data-result="${n.log}"></td></tr>`).join('')}</tbody>`;
  for (const n of NUTRIENTS) {
    const perKg = $(`#set-targets [data-per-kg="${n.log}"]`);
    perKg.value = settings.targets?.[n.log]?.per_kg ?? '';
    syncPair(perKg);
  }
  renderResults();
}

$('#settings-form').addEventListener('input', (e) => {
  syncPair(e.target);
  renderResults();
});
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await db.saveSettings({ targets: readForm() });
  toast('已儲存');
});
