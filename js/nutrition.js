// 營養項目的定義，跟「一份食物的量」的算術。這裡沒有畫面、沒有資料庫，用 node 就能測（test/）。
//
// 「量」(amounts) 跟 food_logs 一筆的快照同一個形狀：{ kcal, protein_g, …, cost, micros: { 項目 key: 數字 } }。
// 數字是 null 代表「不知道」（食物沒填），不是 0；加總時不知道的不算，全部都不知道才是 null。

// ---- 項目 ----
// 每一項都有同樣的三個東西，用的人不用管它存在哪一欄：
//   read(row)        從一份量（或一筆記錄）讀出這一項的數字
//   target(targets)  今天要比對的數字（targets 來自 targets.js），沒有就是 null
//   limit / near     limit＝上限（吃越少越好）；near＝盡量接近就好；兩個都沒有＝至少吃到（吃越多越好）

// 巨量營養；food = foods 的欄位（每 1 記錄單位），log = food_logs 的快照欄位。
// stdPerKg／stdFixed = 標準值怎麼算：一般成年人（國健署／國人膳食營養素參考攝取量），跟著歐姆龍體重變；使用者不能改。
//   熱量 30 kcal/kg（輕度活動）；蛋白質 1.1 g/kg；脂肪占熱量 25%（0.83 g/kg）；碳水 4.5 g/kg（＝剩下的熱量，約 60%）；
//   飽和脂肪、糖各不超過熱量的 10%（0.33、0.75 g/kg）；膳食纖維每 1000 kcal 配 14g（0.42 g/kg）；
//   鈉 2400mg（國健署上限）；反式脂肪 2g（不超過熱量的 1%）。
//   有在重訓、想吃多一點，是到設定頁填「目標值」，不是改這裡。
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
].map((n) => ({ ...n, read: (row) => numOrNull(row[n.log]), target: (targets) => targets[n.log] ?? null }));

// 依體重自動算的標準值；算不出來（還沒有體重）就是 null
export const autoStandard = (n, weight) =>
  n.stdFixed ?? (n.stdPerKg != null && weight != null ? n.stdPerKg * weight : null);

// 維生素／礦物質／其他保健成分；rda = 每日建議量（國人膳食營養素參考攝取量，成年男性；銅用美國 RDA）。
// 存在 foods.micros（每 1 記錄單位）與 food_logs.micros（快照），要加新項目只要在這裡加一列。
export const MICROS = [
  // 依對身體的重要程度排（也是食物編輯框裡的順序）；最後幾項沒有官方的每日建議量，只顯示總量
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
  // 能量飲料、咖啡、可樂才有；其他食物留空不影響總計（2026-10-07 加）
  { key: 'taurine', label: '牛磺酸', unit: 'mg', digits: 0 },
  { key: 'caffeine', label: '咖啡因', unit: 'mg', digits: 0 },
  // 肌酸保健品才有（一匙約 3 g）；跟牛磺酸一樣只填有含的（2026-10-08 加）
  { key: 'creatine', label: '肌酸', unit: 'g', digits: 1 },
].map((m) => ({ ...m, read: (row) => numOrNull(row.micros?.[m.key]), target: () => m.rda ?? null }));

// 澱粉不用填也不存：包裝上不會標，用「碳水 − 糖 − 膳食纖維」估（台灣標示的碳水含纖維）。三個都有值才算得出來。
export const STARCH = {
  label: '澱粉（估）', unit: 'g', digits: 1, log: 'starch_g',
  read(row) {
    const [carb, sugar, fiber] = ['carb_g', 'sugar_g', 'fiber_g'].map((c) => numOrNull(row[c]));
    return [carb, sugar, fiber].some((v) => v == null) ? null : Math.max(0, round6(carb - sugar - fiber));
  },
  target: () => null,
};

export const nutrient = (log) => NUTRIENTS.find((n) => n.log === log);

// 食物編輯框、組合預覽列的順序：巨量營養，澱粉插在纖維後面
export const SHOWN_NUTRIENTS = [...NUTRIENTS.filter((n) => n.log !== 'sodium_mg'), STARCH, nutrient('sodium_mg')];

