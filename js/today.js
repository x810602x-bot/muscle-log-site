import * as db from './db.js?v=94d1c11';
import { $, esc, fmt, numOrNull, localDate, addDays, isPending, dailyTargets, openDialog, toast, nutrientCells, NUTRIENTS, SHOWN_NUTRIENTS, MICROS, TOTAL_ITEMS, withStarch } from './util.js?v=94d1c11';
import { openFoodEditor, per100, comboAmounts } from './foods.js?v=94d1c11';
import { recordRow } from './body.js?v=94d1c11';

const QUICK_COUNT = 8;
const MEAL_GAP_MS = 30 * 60 * 1000;
const NOTE_MIN_HEIGHT = 140; // 電腦版右欄最下面的「當日備註」至少要留這麼高
const desktop = matchMedia('(min-width: 900px)');

let date = localDate();
let foods = [];    // 沒封存的，拿來選
let allFoods = []; // 含封存的，組合裡可能還用得到
let combos = [];
let logs = [];
let targets = {};
let usage = new Map(); // food_id → { count, last, qty }：最近 30 天吃幾次、最後一次哪天、上次吃多少

export async function show() {
  const [foodRows, comboRows, logRows, recent, settings, latest, note, bodyRows] = await Promise.all([
    db.listFoods(), db.listCombos(), db.listLogs(date), db.recentLogs(addDays(localDate(), -30)), db.getSettings(), db.latestWeight(), db.getDayNote(date), db.bodyRecordsOn(date),
  ]);
  $('#day-note').value = note;
  $('#day-body-block').hidden = !bodyRows.length;
  $('#day-body').innerHTML = bodyRows.map((r) => recordRow(r)).join('');
  allFoods = foodRows;
  foods = foodRows.filter((f) => !f.archived);
  combos = comboRows.filter((c) => !c.archived && c.yield_qty == null); // 食譜不在這裡，記錄時點它自動建的那個食物
  logs = logRows.map(withStarch);
  targets = dailyTargets(settings, latest?.weight);
  usage = new Map();
  for (const { food_id, log_date, qty } of recent) {
    const u = usage.get(food_id) ?? { count: 0, last: '', qty };
    u.count += 1;
    if (log_date >= u.last) Object.assign(u, { last: log_date, qty });
    usage.set(food_id, u);
  }
  render();
}

function render() {
  renderDay();
  renderTotals();
  renderLogs();
  renderPicker();
}

function renderDay() {
  const d = new Date(`${date}T00:00`);
  const text = d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
  $('#day-label').textContent = date === localDate() ? `今天 · ${text}` : text;
  $('#day-input').value = date;
}

// 距離每日標準還差多少；「上限」類的項目改說還剩多少
// 顏色：綠＝吃越多越好（至少吃到標準）、紅＝吃越少越好（標準是上限）、灰＝盡量接近標準
function gapNote(item, value) {
  const target = item.key ? item.rda : targets[item.log];
  if (target == null) return '';
  const gap = target - (value ?? 0);
  const amount = fmt(Math.abs(gap), item.digits);
  if (item.limit) return `<p class="gap less${gap < 0 ? ' over' : ''}">${gap >= 0 ? `上限內，還剩 ${amount}` : `超過上限 ${amount}`}</p>`;
  if (item.near) return `<p class="gap">${gap > 0 ? `還差 ${amount}` : gap < 0 ? `超過 ${amount}` : '剛好'}</p>`;
  return `<p class="gap more">${gap > 0 ? `還差 ${amount}` : '已達標'}</p>`;
}

function renderTotals() {
  // 巨量營養（log 欄位）跟維生素礦物質（micros 裡的 key）排在同一塊
  const amountOf = (item, l) => (item.key ? l.micros?.[item.key] : l[item.log]);
  $('#totals').innerHTML = nutrientCells(TOTAL_ITEMS, (item) => {
    const filled = logs.filter((l) => amountOf(item, l) != null);
    return filled.length ? filled.reduce((sum, l) => sum + Number(amountOf(item, l)), 0) : null;
  }, gapNote);
  const missing = logs.filter((l) => NUTRIENTS.some((n) => l[n.log] == null)).length;
  $('#totals-missing').hidden = !missing;
  $('#totals-missing').textContent = `有 ${missing} 筆的食物還沒填完整營養，總計會偏低。維生素、礦物質多半是估計值，看個大概就好。`;
}

// 同一個時間記的幾筆，如果都是某個組合裡的食物（至少 2 樣），就當成是用那個組合記的，收成一組顯示。
// 記錄本身沒有存「來自哪個組合」，是用時間＋內容對出來的；對不到就照一般的一筆一筆列。
function comboOf(group) {
  if (group.length < 2) return null;
  return combos
    .filter((c) => group.every((l) => c.items.some((item) => item.food_id === l.food_id)))
    .sort((a, b) => a.items.length - b.items.length)[0] ?? null;
}

