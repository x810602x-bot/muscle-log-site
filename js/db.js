// 所有 Supabase 讀寫都集中在這裡
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=087c7e0';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
let uid = null;

function ok({ data, error }) {
  if (error) throw error;
  return data;
}

// ---- 登入 ----
// 登入狀態一有變動就叫 cb（開啟時的第一次、Google 回跳、token 換新、在別的分頁登出）。
// 回呼裡不要直接 await 別的 supabase 呼叫，會卡住，所以丟到 setTimeout 外面跑。
export function onAuth(cb) {
  sb.auth.onAuthStateChange((_event, session) => {
    uid = session?.user?.id ?? null;
    setTimeout(() => cb(session), 0);
  });
}
export const signInWithGoogle = async () => ok(await sb.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: location.origin + location.pathname },
}));
export const signOut = () => sb.auth.signOut();
// 這個信箱在不在白名單（public.allowed_emails）
export const amIAllowed = async () => ok(await sb.rpc('i_am_allowed'));

// ---- 食物 ----
export const listFoods = async () => ok(await sb.from('foods').select('*').order('name'));

export async function saveFood(food) {
  const { id, ...fields } = food;
  const q = id ? sb.from('foods').update(fields).eq('id', id) : sb.from('foods').insert({ ...fields, user_id: uid });
  return ok(await q.select().single());
}

// ---- 組合 ----
export const listCombos = async () => ok(await sb.from('combos').select('*').order('name'));

export async function saveCombo(combo) {
  const { id, ...fields } = combo;
  const q = id ? sb.from('combos').update(fields).eq('id', id) : sb.from('combos').insert({ ...fields, user_id: uid });
  return ok(await q.select().single());
}

// ---- 每日記錄 ----
export const listLogs = async (date) =>
  ok(await sb.from('food_logs').select('*, foods(name, log_unit)').eq('log_date', date).order('created_at'));

// 可以一次加一筆，或一次加一整組（組合）
export const addLog = async (logs) =>
  ok(await sb.from('food_logs').insert([].concat(logs).map((log) => ({ ...log, user_id: uid }))));
export const updateLog = async (id, patch) => ok(await sb.from('food_logs').update(patch).eq('id', id));
export const deleteLog = async (id) => ok(await sb.from('food_logs').delete().eq('id', id));

// 最近吃過什麼（排「常吃、最近吃」用）
export const recentLogs = async (sinceDate) =>
  ok(await sb.from('food_logs').select('food_id, log_date, qty').gte('log_date', sinceDate).order('created_at'));

// 每日總計；sinceDate 為 null 表示全部
export async function dailyTotals(sinceDate) {
  let q = sb.from('daily_totals').select('log_date, protein_g, kcal').order('log_date');
  if (sinceDate) q = q.gte('log_date', sinceDate);
  return ok(await q);
}

// ---- 當日備註 ----
export async function getDayNote(date) {
  const row = ok(await sb.from('day_notes').select('note').eq('note_date', date).maybeSingle());
  return row?.note ?? '';
}
// 清空就是刪掉那一天的備註
export const saveDayNote = async (date, note) => ok(note
  ? await sb.from('day_notes').upsert({ user_id: uid, note_date: date, note })
  : await sb.from('day_notes').delete().eq('note_date', date));
export const listDayNotes = async () => ok(await sb.from('day_notes').select('note_date, note'));

// ---- 身體記錄 ----
export const listBodyRecords = async () =>
  ok(await sb.from('body_records').select('*').order('measured_at', { ascending: false }));

// 某一天（本地時區）量的記錄
export async function bodyRecordsOn(date) {
  const start = new Date(`${date}T00:00`).getTime();
  return ok(await sb.from('body_records').select('*')
    .gte('measured_at', new Date(start).toISOString()).lt('measured_at', new Date(start + 86400e3).toISOString())
    .order('measured_at'));
}

// 最新一筆有體重的歐姆龍記錄：{ weight, measured_at }，沒有就是 null
export async function latestWeight() {
  const row = ok(await sb.from('body_records').select('weight, measured_at').not('weight', 'is', null)
    .order('measured_at', { ascending: false }).limit(1).maybeSingle());
  return row && { weight: Number(row.weight), measured_at: row.measured_at };
}

// 同一個測量時間只會存一筆；回傳新增幾筆、略過幾筆
export async function importBodyRecords(rows) {
  const added = ok(await sb.from('body_records')
    .upsert(rows.map((r) => ({ ...r, user_id: uid })), { onConflict: 'user_id,measured_at', ignoreDuplicates: true })
    .select('id'));
  return { added: added.length, skipped: rows.length - added.length };
}

// ---- 設定 ----
export async function getSettings() {
  const row = ok(await sb.from('settings').select('*').maybeSingle());
  return row ?? { targets: {} };
}
export const saveSettings = async (patch) =>
  ok(await sb.from('settings').upsert({ ...patch, user_id: uid }));
