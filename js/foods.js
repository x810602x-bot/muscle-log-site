import * as db from './db.js?v=94d1c11';
import { $, esc, fmt, isPending, numOrNull, openDialog, nutrientCells, NUTRIENTS, SHOWN_NUTRIENTS, MICROS, withStarch } from './util.js?v=94d1c11';

let foods = [];
let combos = [];
let filter = 'all';

// g、ml 的營養用「每 100」輸入（營養標示就是這樣寫），存的時候換回每 1 單位
export const per100 = (unit) => unit === 'g' || unit === 'ml';

// 牌價 → 每 1 記錄單位的金額：每KG／每公升 配 g／ml 要除以 1000，其餘就是牌價本身
function costPerUnit(price, priceLabel, unit) {
  if (price == null) return null;
  return /^每\s*(kg|公斤|公升|l)$/i.test(priceLabel ?? '') && per100(unit) ? price / 1000 : price;
}

export function proteinText(food) {
  if (isPending(food)) return '待補';
  if (food.is_supplement) return '保健品';
  return per100(food.log_unit)
    ? `每 100${food.log_unit} 蛋白質 ${fmt(food.protein_per_unit * 100, 2)}g`
    : `每${food.log_unit} 蛋白質 ${fmt(food.protein_per_unit, 2)}g`;
}

// ---- 新增／編輯食物（今日食物頁也會用到）----
const field = {
  name: $('#food-name'), unit: $('#food-unit'), supplement: $('#food-supplement'),
  store: $('#food-store'), paid: $('#food-paid'),
  price: $('#food-price'), priceLabel: $('#food-price-label'), note: $('#food-note'),
};
const numberInput = (attr, key, label) =>
  `<label>${label}<input data-${attr}="${key}" type="number" inputmode="decimal" step="any" min="0"></label>`;
$('#food-nutrients').innerHTML = NUTRIENTS.map((n) => numberInput('nutrient', n.food, `${n.label} (${n.unit})`)).join('');
$('#food-micros').innerHTML = MICROS.map((m) => numberInput('micro', m.key, `${m.label} (${m.unit})`)).join('');
const nutrientInput = (n) => $(`#food-nutrients [data-nutrient="${n.food}"]`);
const microInput = (m) => $(`#food-micros [data-micro="${m.key}"]`);

function refreshHints() {
  const unit = field.unit.value.trim();
  const per = `每 ${per100(unit) ? `100${unit}` : `1 ${unit || '單位'}`}`;
  $('#food-nutrients-title').textContent = `營養成分（${per}）`;
  $('#food-micros-title').textContent = `維生素／礦物質／保健成分（${per}，選填）`;
  const cost = costPerUnit(numOrNull(field.price.value), field.priceLabel.value.trim(), unit);
  $('#food-cost-preview').textContent = cost == null || !unit ? '' : `換算：每 1 ${unit} = $${fmt(cost, 4)}`;
}
for (const el of [field.unit, field.price, field.priceLabel]) el.addEventListener('input', refreshHints);

field.unit.addEventListener('change', () => {
  const unit = field.unit.value.trim();
  if (unit && !field.priceLabel.value) {
    field.priceLabel.value = unit === 'g' ? '每KG' : unit === 'ml' ? '每公升' : `每${unit}`;
    refreshHints();
  }
});