// 一餐一張卡片：跟前一筆隔不到 30 分鐘的算同一餐。標題寫時間、用了哪些組合、這餐的熱量跟蛋白質；
// 裡面每樣只寫吃多少，營養細節點進去（數量框）才看
function renderLogs() {
  const meals = [];
  for (const l of logs) {
    const last = meals.at(-1);
    if (last && new Date(l.created_at) - new Date(last.at(-1).created_at) <= MEAL_GAP_MS) last.push(l); else meals.push([l]);
  }
  const sum = (meal, column) => meal.reduce((total, l) => total + Number(l[column] ?? 0), 0);
  $('#log-list').innerHTML = meals.map((meal) => {
    const times = [...new Set(meal.map((l) => l.created_at))];
    const comboNames = [...new Set(times.map((time) => comboOf(meal.filter((l) => l.created_at === time))?.name).filter(Boolean))];
    return `<li class="log-group">
        <p class="log-group-head"><b>${timeOf(meal[0])}</b> ${comboNames.map((name) => `${esc(name)} · `).join('')}${energyText(sum(meal, 'kcal'), sum(meal, 'protein_g'))}</p>
        <ul class="list">${meal.map(logRowHtml).join('')}</ul>
      </li>`;
  }).join('') || '<li class="empty">還沒記錄，從常吃的食物點一個開始</li>';
}

// 這一頁所有小卡的小灰字都只寫熱量跟蛋白質；其他營養點進去（數量框）看
const energyText = (kcal, protein) => `熱量 ${fmt(kcal, 0)} kcal · 蛋白質 ${fmt(protein)} g`;

function logRowHtml(l) {
  return `<li><button class="row meal-row" data-log="${l.id}">
      <span class="row-main">
        <span class="row-title">${esc(l.foods.name)}</span>
        <span class="row-sub">${energyText(l.kcal, l.protein_g)}</span>
      </span>
      <span class="meal-qty">${fmt(l.qty, 2)} ${esc(l.foods.log_unit ?? '')}</span>
    </button></li>`;
}

function renderPicker() {
  const q = $('#food-search').value.trim();
  const ranked = [...foods].sort((a, b) => {
    const ua = usage.get(a.id), ub = usage.get(b.id);
    return (ub?.count ?? 0) - (ua?.count ?? 0) || (ub?.last ?? '').localeCompare(ua?.last ?? '') || a.name.localeCompare(b.name, 'zh-Hant');
  });
  const matches = (item) => item.name.toLowerCase().includes(q.toLowerCase());
  const shownCombos = q ? combos.filter(matches) : combos;
  const shown = q ? ranked.filter(matches) : ranked.slice(0, QUICK_COUNT);
  const comboText = (c) => {
    const total = comboAmounts(c.items, allFoods);
    return energyText(total.kcal, total.protein_g);
  };
  // g、ml 的寫每 100 的量（跟營養標示一樣），其餘寫每 1 單位
  const foodText = (f) => {
    const per = per100(f.log_unit) ? 100 : 1;
    const basis = per === 100 ? `每 100${esc(f.log_unit)}` : `每${esc(f.log_unit)}`;
    return `${basis} · ${energyText(f.kcal_per_unit == null ? null : f.kcal_per_unit * per, f.protein_per_unit * per)}`;
  };
  $('#quick-grid').innerHTML = shownCombos.map((c) => `<button class="tile" data-combo="${c.id}">
      <span class="tile-name">${esc(c.name)}</span>
      <span class="tile-sub"><span class="badge combo">組合</span> ${comboText(c)}</span>
    </button>`).join('')
    + shown.map((f) => `<button class="tile" data-food="${f.id}">
      <span class="tile-name">${esc(f.name)}</span>
      <span class="tile-sub">${isPending(f) ? '<span class="badge">待補</span>' : foodText(f)}</span>
    </button>`).join('')
    + `<button class="tile tile-new" data-new>${q ? `＋ 新增「${esc(q)}」` : '＋ 新增食物'}</button>`;
  if (!q) fitPicker();
}

// 電腦版：右邊（選食物＋備註）不能比左邊（測量＋總共）高。從排最後面的食物開始拿掉，拿到不超過為止，
// 再湊成雙數讓最後一排是滿的；剩下的空隙 CSS 會讓備註框撐滿。組合跟「＋ 新增食物」不拿掉。搜尋中不限制。
function fitPicker() {
  const leftHeight = $('.col-result').offsetHeight;
  if (!desktop.matches || !leftHeight) return;
  const grid = $('#quick-grid');
  const lastFood = () => [...grid.querySelectorAll('[data-food]')].at(-1);
  while (lastFood() && $('.picker').offsetHeight + NOTE_MIN_HEIGHT > leftHeight) lastFood().remove();
  if (grid.children.length % 2) lastFood()?.remove();
}

