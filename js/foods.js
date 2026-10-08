// 食物庫：食物、組合、食譜的一份快取，跟它們的編輯框。食物庫頁、食譜頁、今日食物頁都從這裡拿資料、叫這裡開編輯框。
import * as db from './db.js?v=1c6ea53';
import { $, esc, fmt, numOrNull, openDialog, toast, nutrientCells, rowHtml, comboBadge } from './util.js?v=1c6ea53';
import { NUTRIENTS, SHOWN_NUTRIENTS, MICROS, isPending, per100, comboAmounts, scaleAmounts, foodFieldsOf } from './nutrition.js?v=1c6ea53';

// ---- 快取：任何一頁 show() 的時候 refresh() 一次，之後整頁都讀這份 ----
let foods = [];  // 含封存
let combos = []; // 含封存、含食譜（有 yield_qty 的就是食譜）
let favorites = []; // 常吃食物（settings.favorites）：[{ type: 'food' | 'combo', id }]，照這個順序
const isRecipe = (c) => c.yield_qty != null;

export async function refresh() {
  [foods, combos, { favorites = [] }] = await Promise.all([db.listFoods(), db.listCombos(), db.getSettings()]);
}
export const allFoods = () => foods;                                        // 含封存的，組合裡可能還用得到
export const activeFoods = () => foods.filter((f) => !f.archived);          // 拿來選的
export const activeCombos = () => combos.filter((c) => !c.archived && !isRecipe(c)); // 食譜不在這裡，記錄時點它自動建的那個食物
export const recipes = () => combos.filter(isRecipe);
// 常吃食物裡還在的（封存、刪掉的跳過），照存的順序；拿到的就是食物或組合本身
export const favoriteItems = () => favorites
  .map(({ type, id }) => (type === 'combo' ? activeCombos() : activeFoods()).find((item) => item.id === id))
  .filter(Boolean);

// 牌價 → 每 1 記錄單位的金額：每KG／每公升 配 g／ml 要除以 1000，其餘就是牌價本身
export function costPerUnit(price, priceLabel, unit) {
  if (price == null) return null;
  return /^每\s*(kg|公斤|公升|l)$/i.test(priceLabel ?? '') && per100(unit) ? price / 1000 : price;
}
// 單位沒另外說牌價單位時的預設：g 配每KG、ml 配每公升、其餘「每○」
const defaultPriceLabel = (unit) => (unit === 'g' ? '每KG' : unit === 'ml' ? '每公升' : `每${unit}`);

export function proteinText(food) {
  if (isPending(food)) return '待補';
  if (food.is_supplement) return '保健品';
  return per100(food.log_unit)
    ? `每 100${food.log_unit} 蛋白質 ${fmt(food.protein_per_unit * 100, 2)}g`
    : `每${food.log_unit} 蛋白質 ${fmt(food.protein_per_unit, 2)}g`;
}

// 兩個編輯框共用的收尾：封存鈕的字、開框，取消回 null、封存交給 archive()、刪除交給 remove()、其餘交給 save()
async function runEditor(dialog, archiveBtn, existing, { archive, remove, save }) {
  archiveBtn.hidden = !existing.id;
  archiveBtn.textContent = existing.archived ? '取消封存' : '封存';
  const action = await openDialog(dialog);
  if (action === 'cancel') return null;
  if (action === 'archive') return archive();
  if (action === 'delete') return remove();
  return save();
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
    field.priceLabel.value = defaultPriceLabel(unit);
    refreshHints();
  }
});

