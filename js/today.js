import * as db from './db.js?v=087c7e0';
import { $, esc, fmt, numOrNull, localDate, addDays, isPending, dailyTargets, openDialog, toast, nutrientCells, rowHtml, comboBadge, energyText, NUTRIENTS, SHOWN_NUTRIENTS, MICROS, TOTAL_ITEMS, withStarch } from './util.js?v=087c7e0';
import { openFoodEditor, per100, comboAmounts } from './foods.js?v=087c7e0';
import { recordRow } from './body.js?v=087c7e0';

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

// 每一格下面的小字：上面寫建議值（吃越多越好＝以上、上限＝以內、接近就好＝上下），下面一律寫「剩」多少／「超」多少
// 顏色：綠＝吃越多越好（至少吃到標準）、紅＝吃越少越好（標準是上限）、灰＝盡量接近標準
function gapNote(item, value) {
  const target = item.key ? item.rda : targets[item.log];
  if (target == null) return '';
  const gap = target - (value ?? 0);
  const amount = fmt(Math.abs(gap), item.digits);
  const cls = item.limit ? `gap less${gap < 0 ? ' over' : ''}` : item.near ? 'gap' : 'gap more';
  const range = item.limit ? '以內' : item.near ? '上下' : '以上';
  const left = gap > 0 ? `剩 ${amount}` : gap < 0 ? `超 ${amount}` : '剛好';
  return `<p class="${cls}">建議 ${fmt(target, item.digits)} ${range}<br>${left}</p>`;
}

// 巨量營養（log 欄位）跟維生素礦物質（micros 裡的 key）排在同一塊
const amountOf = (item, l) => (item.key ? l.micros?.[item.key] : l[item.log]);

const totalOf = (item) => {
  const filled = logs.filter((l) => amountOf(item, l) != null);
  return filled.length ? filled.reduce((sum, l) => sum + Number(amountOf(item, l)), 0) : null;
};

// 做到了（該吃的吃到建議值、上限類還在建議值以內）大字就變綠；「上下」類（熱量、脂肪、碳水）不算
const reached = (item, value) => {
  const target = item.key ? item.rda : targets[item.log];
  if (target == null || value == null || item.near) return false;
  return item.limit ? value <= target : value >= target;
};

function renderTotals() {
  hidePop();
  $('#totals').innerHTML = nutrientCells(TOTAL_ITEMS, totalOf, gapNote);
  [...$('#totals').children].forEach((cell, i) => {
    cell.dataset.item = i; // 滑過／按住要認得是哪一項
    cell.classList.toggle('hit', reached(TOTAL_ITEMS[i], totalOf(TOTAL_ITEMS[i])));
  });
  const missing = logs.filter((l) => NUTRIENTS.some((n) => l[n.log] == null)).length;
  $('#totals-missing').hidden = !missing;
  $('#totals-missing').textContent = `有 ${missing} 筆的食物還沒填完整營養，總計會偏低。維生素、礦物質多半是估計值，看個大概就好。`;
}

// 「今天總共」某一格：滑鼠滑過、手指按住 → 跳出這項是從今天哪些食物來的（同一樣食物吃好幾次會併成一筆）
const HOLD_MS = 350;
const MOVE_TOLERANCE = 10;
let hovered = null, holdTimer, holdFrom;

function showPop(cell) {
  const item = TOTAL_ITEMS[cell.dataset.item];
  const sums = new Map();
  for (const l of logs) {
    const amount = amountOf(item, l);
    if (amount == null) continue;
    sums.set(l.foods.name, (sums.get(l.foods.name) ?? 0) + Number(amount));
  }
  const rows = [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, v]) => sum + v, 0);
  const pop = $('#totals-pop');
  pop.innerHTML = `<b>${item.label} 從哪裡來</b>` + (rows.length
    ? rows.map(([name, v]) => `<p class="pop-row"><span>${esc(name)}</span><span>${fmt(v, item.digits)} ${item.unit} · ${Math.round((v / total) * 100)}%</span></p>`).join('')
    : '<p class="pop-row">今天記的食物都沒有這一項的資料</p>');
  pop.hidden = false;
  // 預設貼在格子下面，下面放不下就改放上面；左右不要超出畫面
  pop.style.left = pop.style.top = '0px'; // 先歸位再量，才不會被上一次的位置影響
  const box = cell.getBoundingClientRect();
  const size = pop.getBoundingClientRect();
  const below = box.bottom + 8;
  pop.style.left = `${Math.min(Math.max(8, box.left + box.width / 2 - size.width / 2), innerWidth - size.width - 8)}px`;
  pop.style.top = `${below + size.height > innerHeight - 8 ? Math.max(8, box.top - size.height - 8) : below}px`;
}

