// 所有 Supabase 讀寫都集中在這裡
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=1c6ea53';
import { NUTRIENTS } from './nutrition.js?v=1c6ea53';

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
// 刪食物前先數有幾筆記錄用到它（用過的不能刪，只能封存）
export async function countFoodLogs(foodId) {
  const { count, error } = await sb.from('food_logs').select('id', { count: 'exact', head: true }).eq('food_id', foodId);
  if (error) throw error;
  return count;
}
export const deleteFood = async (id) => ok(await sb.from('foods').delete().eq('id', id));

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

// 最近吃過什麼（選食物的格子「最後記的排第一」、數量框帶上次的量用）
export const recentLogs = async (sinceDate) =>
  ok(await sb.from('food_logs').select('food_id, combo_id, qty, created_at, logged_at').gte('log_date', sinceDate).order('created_at'));

// 某天以後的所有記錄，只拿日期跟營養欄位（歷史頁把每一天加總用）；sinceDate 為 null 表示全部
export async function logsSince(sinceDate) {
  let q = sb.from('food_logs').select(['log_date', ...NUTRIENTS.map((n) => n.log)].join(', ')).order('log_date');
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

// ---- 問 Claude ----
// 手機只把問題寫進來（status = pending），家裡的 NAS 撈去問 Claude、再把回答寫回來
export const listChatSessions = async () =>
  ok(await sb.from('chat_sessions').select('id, title, updated_at').order('updated_at', { ascending: false }));
export const createChatSession = async (title) =>
  ok(await sb.from('chat_sessions').insert({ title, user_id: uid }).select().single());

// 先刪掉對話資料夾（<user_id>/<對話 id>/）裡的照片，連送失敗、沒掛到訊息上的也一起；再刪對話（訊息會跟著一起刪）
export async function deleteChatSession(id) {
  const folder = `${uid}/${id}`;
  const files = ok(await sb.storage.from('chat-images').list(folder, { limit: 1000 }));
  if (files.length) ok(await sb.storage.from('chat-images').remove(files.map((f) => `${folder}/${f.name}`)));
  return ok(await sb.from('chat_sessions').delete().eq('id', id));
}

// 回答上會帶 food_draft（加進食物庫）、log_draft（記進今天的清單）、log_done_at（按過「記進今天」的時間）
export const listChatMessages = async (sessionId) =>
  ok(await sb.from('chat_messages').select('*').eq('session_id', sessionId).order('created_at'));
// 只能新增自己的提問；狀態只有 NAS 改得了，出錯要重送走 retry_chat_message
export const addChatMessage = async ({ session_id, content, image_paths }) =>
  ok(await sb.from('chat_messages').insert({ session_id, content, image_paths, role: 'user', status: 'pending', user_id: uid }));
export const retryChatMessage = async (id) => ok(await sb.rpc('retry_chat_message', { p_id: id }));
// 「記進今天」按過了：蓋上時間，重新整理也不會再記一次（只能改自己的回答，走 mark_chat_log_done）
export const markChatLogDone = async (id) => ok(await sb.rpc('mark_chat_log_done', { p_id: id }));

// 照片放私有的 chat-images：<user_id>/<對話 id>/<隨機>.jpg，回傳路徑
export async function uploadChatImage(sessionId, blob) {
  const path = `${uid}/${sessionId}/${crypto.randomUUID()}.jpg`;
  ok(await sb.storage.from('chat-images').upload(path, blob, { contentType: 'image/jpeg' }));
  return path;
}
// 路徑 → 一小時內有效的網址 { 路徑: 網址 }
export async function signedChatImageUrls(paths) {
  const rows = ok(await sb.storage.from('chat-images').createSignedUrls(paths, 3600));
  return Object.fromEntries(rows.filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]));
}

// NAS 每 30 秒回報一次：{ last_seen, info }，從來沒回報過是 null
export const getWorkerStatus = async () =>
  ok(await sb.from('worker_status').select('last_seen, info').eq('id', 'nas').maybeSingle());

// 個人檔案（一人一份）：Claude 每次回答都會參考；在聊天裡說「記住…」時 NAS 也會整份改寫
export async function getChatProfile() {
  const row = ok(await sb.from('chat_profiles').select('content').maybeSingle());
  return row?.content ?? '';
}
export const saveChatProfile = async (content) =>
  ok(await sb.from('chat_profiles').upsert({ user_id: uid, content, updated_at: new Date().toISOString() }));