// 刪除鈕只在食物庫頁出現（今日食物頁正要拿它來記，不能刪）。按一次變「確定刪除？」，再按才刪；
// 記錄、組合、食譜用到的不能刪（以前的記錄要靠它算），只能封存
const deleteBtn = $('#food-delete');
let deleting = null; // 編輯框裡這個食物的 id
let armTimer;
function disarmDelete() {
  clearTimeout(armTimer);
  delete deleteBtn.dataset.armed;
  deleteBtn.textContent = '刪除';
}
deleteBtn.addEventListener('click', async () => {
  if (!deleteBtn.dataset.armed) {
    deleteBtn.dataset.armed = '1';
    deleteBtn.textContent = '刪除？';
    armTimer = setTimeout(disarmDelete, 3000); // 跟對話列表的刪除一樣，3 秒沒按就變回來
    return;
  }
  const id = deleting;
  await refresh(); // 組合用了哪些食物沒有外鍵擋，要用最新的（別的裝置可能剛加進組合）
  const inCombo = combos.find((c) => c.food_id === id || c.items?.some((i) => i.food_id === id));
  const logs = inCombo ? 0 : await db.countFoodLogs(id);
  if (deleting !== id || !$('#food-dialog').open) return; // 等的時候框已經關了或換了別的食物
  if (inCombo || logs) {
    disarmDelete();
    return toast(inCombo ? `「${inCombo.name}」裡有用到，只能封存` : `已經記錄過 ${logs} 次，只能封存（以前的記錄要靠它算）`);
  }
  $('#food-dialog').close('delete');
});

// 回傳存好的食物；取消則回傳 null；刪掉了回傳 { id, deleted: true }（只有 canDelete 才會）
export async function openFoodEditor(food = {}, { why = false, canDelete = false } = {}) {
  const shown = per100(food.log_unit) ? 100 : 1;
  $('#food-title').textContent = food.id ? '編輯食物' : '新增食物';
  $('#food-why').hidden = !why;
  deleting = food.id;
  deleteBtn.hidden = !(canDelete && food.id);
  disarmDelete();
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
  refreshHints();

  return runEditor($('#food-dialog'), $('#food-archive'), food, {
    archive: () => db.saveFood({ id: food.id, archived: !food.archived }),
    async remove() {
      await db.deleteFood(food.id);
      // 在常吃食物裡的也拿掉
      if (favorites.some((f) => f.id === food.id)) {
        favorites = favorites.filter((f) => f.id !== food.id);
        await db.saveSettings({ favorites });
      }
      toast(`已刪除「${food.name || '沒有名稱的食物'}」`);
      return { id: food.id, deleted: true };
    },
    save() {
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
    },
  });
}

// ---- 組合：幾種食物＋份量存成一組（便當、固定菜單），在今日食物頁一次記進去 ----
// ---- 食譜：也是「幾種食物＋份量」，但內容是一整鍋的材料，另外填「這鍋煮出來多少」。----
// 存檔時自動建／更新一個同名的食物（每 1 單位＝整鍋加總 ÷ 煮出來多少），記錄時點那個食物，只記一筆。
let comboItems = []; // 編輯中的組合內容：[{ food_id, qty }]
let recipeMode = false;

function recipeFoodFields(name, items, yieldQty, unit) {
  const perUnit = scaleAmounts(comboAmounts(items, foods), 1 / yieldQty);
  const fields = { name, log_unit: unit, archived: false, note: '由食譜自動算出；改食譜會跟著更新，不要直接改這裡', ...foodFieldsOf(perUnit) };
  fields.price = fields.cost_per_unit == null ? null : fields.cost_per_unit * (per100(unit) ? 1000 : 1);
  fields.price_label = defaultPriceLabel(unit);
  return fields;
}

function renderComboPreview() {
  const total = comboAmounts(comboItems, foods);
  $('#combo-preview').innerHTML = nutrientCells(SHOWN_NUTRIENTS, (n) => n.read(total));
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
  const perUnit = per ? scaleAmounts(total, 1 / per) : null;
  $('#recipe-unit-title').textContent = `每 ${per100(unit) ? `100${unit}` : `1 ${unit || '單位'}`} 的營養`;
  $('#recipe-unit-preview').innerHTML = nutrientCells(SHOWN_NUTRIENTS, (n) => (perUnit ? n.read(perUnit) : null));
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
  $('#combo-food-list').innerHTML = activeFoods().filter((f) => !isPending(f)).map((f) => `<option value="${esc(f.name)}">`).join('');
  comboItems = (combo.items ?? []).map((item) => ({ ...item }));
  renderComboItems();

  return runEditor($('#combo-dialog'), $('#combo-archive'), combo, {
    // 封存食譜會一起封存它自動建的那個食物
    async archive() {
      if (combo.food_id) await db.saveFood({ id: combo.food_id, archived: !combo.archived });
      return db.saveCombo({ id: combo.id, archived: !combo.archived });
    },
    async save() {
      const name = $('#combo-name').value.trim();
      const items = comboItems.filter((item) => item.qty > 0);
      if (!recipe) return db.saveCombo({ id: combo.id, name, items });
      const yieldQty = Number($('#recipe-yield-qty').value);
      const unit = $('#recipe-yield-unit').value.trim() || 'g';
      const food = await db.saveFood({ id: combo.food_id, ...recipeFoodFields(name, items, yieldQty, unit) });
      return db.saveCombo({ id: combo.id, name, items, yield_qty: yieldQty, yield_unit: unit, food_id: food.id });
    },
  });
}