// 沒有官方建議量的項目：只顯示吃了多少（排在「今天總共」最後面；說明框那一行也是從這裡來）
export const INFO_ONLY = [STARCH, ...MICROS.filter((m) => m.rda == null)];

// 今日食物頁「今天總共」的順序：熱量、蛋白質最前面，接著越重要的越前面；
// 「上限」類（吃越少越好）排在必需營養素後面，沒有建議量的保健成分放最後。
export const TOTAL_ITEMS = [
  nutrient('kcal'), nutrient('protein_g'), nutrient('fat_g'), nutrient('carb_g'), nutrient('fiber_g'),
  ...MICROS.filter((m) => m.rda != null),
  nutrient('sodium_mg'), nutrient('sat_fat_g'), nutrient('sugar_g'), nutrient('trans_fat_g'),
  ...INFO_ONLY,
];

// ---- 食物 ----
// 沒填單位或蛋白質 → 待補，不能拿來記錄
export const isPending = (food) => !food.log_unit || food.protein_per_unit == null;

// g、ml 的營養用「每 100」輸入／顯示（營養標示就是這樣寫），存的是每 1 單位
export const per100 = (unit) => unit === 'g' || unit === 'ml';

// ---- 量 ----
const COLUMNS = ['cost', ...NUTRIENTS.map((n) => n.log)];
// 資料庫回來的 numeric 是字串，先轉成數字
function numOrNull(v) {
  return v === '' || v == null ? null : Number(v);
}
// 所有算出來的數字都用同一個精度（夠細，之後反推、再乘回去幾乎不掉精度）
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const scale = (value, factor) => (value == null ? null : round6(Number(value) * factor));

// 食物現在的資料 → 吃 1 個單位的量
export const perUnitOf = (food) => ({
  ...Object.fromEntries(NUTRIENTS.map((n) => [n.log, numOrNull(food[n.food])])),
  cost: numOrNull(food.cost_per_unit),
  micros: { ...(food.micros ?? {}) },
});

// 一份量（或一筆記錄）全部乘上 factor；只拿量的欄位，記錄裡的 id、日期那些不會帶過去
export function scaleAmounts(amounts, factor) {
  const scaled = Object.fromEntries(COLUMNS.map((c) => [c, scale(amounts[c], factor)]));
  scaled.micros = Object.fromEntries(Object.entries(amounts.micros ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, scale(v, factor)]));
  return scaled;
}

// 吃 qty 個單位的食物 → 這一筆的量（就是要存進記錄的快照欄位）
export const amountsOf = (food, qty) => scaleAmounts(perUnitOf(food), qty);

// 一項在好幾份量裡的總和；每一份都不知道才是 null
export function sumOf(item, rows) {
  const filled = rows.map((row) => item.read(row)).filter((v) => v != null);
  return filled.length ? round6(filled.reduce((sum, v) => sum + v, 0)) : null;
}

// 好幾份量加成一份（組合的一份、整鍋、一天）
export function sumAmounts(rows) {
  const total = Object.fromEntries(NUTRIENTS.map((n) => [n.log, sumOf(n, rows)]));
  total.cost = sumOf({ read: (row) => numOrNull(row.cost) }, rows);
  total.micros = {};
  for (const key of new Set(rows.flatMap((row) => Object.keys(row.micros ?? {})))) {
    const sum = sumOf({ read: (row) => numOrNull(row.micros?.[key]) }, rows);
    if (sum != null) total.micros[key] = sum;
  }
  return total;
}

// 組合（或食譜）「1 份」的量：每樣食物各自的量加起來，用食物現在的資料算；找不到的食物略過
export const comboAmounts = (items, foods) =>
  sumAmounts(items.flatMap((item) => {
    const food = foods.find((f) => f.id === item.food_id);
    return food ? [amountsOf(food, item.qty)] : [];
  }));

// 每 1 單位的量 → 食物的欄位（食譜存檔時自動建的那個食物）
export const foodFieldsOf = (perUnit) => ({
  ...Object.fromEntries(NUTRIENTS.map((n) => [n.food, perUnit[n.log]])),
  cost_per_unit: perUnit.cost,
  micros: { ...perUnit.micros },
});
