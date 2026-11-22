// 要寫進資料庫的一筆怎麼組（純函式：沒有畫面、沒有資料庫，用 node 就能測）。
// 網站（今日食物頁、問 Claude 的卡片）跟家裡電腦上回答的程式（勲助理直接記，nas/direct.js）共用這一份，
// 兩邊記出來才會一模一樣（2026-11-22 T007 從 today.js、chat.js、ent.js 搬過來，算法沒改）。
import { NUTRIENTS, MICROS, per100, isPending, amountsOf, costPerUnit } from './nutrition.js?v=d3a5e70';

// ---- 飲食記錄 ----
// 記錄時間只留整點跟半點（四捨五入到最近的半小時，最晚 23:30）：同半小時記的東西會是同一個時間，自然算同一批
export const snapTime = (time) => {
  const [h, m] = time.split(':').map(Number);
  const mins = Math.min(Math.round((h * 60 + m) / 30) * 30, 23 * 60 + 30);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};
// day 那天的 time → created_at。tz 是空的＝這台裝置的時區（網站）；電腦上的程式傳 '+08:00'（台灣），不靠電腦的時區設定
export const atTime = (time, day, tz = '') => new Date(`${day}T${snapTime(time)}${tz}`).toISOString();
// 一種食物吃 qty 個單位 → 一筆記錄（量的欄位就是快照）。今日食物頁、問 Claude 的「記進今天」、勲助理直接記都用這個
export function logRow(food, qty, time, comboId, day, tz = '') {
  return { log_date: day, food_id: food.id, qty, created_at: atTime(time, day, tz), combo_id: comboId, ...amountsOf(food, qty) };
}

// Claude 填的數字跟食物編輯框上看到的一樣（g、ml 每 100，其餘每 1 單位），存的是每 1 單位，所以先換算
export function draftFood(draft) {
  const per = per100(draft.log_unit) ? 100 : 1;
  const food = { name: draft.name, log_unit: draft.log_unit, is_supplement: !!draft.is_supplement, micros: {} };
  for (const n of NUTRIENTS) food[n.food] = typeof draft.values?.[n.food] === 'number' ? draft.values[n.food] / per : null;
  for (const m of MICROS) if (typeof draft.micros?.[m.key] === 'number') food.micros[m.key] = draft.micros[m.key] / per;
  for (const key of ['store', 'paid_price', 'price', 'price_label', 'note']) food[key] = draft[key];
  food.cost_per_unit = costPerUnit(draft.price, draft.price_label, draft.log_unit); // 編輯框存檔時會自己算；「記進今天」直接存，所以先算好
  return food;
}

// 「記進今天」清單（log_draft）裡的一樣 → 要記的食物；foods＝食物庫裡沒封存的。
// 新食物（new_food）在食物庫已經有同名、同單位的就用那個，不再建一個（單位不同不能用：qty 是照新食物的單位）；
// 沒有就是還沒存的新食物（沒有 id，記之前要先存進食物庫）。找不到是 undefined
export const logFoodOf = (item, foods) => (item.new_food
  ? foods.find((f) => f.name === item.new_food.name && f.log_unit === item.new_food.log_unit) ?? draftFood(item.new_food)
  : foods.find((f) => f.id === item.food_id));
// 不能記的原因（能記是空字串）
export const logSkip = (food) => (!food ? '食物庫找不到' : isPending(food) ? '待補，不能記' : '');

// ---- 看診記錄（就醫紀錄頁；資料表叫 ent_logs，是舊名）----
export const ENT_FIELDS = ['clinic', 'doctor', 'reason', 'diagnosis', 'exam', 'treatment', 'surgery', 'surgery_note'];

// 問 Claude 的助理整理好的看診記錄 → 要寫的那一筆（記錄框先填好的值）。logs＝這個人的看診記錄（新→舊）；dayOf：時間 → 'YYYY-MM-DD'。
// draft.id 是要改的那一筆舊記錄（還在才算）。沒有的話，同一天、同一家診所已經有一筆就改那一筆，都沒有才新增：
// 同一次看診助理可能出兩張卡片（前一張還沒存，助理不知道代號），兩張都按會記成兩筆（2026-11-18 薇的帳號遇過）
export function entPrefill(draft, logs, dayOf) {
  const sameVisit = (l) => dayOf(l.logged_at) === draft.date && (l.details?.clinic ?? '').trim() === (draft.clinic ?? '').trim();
  const old = logs.find((l) => l.id === draft.id) ?? logs.find(sameVisit);
  if (!old) return { logged_at: `${draft.date}T12:00`, details: draft, note: draft.note };
  // 改舊的那一筆：先放原本的內容，草稿有寫的欄位才蓋上去。不然草稿沒提到的欄位會變空白，點外面就存掉了
  return {
    id: old.id, logged_at: draft.date ? `${draft.date}T12:00` : old.logged_at,
    details: { ...old.details, ...draft }, note: draft.note ?? old.note,
  };
}

// 一筆看診記錄 → 記錄框每一格要填的字（date、note、ENT_FIELDS）；l 是 null＝新的一筆，日期填今天
export function entForm(l, dayOf) {
  const d = l?.details ?? {};
  return { date: dayOf(l ? l.logged_at : new Date()), ...Object.fromEntries(ENT_FIELDS.map((f) => [f, d[f] ?? ''])), note: l?.note ?? '' };
}

// 記錄框按儲存時存進去的那一筆（不含 id）：日期存那天中午，每一格去掉前後空白、空的存 null
export const entRow = (form, tz = '') => ({
  logged_at: new Date(`${form.date}T12:00${tz}`).toISOString(),
  severity: null,
  details: Object.fromEntries(ENT_FIELDS.map((f) => [f, form[f].trim() || null])),
  note: form.note.trim() || null,
});