// 回傳存好的食物；取消則回傳 null
export async function openFoodEditor(food = {}, { why = false } = {}) {
  const shown = per100(food.log_unit) ? 100 : 1;
  $('#food-title').textContent = food.id ? '編輯食物' : '新增食物';
  $('#food-why').hidden = !why;
  field.name.value = food.name ?? '';
  field.unit.value = food.log_unit ?? '';
  field.supplement.checked = !!food.is_supplement;
  for (const n of NUTRIENTS) nutrientInput(n).value = food[n.food] == null ? '' : +(food[n.food] * shown).toFixed(6);
  for (const m of MICROS) microInput(m).value = food.micros?.[m.key] == null ? '' : +(food.micros[m.key] * shown).toFixed(6);
  $('#food-micros-box').open = !!food.is_supplement || Object.keys(food.micros ?? {}).length > 0;
  field.store.value = food.store ?? '';
  field.paid.value = food.paid_price ?? '';
  field.price.value = food.price ?? '';
  field.priceLabel.value = food.price_label ?? '';
  field.note.value = food.note ?? '';
  const archiveBtn = $('#food-archive');
  archiveBtn.hidden = !food.id;
  archiveBtn.textContent = food.archived ? '取消封存' : '封存';
  refreshHints();

  const action = await openDialog($('#food-dialog'));
  if (action === 'cancel') return null;
  if (action === 'archive') return db.saveFood({ id: food.id, archived: !food.archived });

  const unit = field.unit.value.trim() || null;
  const isSupplement = field.supplement.checked;
  const perUnit = (value) => (value == null ? null : per100(unit) ? value / 100 : value);
  const nutrients = {};
  for (const n of NUTRIENTS) {
    // 保健品的熱量、蛋白質…幾乎是 0，沒填就當 0，才不用為了一顆維生素填一排 0
    nutrients[n.food] = perUnit(numOrNull(nutrientInput(n).value) ?? (isSupplement ? 0 : null));
  }
  const micros = {};
  for (const m of MICROS) {
    const value = perUnit(numOrNull(microInput(m).value));
    if (value != null) micros[m.key] = value;
  }
  const price = numOrNull(field.price.value);
  const priceLabel = field.priceLabel.value.trim() || null;
  return db.saveFood({
    id: food.id,
    name: field.name.value.trim(),
    log_unit: unit,
    is_supplement: isSupplement,
    ...nutrients,
    micros,
    store: field.store.value.trim() || null,
    paid_price: numOrNull(field.paid.value),
    price,
    price_label: priceLabel,
    cost_per_unit: costPerUnit(price, priceLabel, unit),
    note: field.note.value.trim() || null,
  });
}

// ---- 組合：幾種食物＋份量存成一組（便當、固定菜單），在今日食物頁一次記進去 ----
let comboItems = []; // 編輯中的組合內容：[{ food_id, qty }]

// 一個組合「1 份」的營養與花費（用食物現在的資料算）
export function comboAmounts(items, allFoods) {
  const total = {};
  for (const item of items) {
    const food = allFoods.find((f) => f.id === item.food_id);
    if (!food) continue;
    for (const [column, perUnit] of [['cost', food.cost_per_unit], ...NUTRIENTS.map((n) => [n.log, food[n.food]])]) {
      if (perUnit != null) total[column] = (total[column] ?? 0) + perUnit * item.qty;
    }
  }
  return withStarch(Object.fromEntries(['cost', ...NUTRIENTS.map((n) => n.log)].map((c) => [c, total[c] ?? null])));
}

// ---- 食譜：也是「幾種食物＋份量」，但內容是一整鍋的材料，另外填「這鍋煮出來多少」。----
// 存檔時自動建／更新一個同名的食物（每 1 單位＝整鍋加總 ÷ 煮出來多少），記錄時點那個食物，只記一筆。
let recipeMode = false;
const tidy = (n) => +n.toPrecision(6);

function recipeFoodFields(name, items, yieldQty, unit) {
  const total = comboAmounts(items, foods);
  const fields = { name, log_unit: unit, archived: false, micros: {}, note: '由食譜自動算出；改食譜會跟著更新，不要直接改這裡' };
  for (const n of NUTRIENTS) fields[n.food] = total[n.log] == null ? null : tidy(total[n.log] / yieldQty);
  for (const item of items) {
    const micros = foods.find((f) => f.id === item.food_id)?.micros ?? {};
    for (const [key, value] of Object.entries(micros)) fields.micros[key] = tidy((fields.micros[key] ?? 0) + value * item.qty / yieldQty);
  }
  fields.cost_per_unit = total.cost == null ? null : tidy(total.cost / yieldQty);
  fields.price = fields.cost_per_unit == null ? null : tidy(fields.cost_per_unit * (per100(unit) ? 1000 : 1));
  fields.price_label = unit === 'g' ? '每KG' : unit === 'ml' ? '每公升' : `每${unit}`;
  return fields;
}