// ---- 食物庫分頁 ----
let filter = 'all';

export async function show() {
  await refresh();
  render();
}

function render() {
  const q = $('#foods-search').value.trim().toLowerCase();
  const active = activeFoods();
  const pendingCount = active.filter(isPending).length;
  const tabs = [['all', '全部'], ['pending', `待補 ${pendingCount}`], ['supplement', '保健品'], ['combos', '組合'], ['archived', '已封存']];
  $('#foods-filter').innerHTML = tabs
    .map(([key, label]) => `<button data-filter="${key}" ${key === filter ? 'aria-pressed="true"' : ''}>${label}</button>`)
    .join('');

  if (filter === 'combos') {
    $('#foods-list').innerHTML = combos.filter((c) => !isRecipe(c) && c.name.toLowerCase().includes(q)).map((c) => {
      const amounts = comboAmounts(c.items, foods);
      return rowHtml({
        attrs: `data-combo="${c.id}"`,
        title: `${esc(c.name)} ${comboBadge}${c.archived ? ' <span class="badge">已封存</span>' : ''}`,
        sub: `${c.items.length} 樣 · 熱量 ${fmt(amounts.kcal, 0)} kcal${amounts.cost == null ? '' : ` · $${fmt(amounts.cost, 0)}`}`,
        side: `<span class="row-side">${fmt(amounts.protein_g)}<small>g 蛋白質</small></span>`,
      });
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
    return rowHtml({
      attrs: `data-id="${f.id}"`,
      title: `${f.store ? `<span class="store">${esc(f.store)}</span> ` : ''}${esc(f.name)}${f.paid_price == null ? '' : ` <span class="paid">$${fmt(f.paid_price, 0)}</span>`}${isPending(f) ? ' <span class="badge">待補</span>' : ''}`,
      sub: `${isPending(f) ? '還沒填蛋白質或單位' : esc(proteinText(f))} · ${price}`,
      side: cp,
    });
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

// ---- 常吃食物：從食物庫挑最多 5 個（食物、組合都可以），今日食物頁的食物格排最前面 ----
// 框裡改的是一份副本，按儲存（或點外面）才存；取消、Esc 就丟掉
const FAV_MAX = 5;
let favDraft = []; // 編輯中：食物或組合本身
let favPool = [];  // 下面清單現在列的（點了加進來）
// 看欄位分食物或組合（只有組合有 items）；快取重讀後物件會換新，不能拿 combos.includes() 比
const favType = (item) => (item.items ? 'combo' : 'food');

function renderFavorites() {
  $('#fav-list').innerHTML = favDraft.map((item, i) => `<div class="combo-item">
      <span class="combo-item-name">${esc(item.name)}${favType(item) === 'combo' ? ` ${comboBadge}` : isPending(item) ? ' <span class="badge">待補</span>' : ''}</span>
      <button type="button" class="icon-btn" data-up="${i}" aria-label="往前"${i ? '' : ' disabled'}>↑</button>
      <button type="button" class="icon-btn" data-down="${i}" aria-label="往後"${i < favDraft.length - 1 ? '' : ' disabled'}>↓</button>
      <button type="button" class="icon-btn" data-remove="${i}" aria-label="移除">×</button>
    </div>`).join('') || '<p class="hint">還沒有常吃食物，從下面點一個加進來。</p>';
  const full = favDraft.length >= FAV_MAX;
  $('#fav-search').disabled = full;
  $('#fav-full').hidden = !full;
  $('#fav-results').hidden = full;
  const q = $('#fav-search').value.trim().toLowerCase();
  favPool = [...activeCombos(), ...activeFoods()]
    .filter((item) => !favDraft.some((f) => f.id === item.id) && `${item.store ?? ''} ${item.name}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  $('#fav-results').innerHTML = favPool.map((item, i) => rowHtml({
    attrs: `type="button" data-add="${i}"`,
    title: favType(item) === 'combo' ? `${esc(item.name)} ${comboBadge}` : `${item.store ? `<span class="store">${esc(item.store)}</span> ` : ''}${esc(item.name)}`,
    sub: favType(item) === 'combo' ? `${item.items.length} 樣` : esc(proteinText(item)), // 待補的這裡會寫「待補」
  })).join('') || '<li class="empty">沒有符合的食物</li>';
}

$('#fav-search').addEventListener('input', renderFavorites);
$('#fav-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); // Enter 不要當成按儲存
$('#fav-dialog').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const { up, down, remove, add } = btn.dataset;
  const swap = (i, j) => { [favDraft[i], favDraft[j]] = [favDraft[j], favDraft[i]]; };
  if (up != null) swap(+up, +up - 1);
  else if (down != null) swap(+down, +down + 1);
  else if (remove != null) favDraft.splice(remove, 1);
  else if (add != null && favDraft.length < FAV_MAX) {
    favDraft.push(favPool[add]);
    $('#fav-search').value = ''; // 加好了，清掉搜尋好找下一個
  } else return;
  renderFavorites();
});

$('#fav-open').addEventListener('click', async () => {
  await refresh(); // 一進食物庫就點的話快取可能還沒讀好，空的存回去會把常吃食物洗掉
  favDraft = favoriteItems();
  $('#fav-search').value = '';
  renderFavorites();
  if (await openDialog($('#fav-dialog')) !== 'ok') return;
  favorites = favDraft.map((item) => ({ type: favType(item), id: item.id }));
  await db.saveSettings({ favorites });
  toast('常吃食物已儲存');
});
$('#foods-list').addEventListener('click', async (e) => {
  const comboRow = e.target.closest('[data-combo]');
  if (comboRow) {
    if (await openComboEditor(combos.find((c) => c.id === comboRow.dataset.combo))) show();
    return;
  }
  const row = e.target.closest('[data-id]');
  if (row && await openFoodEditor(foods.find((f) => f.id === row.dataset.id), { canDelete: true })) show();
});

// ---- 食譜分頁（清單；編輯沿用組合的編輯框）----
export async function showRecipes() {
  await refresh();
  $('#recipes-list').innerHTML = recipes().map((r) => {
    const total = comboAmounts(r.items, foods);
    return rowHtml({
      attrs: `data-recipe="${r.id}"`,
      title: `${esc(r.name)}${r.archived ? ' <span class="badge">已封存</span>' : ''}`,
      sub: `${r.items.length} 樣材料 · 煮出來 ${fmt(r.yield_qty, 0)} ${esc(r.yield_unit)} · 整鍋 ${fmt(total.kcal, 0)} kcal · 鈉 ${fmt(total.sodium_mg, 0)} mg${total.cost == null ? '' : ` · $${fmt(total.cost, 0)}`}`,
      side: `<span class="row-side">${fmt(total.protein_g)}<small>g 蛋白質（整鍋）</small></span>`,
    });
  }).join('') || '<li class="empty">還沒有食譜。按右上「＋ 食譜」，把一整鍋的材料加進去。</li>';
}

$('#recipe-new').addEventListener('click', async () => {
  if (await openComboEditor({}, { recipe: true })) showRecipes();
});
$('#recipes-list').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-recipe]');
  if (row && await openComboEditor(recipes().find((r) => r.id === row.dataset.recipe), { recipe: true })) showRecipes();
});
