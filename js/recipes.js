import { $, esc, fmt, rowHtml } from './util.js?v=087c7e0';
import { load, openComboEditor, comboAmounts } from './foods.js?v=087c7e0';

let foods = [];
let recipes = [];

export async function show() {
  const data = await load();
  foods = data.foods;
  recipes = data.combos.filter((c) => c.yield_qty != null);
  $('#recipes-list').innerHTML = recipes.map((r) => {
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
  if (await openComboEditor({}, { recipe: true })) show();
});
$('#recipes-list').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-recipe]');
  if (row && await openComboEditor(recipes.find((r) => r.id === row.dataset.recipe), { recipe: true })) show();
});