function hidePop() {
  clearTimeout(holdTimer);
  hovered = null;
  holdFrom = null;
  $('#totals-pop').hidden = true;
}

// 用組合記的那幾筆會帶著 combo_id（2026-09-20 加）。以前是用「時間一樣＋內容都在某個組合裡」猜的，
// 但時間只記整點／半點之後，那個時段裡記的別的東西也會是同一個時間，猜法就會對不起來。
// 同一個組合＋同一個時間＝一條；其餘一筆一筆列。
function groupsOf(meal) {
  const groups = [];
  const byKey = new Map();
  for (const l of meal) {
    const combo = l.combo_id ? combos.find((c) => c.id === l.combo_id) : null;
    if (!combo) { groups.push({ group: [l], combo: null }); continue; }
    const key = `${l.combo_id}|${l.created_at}`;
    const found = byKey.get(key);
    if (found) found.group.push(l);
    else { const g = { group: [l], combo, key }; byKey.set(key, g); groups.push(g); }
  }
  return groups;
}

// 一餐一張卡片：跟前一筆隔不到 30 分鐘的算同一餐。標題寫時間、用了哪些組合、這餐的熱量跟蛋白質；
// 裡面每樣只寫吃多少，營養細節點進去（數量框）才看
function renderLogs() {
  const meals = [];
  for (const l of logs) {
    const last = meals.at(-1);
    if (last && new Date(l.created_at) - new Date(last.at(-1).created_at) <= MEAL_GAP_MS) last.push(l); else meals.push([l]);
  }
  $('#log-list').innerHTML = meals.map((meal) => {
    const groups = groupsOf(meal);
    const comboNames = [...new Set(groups.map(({ combo }) => combo?.name).filter(Boolean))];
    const rows = groups.map(({ group, combo, key }) => (combo ? comboRowHtml(combo, group, key) : group.map(logRowHtml).join('')));
    return `<li class="log-group">
        <p class="log-group-head"><b>${timeOf(meal[0])}</b> ${comboNames.map((name) => `${esc(name)} · `).join('')}${energyText(sumOf(meal, 'kcal'), sumOf(meal, 'protein_g'))}</p>
        <ul class="list">${rows.join('')}</ul>
      </li>`;
  }).join('') || '<li class="empty">還沒記錄，從常吃的食物點一個開始</li>';
}

const sumOf = (rows, column) => rows.reduce((total, l) => total + Number(l[column] ?? 0), 0);
// 同一分鐘記了兩次以上同一個組合的話，同一樣食物會有好幾筆 → 併成一樣，量加起來
const byFood = (group) => [...new Map(group.map((l) => [l.food_id, group.filter((r) => r.food_id === l.food_id)])).values()];

function logRowHtml(l) {
  return rowHtml({
    cls: 'meal-row',
    attrs: `data-log="${l.id}"`,
    title: esc(l.foods.name),
    sub: energyText(l.kcal, l.protein_g),
    side: `<span class="meal-qty">${fmt(l.qty, 2)} ${esc(l.foods.log_unit ?? '')}</span>`,
  });
}