function renderComboPreview() {
  const total = comboAmounts(comboItems, foods);
  $('#combo-preview').innerHTML = nutrientCells(SHOWN_NUTRIENTS, (n) => total[n.log]);
  if (!recipeMode) return;
  const weighed = (item) => per100(foods.find((f) => f.id === item.food_id)?.log_unit);
  const weight = comboItems.reduce((sum, item) => sum + (weighed(item) ? item.qty : 0), 0);
  $('#combo-preview-title').textContent = `整鍋的營養（材料共 ${fmt(weight, 0)} g）`;
  // 每樣材料占材料總重的 %；改 g 的時候只更新這幾格文字，不重畫輸入框（才不會打到一半跳掉）
  comboItems.forEach((item, index) => {
    $(`#combo-items [data-pct="${index}"]`).textContent = weight && weighed(item) ? `${fmt(item.qty / weight * 100, 1)}%` : '';
  });
  const unit = $('#recipe-yield-unit').value.trim();
  const per = (Number($('#recipe-yield-qty').value) || 0) / (per100(unit) ? 100 : 1);
  $('#recipe-unit-title').textContent = `每 ${per100(unit) ? `100${unit}` : `1 ${unit || '單位'}`} 的營養`;
  $('#recipe-unit-preview').innerHTML = nutrientCells(SHOWN_NUTRIENTS, (n) => (per && total[n.log] != null ? total[n.log] / per : null));
}
for (const id of ['#recipe-yield-qty', '#recipe-yield-unit']) $(id).addEventListener('input', renderComboPreview);

function renderComboItems() {
  $('#combo-items').innerHTML = comboItems.map((item, index) => {
    const food = foods.find((f) => f.id === item.food_id);
    return `<div class="combo-item">
      <span class="combo-item-name">${esc(food?.name ?? '（已刪除的食物）')}</span>
      <input data-index="${index}" type="number" inputmode="decimal" step="any" min="0" value="${item.qty}" aria-label="份量">
      <span class="combo-item-unit">${esc(food?.log_unit ?? '')}</span>
      ${recipeMode ? `<span class="combo-item-pct" data-pct="${index}"></span>` : ''}
      <button type="button" class="icon-btn" data-remove="${index}" aria-label="移除">×</button>
    </div>`;
  }).join('') || '<p class="hint">還沒有內容，從下面加食物進來。</p>';
  renderComboPreview();
}

$('#combo-items').addEventListener('input', (e) => {
  if (e.target.dataset.index == null) return;
  comboItems[e.target.dataset.index].qty = Number(e.target.value) || 0;
  renderComboPreview();
});
$('#combo-items').addEventListener('click', (e) => {
  if (e.target.dataset.remove == null) return;
  comboItems.splice(e.target.dataset.remove, 1);
  renderComboItems();
});
// 從清單選到（或打完整名稱）就加進組合
$('#combo-food-search').addEventListener('input', (e) => {
  const food = foods.find((f) => f.name === e.target.value);
  if (!food) return;
  comboItems.push({ food_id: food.id, qty: per100(food.log_unit) ? 100 : 1 });
  e.target.value = '';
  renderComboItems();
});

$('#combo-dialog').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id !== 'combo-name' && e.target.tagName === 'INPUT') e.preventDefault();
});

export async function openComboEditor(combo = {}, { recipe = false } = {}) {
  recipeMode = recipe;
  $('#combo-title').textContent = `${combo.id ? '編輯' : '新增'}${recipe ? '食譜' : '組合'}`;
  $('#combo-name').value = combo.name ?? '';
  $('#combo-name').placeholder = recipe ? '例如：自製羅宋湯' : '例如：池上控肉便當';
  $('#combo-preview-title').textContent = '一份的營養';
  for (const id of ['#recipe-yield', '#recipe-unit-title', '#recipe-unit-preview']) $(id).hidden = !recipe;
  $('#recipe-yield-qty').required = recipe;
  $('#recipe-yield-qty').value = combo.yield_qty ?? '';
  $('#recipe-yield-unit').value = combo.yield_unit ?? 'g';
  $('#combo-food-search').value = '';
  $('#combo-food-list').innerHTML = foods.filter((f) => !f.archived && !isPending(f)).map((f) => `<option value="${esc(f.name)}">`).join('');
  comboItems = (combo.items ?? []).map((item) => ({ ...item }));
  const archiveBtn = $('#combo-archive');
  archiveBtn.hidden = !combo.id;
  archiveBtn.textContent = combo.archived ? '取消封存' : '封存';
  renderComboItems();

  const action = await openDialog($('#combo-dialog'));
  if (action === 'cancel') return null;
  if (action === 'archive') {
    if (combo.food_id) await db.saveFood({ id: combo.food_id, archived: !combo.archived });
    return db.saveCombo({ id: combo.id, archived: !combo.archived });
  }
  const name = $('#combo-name').value.trim();
  const items = comboItems.filter((item) => item.qty > 0);
  if (!recipe) return db.saveCombo({ id: combo.id, name, items });
  const yieldQty = Number($('#recipe-yield-qty').value);
  const unit = $('#recipe-yield-unit').value.trim() || 'g';
  const food = await db.saveFood({ id: combo.food_id, ...recipeFoodFields(name, items, yieldQty, unit) });
  return db.saveCombo({ id: combo.id, name, items, yield_qty: yieldQty, yield_unit: unit, food_id: food.id });
}

