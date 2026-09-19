export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmt = (n, digits = 1) =>
  n == null ? '—' : Number(n).toLocaleString('zh-TW', { maximumFractionDigits: digits });

// 本地時區的 yyyy-mm-dd
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

// 營養項目；food = foods 的欄位（每 1 記錄單位），log = food_logs 的快照欄位。
// stdPerKg／stdFixed = 標準值怎麼算：一般成年人（國健署／國人膳食營養素參考攝取量），跟著歐姆龍體重變；使用者不能改。
//   熱量 30 kcal/kg（輕度活動）；蛋白質 1.1 g/kg；脂肪占熱量 25%（0.83 g/kg）；碳水 4.5 g/kg（＝剩下的熱量，約 60%）；
//   飽和脂肪、糖各不超過熱量的 10%（0.33、0.75 g/kg）；膳食纖維每 1000 kcal 配 14g（0.42 g/kg）；
//   鈉 2400mg（國健署上限）；反式脂肪 2g（不超過熱量的 1%）。
//   有在重訓、想吃多一點，是到設定頁填「目標值」，不是改這裡。
// limit = 這項是「上限」（吃越少越好）；near = 盡量接近標準就好（太多太少都不好）；其餘＝至少吃到標準（吃越多越好）。
export const NUTRIENTS = [
  { label: '熱量', unit: 'kcal', digits: 0, food: 'kcal_per_unit', log: 'kcal', stdPerKg: 30, near: true },
  { label: '蛋白質', unit: 'g', digits: 1, food: 'protein_per_unit', log: 'protein_g', stdPerKg: 1.1 },
  { label: '脂肪', unit: 'g', digits: 1, food: 'fat_per_unit', log: 'fat_g', stdPerKg: 0.83, near: true },
  { label: '飽和脂肪', unit: 'g', digits: 1, food: 'sat_fat_per_unit', log: 'sat_fat_g', stdPerKg: 0.33, limit: true },
  { label: '反式脂肪', unit: 'g', digits: 1, food: 'trans_fat_per_unit', log: 'trans_fat_g', stdFixed: 2, limit: true },
  { label: '碳水化合物', unit: 'g', digits: 1, food: 'carb_per_unit', log: 'carb_g', stdPerKg: 4.5, near: true },
  { label: '糖', unit: 'g', digits: 1, food: 'sugar_per_unit', log: 'sugar_g', stdPerKg: 0.75, limit: true },
  { label: '膳食纖維', unit: 'g', digits: 1, food: 'fiber_per_unit', log: 'fiber_g', stdPerKg: 0.42 },
  { label: '鈉', unit: 'mg', digits: 0, food: 'sodium_per_unit', log: 'sodium_mg', stdFixed: 2400, limit: true },
];

// 依體重自動算的標準值；算不出來（還沒有體重）就是 null
export const autoStandard = (n, weight) =>
  n.stdFixed ?? (n.stdPerKg != null && weight != null ? n.stdPerKg * weight : null);

// 維生素／礦物質／其他保健成分；rda = 每日建議量（國人膳食營養素參考攝取量，成年男性；銅用美國 RDA）。
// 存在 foods.micros（每 1 記錄單位）與 food_logs.micros（快照），要加新項目只要在這裡加一列。
export const MICROS = [
  // 依對身體的重要程度排（也是食物編輯框裡的順序）；最後四項沒有官方的每日建議量，只顯示總量
  { key: 'potassium', label: '鉀', unit: 'mg', digits: 0, rda: 2800 },
  // Omega-3 總量（ALA＋EPA＋DHA）；1600mg 是美國對成年男性的足夠攝取量
  { key: 'omega3', label: 'Omega-3', unit: 'mg', digits: 0, rda: 1600 },
  { key: 'calcium', label: '鈣', unit: 'mg', digits: 0, rda: 1000 },
  { key: 'magnesium', label: '鎂', unit: 'mg', digits: 0, rda: 380 },
  { key: 'iron', label: '鐵', unit: 'mg', digits: 1, rda: 10 },
  { key: 'zinc', label: '鋅', unit: 'mg', digits: 1, rda: 15 },
  { key: 'vit_d', label: '維生素D', unit: 'μg', digits: 1, rda: 10 },
  { key: 'vit_b12', label: 'B12', unit: 'μg', digits: 1, rda: 2.4 },
  { key: 'folate', label: '葉酸', unit: 'μg', digits: 0, rda: 400 },
  { key: 'vit_c', label: '維生素C', unit: 'mg', digits: 0, rda: 100 },
  { key: 'vit_a', label: '維生素A', unit: 'μg', digits: 0, rda: 600 },
  { key: 'iodine', label: '碘', unit: 'μg', digits: 0, rda: 150 },
  { key: 'vit_e', label: '維生素E', unit: 'mg', digits: 1, rda: 12 },
  { key: 'vit_k', label: '維生素K', unit: 'μg', digits: 0, rda: 120 },
  { key: 'vit_b1', label: 'B1', unit: 'mg', digits: 2, rda: 1.2 },
  { key: 'vit_b2', label: 'B2', unit: 'mg', digits: 2, rda: 1.3 },
  { key: 'niacin', label: '菸鹼素', unit: 'mg', digits: 1, rda: 16 },
  { key: 'vit_b6', label: 'B6', unit: 'mg', digits: 2, rda: 1.5 },
  { key: 'selenium', label: '硒', unit: 'μg', digits: 0, rda: 55 },
  { key: 'copper', label: '銅', unit: 'mg', digits: 1, rda: 0.9 },
  { key: 'pantothenic', label: '泛酸', unit: 'mg', digits: 1, rda: 5 },
  { key: 'biotin', label: '生物素', unit: 'μg', digits: 0, rda: 30 },
  { key: 'epa', label: 'EPA', unit: 'mg', digits: 0 },
  { key: 'dha', label: 'DHA', unit: 'mg', digits: 0 },
  { key: 'lutein', label: '葉黃素', unit: 'mg', digits: 0 },
  { key: 'anthocyanin', label: '花青素', unit: 'mg', digits: 0 },
  { key: 'inositol', label: '肌醇', unit: 'mg', digits: 0 },
];