// 用組合記的那幾筆收成一條：名稱＋藍色組合，灰字列出每樣這次吃多少，最後接這組的熱量與蛋白質
function comboRowHtml(combo, group, key) {
  const parts = byFood(group).map((rows) => `${esc(rows[0].foods.name)} ${fmt(sumOf(rows, 'qty'), 2)} ${esc(rows[0].foods.log_unit ?? '')}`);
  return rowHtml({
    cls: 'meal-row',
    attrs: `data-combo-log="${esc(key)}"`,
    title: `${esc(combo.name)} ${comboBadge}`,
    sub: `${parts.join(' · ')} · ${energyText(sumOf(group, 'kcal'), sumOf(group, 'protein_g'))}`,
    side: `<span class="meal-qty">${parts.length} 樣</span>`,
  });
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
      <span class="tile-sub">${comboBadge} ${comboText(c)}</span>
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
// 記錄時間只留整點跟半點（四捨五入到最近的半小時，最晚 23:30）：同半小時記的東西會是同一個時間，自然算同一批
const snapTime = (time) => {
  const [h, m] = time.split(':').map(Number);
  const mins = Math.min(Math.round((h * 60 + m) / 30) * 30, 23 * 60 + 30);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};
const atTime = (time) => new Date(`${date}T${snapTime(time)}`).toISOString();
// 時間欄只給選整點跟半點（type="time" 的 step 擋不掉，瀏覽器還是列 1 分 2 分）
$('#qty-time').innerHTML = Array.from({ length: 48 }, (_, i) => {
  const t = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  return `<option value="${t}">${t}</option>`;
}).join('');
// 食物現在的資料 → { 快照欄位: 每 1 單位的量 }
const perUnitOf = (food) => ({ cost: food.cost_per_unit, ...Object.fromEntries(NUTRIENTS.map((n) => [n.log, food[n.food]])) });
// 一種食物吃 qty 個單位 → 一筆記錄
function logRow(food, qty, time, comboId = null) {
  return { log_date: date, food_id: food.id, qty, created_at: atTime(time), combo_id: comboId, ...scaled(perUnitOf(food), qty), micros: scaleMicros(food.micros, qty) };
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
// filled = 改已經記的組合才有：每樣先填上這次實際記到的量
// food = 單一食物才有：框裡多一顆「食物資料」，開的是食物庫同一個編輯框；改完存檔，這個框的數字（跟回傳的 food／perUnit／micros）就換成新資料
async function askQty({ title, unit, qty, perUnit, micros, editing, time, items, filled, food }) {
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
      <input data-item="${i}" type="number" inputmode="decimal" step="any" min="0" value="${filled?.[i] ?? ''}" aria-label="${esc(item.food.name)} 這次的量">
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
  $('#qty-time').value = snapTime(time ?? new Date().toTimeString().slice(0, 5));
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
      .map(([food, amount]) => logRow(food, amount, time, combo.id)));
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

// 已經記的那條組合：開跟記錄時同一個框（幾份、時間、每樣的量，都先填好這次的值）。
// 按更新＝整組一起改（每樣用食物現在的資料重算，跟框裡預覽的數字一致，量填 0 就刪掉那一樣）；按刪除＝整組刪掉
async function editComboLogs(combo, group) {
  const items = combo.items
    .map((item) => ({ food: allFoods.find((f) => f.id === item.food_id), qty: item.qty, rows: group.filter((l) => l.food_id === item.food_id) }))
    .filter(({ food }) => food && !isPending(food));
  // 每樣都剛好是「組合裡的量 × n」才回推得出幾份，對不齊就當 1 份
  const servings = [...new Set(items.map(({ qty, rows }) => round2(sumOf(rows, 'qty') / qty)))];
  const asked = await askQty({
    title: combo.name, unit: '份', qty: servings.length === 1 ? servings[0] : 1,
    items, filled: items.map(({ rows }) => (rows.length ? round2(sumOf(rows, 'qty')) : '')), editing: true, time: timeOf(group[0]),
  });
  if (asked.action === 'delete') {
    for (const l of group) await db.deleteLog(l.id);
  } else if (asked.action === 'ok' && asked.qty > 0) {
    const added = [];
    for (const [i, { food, rows }] of items.entries()) {
      const amount = asked.amounts[i];
      const [keep, ...extra] = rows; // 同一樣有好幾筆（同一分鐘記了兩次以上）就併回一筆
      for (const l of extra) await db.deleteLog(l.id);
      if (keep && amount > 0) await db.updateLog(keep.id, logRow(food, amount, asked.time, combo.id));
      else if (keep) await db.deleteLog(keep.id);
      else if (amount > 0) added.push(logRow(food, amount, asked.time, combo.id));
    }
    if (added.length) await db.addLog(added);
  } else return;
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
$('#totals').addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const cell = e.target.closest('[data-item]');
  if (cell === hovered) return;
  hovered = cell;
  if (cell) showPop(cell); else hidePop();
});
$('#totals').addEventListener('pointerleave', hidePop);
$('#totals').addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const cell = e.target.closest('[data-item]');
  if (!cell) return;
  holdFrom = e;
  holdTimer = setTimeout(() => showPop(cell), HOLD_MS);
});
$('#totals').addEventListener('pointermove', (e) => {
  if (!holdFrom) return; // 手指按住中才要判斷有沒有滑掉
  if (Math.hypot(e.clientX - holdFrom.clientX, e.clientY - holdFrom.clientY) > MOVE_TOLERANCE) hidePop();
});
for (const type of ['pointerup', 'pointercancel']) $('#totals').addEventListener(type, hidePop);
window.addEventListener('scroll', hidePop, true);
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
  const comboRow = e.target.closest('[data-combo-log]');
  if (comboRow) {
    const [comboId, createdAt] = comboRow.dataset.comboLog.split('|');
    const group = logs.filter((l) => l.combo_id === comboId && l.created_at === createdAt);
    return void editComboLogs(combos.find((c) => c.id === comboId), group);
  }
  const row = e.target.closest('[data-log]');
  if (row) editLog(logs.find((l) => l.id === row.dataset.log));
});