// 食譜頁也會用到
export async function load() {
  [foods, combos] = await Promise.all([db.listFoods(), db.listCombos()]);
  return { foods, combos };
}

// ---- 食物庫分頁 ----
export async function show() {
  await load();
  render();
}

function render() {
  const q = $('#foods-search').value.trim().toLowerCase();
  const active = foods.filter((f) => !f.archived);
  const pendingCount = active.filter(isPending).length;
  const tabs = [['all', '全部'], ['pending', `待補 ${pendingCount}`], ['supplement', '保健品'], ['combos', '組合'], ['archived', '已封存']];
  $('#foods-filter').innerHTML = tabs
    .map(([key, label]) => `<button data-filter="${key}" ${key === filter ? 'aria-pressed="true"' : ''}>${label}</button>`)
    .join('');

  if (filter === 'combos') {
    $('#foods-list').innerHTML = combos.filter((c) => c.yield_qty == null && c.name.toLowerCase().includes(q)).map((c) => {
      const amounts = comboAmounts(c.items, foods);
      return `<li><button class="row" data-combo="${c.id}">
        <span class="row-main">
          <span class="row-title">${esc(c.name)}${c.archived ? ' <span class="badge">已封存</span>' : ''}</span>
          <span class="row-sub">${c.items.length} 樣 · 熱量 ${fmt(amounts.kcal, 0)} kcal${amounts.cost == null ? '' : ` · $${fmt(amounts.cost, 0)}`}</span>
        </span>
        <span class="row-side">${fmt(amounts.protein_g)}<small>g 蛋白質</small></span>
      </button></li>`;
    }).join('') || '<li class="empty">還沒有組合。按右上「＋ 組合」，把便當裡的每道菜加進去存成一組。</li>';
    return;
  }

  const pool = filter === 'archived' ? foods.filter((f) => f.archived)
    : filter === 'pending' ? active.filter(isPending)
    : filter === 'supplement' ? active.filter((f) => f.is_supplement) : active;
  const shown = pool
    .filter((f) => `${f.store ?? ''} ${f.name}`.toLowerCase().includes(q))
    .sort((a, b) => isPending(b) - isPending(a) || a.name.localeCompare(b.name, 'zh-Hant'));

  $('#foods-list').innerHTML = shown.map((f) => {
    const price = f.price == null ? '沒填單價' : `$${fmt(f.price, 1)} ${esc(f.price_label ?? '')}`;
    const cp = f.cost_per_unit != null && f.protein_per_unit ? `<span class="row-side">$${fmt(f.cost_per_unit / f.protein_per_unit, 2)}<small>每 1g 蛋白質</small></span>` : '';
    return `<li><button class="row" data-id="${f.id}">
      <span class="row-main">
        <span class="row-title">${f.store ? `<span class="store">${esc(f.store)}</span> ` : ''}${esc(f.name)}${f.paid_price == null ? '' : ` <span class="paid">$${fmt(f.paid_price, 0)}</span>`}${isPending(f) ? ' <span class="badge">待補</span>' : ''}</span>
        <span class="row-sub">${isPending(f) ? '還沒填蛋白質或單位' : esc(proteinText(f))} · ${price}</span>
      </span>${cp}
    </button></li>`;
  }).join('') || '<li class="empty">沒有符合的食物</li>';
}

$('#foods-search').addEventListener('input', render);
$('#foods-filter').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter;
  render();
});
$('#food-new').addEventListener('click', async () => {
  if (await openFoodEditor()) show();
});
$('#combo-new').addEventListener('click', async () => {
  if (await openComboEditor()) {
    filter = 'combos';
    show();
  }
});
$('#foods-list').addEventListener('click', async (e) => {
  const comboRow = e.target.closest('[data-combo]');
  if (comboRow) {
    if (await openComboEditor(combos.find((c) => c.id === comboRow.dataset.combo))) show();
    return;
  }
  const row = e.target.closest('[data-id]');
  if (row && await openFoodEditor(foods.find((f) => f.id === row.dataset.id))) show();
});