// 每 1 單位的量 × 數量 → 要存進記錄的快照欄位
const round2 = (n) => Math.round(n * 100) / 100;
const scaleMicros = (micros, factor) =>
  Object.fromEntries(Object.entries(micros ?? {}).map(([key, value]) => [key, Math.round(value * factor * 1000) / 1000]));
// 每筆記錄的 created_at 當作「什麼時候吃的」（可以在數量框改）：同一樣東西一天分幾次吃才分得開，清單也照這個時間排
const timeOf = (log) => new Date(log.created_at).toTimeString().slice(0, 5);
const atTime = (time) => new Date(`${date}T${time}`).toISOString();
// 食物現在的資料 → { 快照欄位: 每 1 單位的量 }
const perUnitOf = (food) => ({ cost: food.cost_per_unit, ...Object.fromEntries(NUTRIENTS.map((n) => [n.log, food[n.food]])) });
// 一種食物吃 qty 個單位 → 一筆記錄
function logRow(food, qty, time) {
  return { log_date: date, food_id: food.id, qty, created_at: atTime(time), ...scaled(perUnitOf(food), qty), micros: scaleMicros(food.micros, qty) };
}
const scaled = (perUnit, qty) =>
  Object.fromEntries(Object.entries(perUnit).map(([column, value]) => [column, value == null ? null : round2(value * qty)]));

// 數量框下面的「完整營養」：熱量、蛋白質一定列；其他是 0 或沒資料的就不列（例如雞蛋沒有膳食纖維）
const INFO_ITEMS = [...SHOWN_NUTRIENTS, ...MICROS];
const ALWAYS_SHOWN = ['kcal', 'protein_g'];
const worthShowing = (item, value) => ALWAYS_SHOWN.includes(item.log) || Number((value ?? 0).toFixed(item.digits)) > 0;

// 數量輸入框；perUnit = { 快照欄位: 每 1 單位的量 }、micros = 每 1 單位的維生素礦物質。
// 回傳 { action: 'ok' | 'delete' | 'cancel', qty, time, food, perUnit, micros }
// time = 什麼時候吃的（HH:mm）；新增時預設現在，編輯時是那一筆原本的時間
// items = 組合才有：[{ food, qty }]。每樣可以自己填這次的量，沒填就用預設（組合裡的量 × 幾份，灰字顯示）；回傳多一個 amounts
// food = 單一食物才有：框裡多一顆「食物資料」，開的是食物庫同一個編輯框；改完存檔，這個框的數字（跟回傳的 food／perUnit／micros）就換成新資料
async function askQty({ title, unit, qty, perUnit, micros, editing, time, items, food }) {
  const input = $('#qty-input');
  const box = $('#qty-items');
  const itemInput = (i) => box.querySelector(`[data-item="${i}"]`);
  const amountsNow = () => (items ?? []).map((item, i) => numOrNull(itemInput(i).value) ?? round2(item.qty * (Number(input.value) || 0)));
  const preview = () => {
    const servings = Number(input.value) || 0;
    (items ?? []).forEach((item, i) => { itemInput(i).placeholder = round2(item.qty * servings); });
    const amounts = items
      ? comboAmounts(amountsNow().map((amount, i) => ({ food_id: items[i].food.id, qty: amount })), allFoods)
      : withStarch(scaled(perUnit, servings));
    const microAmounts = {};
    const eaten = items ? amountsNow().map((amount, i) => [items[i].food.micros, amount]) : [[micros, servings]];
    for (const [perOne, amount] of eaten) {
      for (const [key, value] of Object.entries(scaleMicros(perOne, amount))) microAmounts[key] = (microAmounts[key] ?? 0) + value;
    }
    const valueOf = (item) => (item.key ? microAmounts[item.key] : amounts[item.log]);
    $('#qty-preview').innerHTML = nutrientCells(INFO_ITEMS.filter((item) => worthShowing(item, valueOf(item))), valueOf);
  };
  box.hidden = !items;
  box.innerHTML = !items ? '' : items.map((item, i) => `<div class="combo-item">
      <span class="combo-item-name">${esc(item.food.name)}</span>
      <input data-item="${i}" type="number" inputmode="decimal" step="any" min="0" aria-label="${esc(item.food.name)} 這次的量">
      <span class="combo-item-unit">${esc(item.food.log_unit)}</span>
    </div>`).join('') + '<p class="hint">這次的量有秤就填；沒填的用灰字的預設量。</p>';
  box.oninput = preview;
  $('#qty-name').textContent = title;
  $('#qty-unit').textContent = unit;
  $('#qty-ok').textContent = editing ? '更新' : '加入';
  $('#qty-delete').hidden = !editing;
  $('#qty-food').hidden = !food;
  $('#qty-food').onclick = async () => {
    const saved = await openFoodEditor(food);
    if (!saved) return;
    food = saved;
    if (saved.archived || isPending(saved)) return $('#qty-dialog').close('cancel'); // 封存了、或改成待補，就不能記了
    perUnit = perUnitOf(saved);
    micros = saved.micros;
    $('#qty-name').textContent = saved.name;
    $('#qty-unit').textContent = saved.log_unit;
    preview();
  };
  input.value = qty ?? '';
  $('#qty-time').value = time ?? new Date().toTimeString().slice(0, 5);
  input.oninput = preview;
  preview();
  const pending = openDialog($('#qty-dialog'));
  input.select();
  return { action: await pending, qty: Number(input.value), time: $('#qty-time').value, amounts: amountsNow(), food, perUnit, micros };
}