// 一組營養數字 → <dt>/<dd>；沒資料的項目顯示「—」。noteOf 可以在數字下面再加一行小字
export const nutrientCells = (items, valueOf, noteOf = () => '') => items.map((n) => {
  const value = valueOf(n);
  return `<div><dt>${n.label}</dt><dd>${value == null ? '—' : `${fmt(value, n.digits)}<small>${n.unit}</small>`}</dd>${noteOf(n, value)}</div>`;
}).join('');

// 澱粉不用填：包裝上不會標，用「碳水 − 糖 − 膳食纖維」估（台灣標示的碳水含纖維）。三個都有值才算得出來。
const STARCH = { label: '澱粉（估）', unit: 'g', digits: 1, log: 'starch_g' };
export const SHOWN_NUTRIENTS = [...NUTRIENTS.slice(0, 8), STARCH, NUTRIENTS[8]];

// 今日食物頁「今天總共」的順序：熱量、蛋白質最前面，接著越重要的越前面；
// 「上限」類（吃越少越好）排在必需營養素後面，沒有建議量的保健成分放最後。
const macro = (log) => NUTRIENTS.find((n) => n.log === log);
export const TOTAL_ITEMS = [
  macro('kcal'), macro('protein_g'), macro('fat_g'), macro('carb_g'), macro('fiber_g'),
  ...MICROS.filter((m) => m.rda != null),
  macro('sodium_mg'), macro('sat_fat_g'), macro('sugar_g'), macro('trans_fat_g'), STARCH,
  ...MICROS.filter((m) => m.rda == null),
];
export const withStarch = (row) => ({
  ...row,
  starch_g: [row.carb_g, row.sugar_g, row.fiber_g].some((v) => v == null)
    ? null : Math.max(0, Math.round((row.carb_g - row.sugar_g - row.fiber_g) * 100) / 100),
});

// 沒填單位或蛋白質 → 待補，不能拿來記錄
export const isPending = (food) => !food.log_unit || food.protein_per_unit == null;

// 每項營養今天要比對的數字 → { 快照欄位: 數字或 null }
// 順序：自己訂的目標值（每公斤 × 最新體重）→ 依體重自動算的標準值
export function dailyTargets(settings, latestWeight) {
  const targets = {};
  for (const n of NUTRIENTS) {
    const perKg = settings.targets?.[n.log]?.per_kg;
    targets[n.log] = perKg != null && latestWeight != null ? perKg * latestWeight : autoStandard(n, latestWeight);
  }
  return targets;
}

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

// 設計規定：所有彈窗點外面（暗色區域）＝按主要按鈕（儲存／加入／更新）並關閉，不管有沒有改。
// 必填沒填、存不了的就直接關掉。按下跟放開都要在外面才算，在裡面選字拖到外面放開不會誤觸。
const isOutside = (e) => {
  if (!(e.target instanceof HTMLDialogElement)) return false;
  const box = e.target.getBoundingClientRect();
  return e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
};
let pressedOutside = false;
document.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
document.addEventListener('click', (e) => {
  if (!pressedOutside || !isOutside(e)) return;
  const form = e.target.querySelector('form');
  if (form.checkValidity()) form.requestSubmit(form.querySelector('button.primary'));
  else e.target.close('cancel');
});

// 開一個 <dialog>，回傳使用者按了哪顆按鈕的 value（按 Esc 算 cancel）
export function openDialog(dialog) {
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
}