async function logFood(food) {
  if (isPending(food)) {
    food = await openFoodEditor(food, { why: true });
    if (!food) return;
    if (isPending(food)) return show();
  }
  const asked = await askQty({ title: food.name, unit: food.log_unit, qty: usage.get(food.id)?.qty, perUnit: perUnitOf(food), micros: food.micros, food });
  if (asked.action === 'ok' && asked.qty > 0) {
    await db.addLog(logRow(asked.food, asked.qty, asked.time));
    $('#food-search').value = '';
  }
  await show();
}

// 記一整個組合：問「幾份」，每樣也可以自己填這次的量；裡面每樣食物各存一筆（之後可以單獨改某一樣）
async function logCombo(combo) {
  const items = combo.items
    .map((item) => ({ food: allFoods.find((f) => f.id === item.food_id), qty: item.qty }))
    .filter(({ food }) => food && !isPending(food));
  const { action, qty, time, amounts } = await askQty({ title: combo.name, unit: '份', qty: 1, items });
  if (action === 'ok' && qty > 0) {
    await db.addLog(items
      .map(({ food }, i) => [food, amounts[i]])
      .filter(([, amount]) => amount > 0)
      .map(([food, amount]) => logRow(food, amount, time)));
    $('#food-search').value = '';
  }
  await show();
}

// 改數量時沿用當初記錄的快照比例，不看食物現在的資料。
// 例外：在框裡按「食物資料」改了食物 → 按「更新」這一筆就用新資料重算（按取消這一筆不動）；其他天的記錄一律不受影響
async function editLog(log) {
  const perUnit = {};
  for (const column of ['cost', ...NUTRIENTS.map((n) => n.log)]) perUnit[column] = log[column] == null ? null : log[column] / log.qty;
  const micros = Object.fromEntries(Object.entries(log.micros ?? {}).map(([key, value]) => [key, value / log.qty]));
  const food = allFoods.find((f) => f.id === log.food_id);
  const asked = await askQty({ title: log.foods.name, unit: log.foods.log_unit, qty: log.qty, perUnit, micros, editing: true, time: timeOf(log), food });
  if (asked.action === 'delete') await db.deleteLog(log.id);
  else if (asked.action === 'ok' && asked.qty > 0) await db.updateLog(log.id, { qty: asked.qty, created_at: atTime(asked.time), ...scaled(asked.perUnit, asked.qty), micros: scaleMicros(asked.micros, asked.qty) });
  else if (asked.food === food) return;
  await show();
}

// 給歷史頁用：跳到今天頁並顯示指定的那一天
export function openDate(newDate) {
  date = newDate;
  location.hash = '#today';
}

function goto(newDate) {
  if (!newDate) return;
  date = newDate;
  show();
}
$('#day-prev').addEventListener('click', () => goto(addDays(date, -1)));
$('#day-next').addEventListener('click', () => goto(addDays(date, 1)));
$('#day-label').addEventListener('click', () => $('#day-input').showPicker());
$('#day-input').addEventListener('change', (e) => goto(e.target.value));
$('#food-search').addEventListener('input', renderPicker);
window.addEventListener('resize', renderPicker); // 視窗寬度變了左邊的高度會跟著變，食物格要重新算
$('#totals-help').addEventListener('click', () => $('#help-dialog').showModal());
$('#day-note').addEventListener('change', async (e) => {
  await db.saveDayNote(date, e.target.value.trim());
  toast('備註已存');
});

$('#quick-grid').addEventListener('click', async (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  if ('new' in tile.dataset) {
    const food = await openFoodEditor({ name: $('#food-search').value.trim() });
    if (food && !isPending(food)) await logFood(food);
    else if (food) await show();
  } else if (tile.dataset.combo) {
    await logCombo(combos.find((c) => c.id === tile.dataset.combo));
  } else {
    await logFood(foods.find((f) => f.id === tile.dataset.food));
  }
});
$('#log-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-log]');
  if (row) editLog(logs.find((l) => l.id === row.dataset.log));
});
