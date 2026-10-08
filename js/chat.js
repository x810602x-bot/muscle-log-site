// 問 Claude：跟家裡 NAS 上的 Claude 聊天。手機只跟 Supabase 講話：問題寫進 chat_messages，
// NAS 撈去問 Claude、再把回答寫回來，這裡每 3 秒看一次回答好了沒。
// 拍營養標示：Claude 的回答會附上填好的食物資料，按「加進食物庫」開平常的食物編輯框，使用者看過按儲存才存。
// 說吃了什麼：Claude 的回答會附上要記的清單，按 × 拿掉不對的，按「記進今天」一次記好（食物庫沒有的先用 Claude 估的營養建起來）。
import * as db from './db.js?v=1c6ea53';
import { $, esc, fmt, localDate, addDays, openDialog, toast, energyText } from './util.js?v=1c6ea53';
import { NUTRIENTS, MICROS, per100, isPending, amountsOf } from './nutrition.js?v=1c6ea53';
import * as catalog from './foods.js?v=1c6ea53';
import { logRow } from './today.js?v=1c6ea53';

const POLL_MS = 3000;              // 有問題在等回答時，多久看一次
const REFRESH_MS = 30 * 1000;      // 對話列表、NAS 狀態、開著的對話多久更新一次
const ONLINE_MS = 90 * 1000;       // NAS 超過這麼久沒回報就算休息中
const URL_TTL_MS = 50 * 60 * 1000; // 照片網址一小時失效，提早換新的
const MAX_IMAGES = 4;
const MAX_EDGE = 1600;             // 照片長邊縮到這麼大再上傳
const OFFLINE_TEXT = 'NAS 休息中（每天 10:00–01:00 開機），開機後會自動回答';

// 記住開著哪個對話、每個對話打到一半的字；只是方便用，存不了（無痕模式之類）就算了
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function keep(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存不了就算了 */ }
}

let sessions = [];
let current = load('chat-session', null); // 開著的對話 id；null＝新對話（送出第一句才建）
let messages = [];
let worker = null;  // NAS 的回報：{ last_seen, info }
let images = [];    // 還沒送出的照片：[{ blob, url }]
let sending = false;
let armed = null;   // 按了一次 × 的對話 id（再按一次才刪）
let armTimer, pollTimer;
let jump = true;    // 下一次畫訊息時捲到最下面（剛打開、剛送出）
const drafts = load('chat-drafts', {}); // 對話 id（新對話是 new）→ 打到一半的字
const added = new Set(); // 按過「加進食物庫」而且存好了的回答 id
const logged = new Map();  // 按過「記進今天」而且記好了的回答 id → { day, count }
const logging = new Set(); // 正在記的回答 id（按鈕先變灰，不會記兩次）
const dropped = new Map(); // 回答 id → 按 × 拿掉的是清單裡第幾樣（Set）
const made = new Map();    // 「回答 id:第幾樣」→ 已經存進食物庫的新食物（記到一半出錯，重按時用這個，不會再建一個）
const urls = new Map();  // 照片路徑 → 網址
let urlsAt = 0;
const drawn = { sessions: '', messages: '' }; // 上次畫的 HTML；一樣就不重畫，畫面才不會閃、不會跳

const text = $('#chat-text');
const draftKey = () => current ?? 'new';
text.value = drafts[draftKey()] ?? '';

const pageShown = () => !$('#page-chat').hidden && document.visibilityState === 'visible';
const online = () => worker != null && Date.now() - Date.parse(worker.last_seen) < ONLINE_MS;
const waiting = () => messages.some((m) => m.status === 'pending' || m.status === 'processing');

// NAS 開機時會試跑一次 Claude，結果寫在 info.self_test：
// { ok: false, … }、false、或不是 ok 開頭的字（例如 Illegal instruction）都算跑不起來
function claudeBroken(info) {
  const test = info?.self_test;
  return test === false || test?.ok === false || (typeof test === 'string' && !/^ok/i.test(test));
}

// 每點一次分頁都會叫一次：只更新資料，不動打到一半的字、不亂捲
export async function show() {
  grow();
  await Promise.all([catalog.refresh(), loadSessions(), loadWorker()]);
  if (current && !sessions.some((s) => s.id === current)) switchTo(null); // 在別的裝置刪掉了
  await loadMessages();
  render();
  schedulePoll();
}

// 選了照片、或正在送：App 先不要自動換新版（會重新載入，照片就不見了；打到一半的字有存起來，重新載入還在）
export const isBusy = () => sending || images.length > 0;

const loadSessions = async () => { sessions = await db.listChatSessions(); };
const loadWorker = async () => { worker = await db.getWorkerStatus(); };

async function loadMessages() {
  const id = current;
  const rows = id ? await db.listChatMessages(id) : [];
  if (Date.now() - urlsAt > URL_TTL_MS) {
    urls.clear();
    urlsAt = Date.now();
  }
  const missing = rows.flatMap((m) => m.image_paths).filter((path) => !urls.has(path));
  if (missing.length) for (const [path, url] of Object.entries(await db.signedChatImageUrls(missing))) urls.set(path, url);
  if (id === current) messages = rows; // 等的時候換了對話，就不要蓋掉
}

// 背景更新：出錯只記在 console，不跳錯誤提示（手機網路斷一下很正常）
async function quietly(...loads) {
  try {
    await Promise.all(loads.map((fn) => fn()));
    render();
  } catch (err) {
    console.warn(err);
  }
}

// 開著的對話有問題在等回答：每 3 秒看一次。切到別頁或手機關螢幕就停，回來 show() 會再接上
function schedulePoll() {
  clearTimeout(pollTimer);
  if (waiting() && pageShown()) pollTimer = setTimeout(() => quietly(loadMessages, loadWorker).then(schedulePoll), POLL_MS);
}
// 開著的對話也一起重抓：照片網址一小時會失效，順便換新；別的裝置問的也會出現
setInterval(() => {
  if (pageShown()) quietly(loadSessions, loadMessages, loadWorker).then(schedulePoll);
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (pageShown()) quietly(loadSessions, loadMessages, loadWorker).then(schedulePoll);
});

// 換到某個對話（null＝新對話）：打到一半的字跟著換
function switchTo(id) {
  current = id;
  keep('chat-session', id);
  messages = [];
  text.value = drafts[draftKey()] ?? '';
  grow();
  jump = true;
}

async function openSession(id) {
  switchTo(id);
  render();
  await loadMessages();
  render();
  schedulePoll();
}

function render() {
  renderStatus();
  renderSessions();
  renderMessages();
  $('#chat-send').disabled = sending || waiting();
}

function renderStatus() {
  const broken = online() && claudeBroken(worker.info);
  const el = $('#chat-nas');
  el.className = `nas-status ${broken ? 'broken' : online() ? 'on' : 'off'}`;
  el.textContent = broken ? 'NAS 上的 Claude 跑不起來' : online() ? 'NAS 在線' : 'NAS 休息中';
}

// 今天的寫幾點幾分，昨天寫「昨天」，再早寫日期
function whenText(iso) {
  const d = new Date(iso);
  const day = localDate(d);
  if (day === localDate()) return d.toTimeString().slice(0, 5);
  if (day === addDays(localDate(), -1)) return '昨天';
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

// 對話列表：電腦在左邊、手機在「對話」彈窗裡，兩邊一模一樣
function renderSessions() {
  const html = sessions.map((s) => `<li class="chat-session${s.id === current ? ' current' : ''}">
      <button type="button" class="chat-session-open" data-open="${s.id}">
        <span class="chat-session-title">${esc(s.title)}</span>
        <span class="chat-session-time">${whenText(s.updated_at)}</span>
      </button>
      <button type="button" class="chat-session-del${s.id === armed ? ' armed' : ''}" data-del="${s.id}" aria-label="刪除這個對話">${s.id === armed ? '刪除？' : '×'}</button>
    </li>`).join('') || '<li class="empty">還沒有對話</li>';
  if (html === drawn.sessions) return;
  drawn.sessions = html;
  $('#chat-sessions').innerHTML = $('#chat-sessions-sheet').innerHTML = html;
}

// Claude 的回答是 Markdown：轉成 HTML 後一定要過 DOMPurify 才放進畫面。連結開新分頁，App 才不會被換掉
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener');
});
// 只留文字排版用得到的：圖片、樣式這類一畫出來就會自己連外部網站（可能把資料帶出去）或改到整個 App 的都不要
const MD_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];
const markdown = (md) => DOMPurify.sanitize(marked.parse(md, { breaks: true }), { ALLOWED_TAGS: MD_TAGS, ALLOWED_ATTR: ['href', 'title', 'align', 'start'], ALLOW_DATA_ATTR: false });

function renderMessages() {
  const html = current ? messages.map(messageHtml).join('')
    : '<li class="empty">健身、飲食的問題都可以問，Claude 看得到你的食物庫、最近吃的跟體重。<br>拍營養標示傳過來，Claude 會填好食物資料，按「加進食物庫」看過再存。<br>說你吃了什麼，Claude 會整理成清單，按「記進今天」就記好了。</li>';
  if (html === drawn.messages) return;
  const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 120;
  drawn.messages = html;
  $('#chat-messages').innerHTML = html;
  if (jump || atBottom) scrollTo(0, document.documentElement.scrollHeight);
  if (messages.length) jump = false;
}

function messageHtml(m) {
  if (m.role === 'assistant') {
    return `<li class="msg assistant">${m.content ? `<div class="bubble md">${markdown(m.content)}</div>` : ''}${draftHtml(m)}${logDraftHtml(m)}</li>`;
  }
  // 照片點了開原圖（新分頁）；網址還沒拿到的先留一個灰框
  const pics = m.image_paths.map((path) => {
    const url = urls.get(path);
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="附圖" width="96" height="96"></a>` : '<span class="img-missing"></span>';
  }).join('');
  return `<li class="msg user">
      ${pics ? `<div class="msg-images">${pics}</div>` : ''}
      ${m.content ? `<div class="bubble">${esc(m.content)}</div>` : ''}
      ${statusHtml(m)}
    </li>`;
}

// 提問下面的小字：等回答中（NAS 在不在線）、或出錯了＋重送
function statusHtml(m) {
  if (m.status === 'done') return '';
  if (m.status === 'error') {
    return `<p class="msg-status error">${esc(m.error || 'Claude 出錯了')}<button type="button" class="btn ghost small" data-retry="${m.id}">重送</button></p>`;
  }
  return `<p class="msg-status">${online() ? 'Claude 思考中…' : OFFLINE_TEXT}</p>`;
}

// 回答下面的食物卡：名稱、熱量跟蛋白質（g、ml 每 100，其餘每 1 單位，跟食物編輯框一樣）
function draftHtml(m) {
  const d = m.food_draft;
  if (!d?.name) return '';
  const basis = per100(d.log_unit) ? `每 100${d.log_unit}` : `每${d.log_unit || '單位'}`;
  const done = added.has(m.id);
  const same = !done && catalog.activeFoods().some((f) => f.name === d.name);
  return `<div class="card draft-card">
      <span class="draft-main">
        <b>${esc(d.name)}</b>
        <span class="hint">${esc(basis)} · ${energyText(d.values?.kcal_per_unit, d.values?.protein_per_unit)}</span>
        ${same ? '<span class="hint same-name">食物庫已有同名食物</span>' : ''}
      </span>
      <button type="button" class="btn ${done ? 'ghost' : 'primary'} small" data-draft="${m.id}"${done ? ' disabled' : ''}>${done ? '已加入 ✓' : '加進食物庫'}</button>
    </div>`;
}

// Claude 填的數字跟食物編輯框上看到的一樣（g、ml 每 100，其餘每 1 單位），存的是每 1 單位，所以先換算
function draftFood(draft) {
  const per = per100(draft.log_unit) ? 100 : 1;
  const food = { name: draft.name, log_unit: draft.log_unit, is_supplement: !!draft.is_supplement, micros: {} };
  for (const n of NUTRIENTS) food[n.food] = typeof draft.values?.[n.food] === 'number' ? draft.values[n.food] / per : null;
  for (const m of MICROS) if (typeof draft.micros?.[m.key] === 'number') food.micros[m.key] = draft.micros[m.key] / per;
  for (const key of ['store', 'paid_price', 'price', 'price_label', 'note']) food[key] = draft[key];
  food.cost_per_unit = catalog.costPerUnit(draft.price, draft.price_label, draft.log_unit); // 編輯框存檔時會自己算；「記進今天」直接存，所以先算好
  return food;
}

// ---- 記進今天：Claude 整理的清單（log_draft）----
// 「今天」或「10/7」
const dayText = (day) => (day === localDate() ? '今天' : ` ${new Date(`${day}T00:00`).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}`);

// 沒說哪天、幾點＝Claude 回答的那時候（不是按的那時候：半夜過了才按、隔幾天才按，都還是記在那天）
const logAt = (m) => new Date(m.created_at);
const logDay = (m) => m.log_draft.date ?? localDate(logAt(m));

// 清單裡的一樣 → 要記的食物（新食物還沒存、沒有 id，按「記進」才存）跟不能記的原因
function logItem(item, key) {
  const d = item.new_food;
  // 新食物在食物庫已經有同名、同單位的就用那個，不再建一個（單位不同不能用：qty 是照新食物的單位）
  const food = d ? made.get(key) ?? catalog.activeFoods().find((f) => f.name === d.name && f.log_unit === d.log_unit) ?? draftFood(d)
    : catalog.activeFoods().find((f) => f.id === item.food_id);
  const skip = !food ? '食物庫找不到' : isPending(food) ? '待補，不能記' : '';
  return { food, qty: item.qty, name: food?.name ?? item.name, unit: food?.log_unit ?? item.log_unit, skip };
}
// 還沒按 × 拿掉的那幾樣（i＝清單裡第幾樣）
const logItems = (m) => m.log_draft.items.map((item, i) => ({ ...logItem(item, `${m.id}:${i}`), i })).filter(({ i }) => !dropped.get(m.id)?.has(i));

// 回答下面的「要記進今天」卡：每樣寫名稱（新食物加「新」）、吃多少、這個量的熱量跟蛋白質，× 拿掉；記好了只留一行
function logDraftHtml(m) {
  const d = m.log_draft;
  if (!d?.items?.length) return '';
  const done = logged.get(m.id) ?? (m.log_done_at && { day: logDay(m) });
  if (done) return `<div class="card log-draft"><p class="log-draft-head">已記進${esc(dayText(done.day))} ✓${done.count ? `（${done.count} 樣）` : ''}</p></div>`;
  const day = dayText(logDay(m));
  const items = logItems(m);
  const rows = items.map(({ food, qty, name, unit, skip, i }) => {
    const amounts = skip ? null : amountsOf(food, qty);
    return `<div class="combo-item">
        <span class="draft-main">
          <b>${esc(name)}${food && !food.id ? ' <span class="badge">新</span>' : ''}</b>
          <span class="hint${skip ? ' skip' : ''}">${skip || energyText(amounts.kcal, amounts.protein_g)}</span>
        </span>
        <span class="meal-qty">${fmt(qty, 2)} ${esc(unit ?? '')}</span>
        <button type="button" class="icon-btn" data-drop="${m.id}:${i}" aria-label="拿掉這樣">×</button>
      </div>`;
  }).join('');
  const busy = logging.has(m.id) || !items.some((item) => !item.skip);
  return `<div class="card log-draft">
      <p class="log-draft-head"><b>要記進${esc(day)}</b>${d.time ? ` ${esc(d.time)}` : ''}</p>
      <div>${rows}</div>
      <button type="button" class="btn primary small" data-log-draft="${m.id}"${busy ? ' disabled' : ''}>記進${esc(day)}</button>
    </div>`;
}

// 按「記進今天」：新食物先存進食物庫（備註 Claude 估計），再用今日食物頁同一個 logRow() 一次記好，
// 最後在回答上蓋「記過了」，重新整理也不會再記一次
async function logDraft(m) {
  if (logging.has(m.id) || logged.has(m.id) || m.log_done_at) return;
  const items = logItems(m).filter((item) => !item.skip);
  if (!items.length) return;
  const day = logDay(m);
  const time = m.log_draft.time ?? logAt(m).toTimeString().slice(0, 5);
  const fresh = items.some(({ food }) => !food.id);
  logging.add(m.id);
  renderMessages();
  try {
    const rows = [];
    for (const { food, qty, i } of items) {
      const saved = food.id ? food : await db.saveFood(food);
      if (!food.id) made.set(`${m.id}:${i}`, saved);
      rows.push(logRow(saved, qty, time, null, day));
    }
    await db.addLog(rows);
    logged.set(m.id, { day, count: rows.length }); // 記好了：下面蓋章就算失敗，這次也不會再讓人按第二次
    await db.markChatLogDone(m.id);
    toast(`已記進${dayText(day)}（${rows.length} 樣）`);
  } finally {
    logging.delete(m.id);
    renderMessages();
    if (fresh) catalog.refresh().then(renderMessages, console.warn); // 新食物進了食物庫，其他頁的清單也要有
  }
}

$('#chat-messages').addEventListener('click', async (e) => {
  const retry = e.target.closest('[data-retry]');
  if (retry) {
    await db.retryChatMessage(retry.dataset.retry);
    await loadMessages();
    render();
    return schedulePoll();
  }
  const drop = e.target.closest('[data-drop]');
  if (drop) {
    const [id, i] = drop.dataset.drop.split(':');
    dropped.set(id, (dropped.get(id) ?? new Set()).add(Number(i)));
    return renderMessages();
  }
  const log = e.target.closest('[data-log-draft]');
  if (log) return logDraft(messages.find((msg) => msg.id === log.dataset.logDraft));
  const add = e.target.closest('[data-draft]');
  if (!add) return;
  const m = messages.find((msg) => msg.id === add.dataset.draft);
  if (!await catalog.openFoodEditor(draftFood(m.food_draft))) return;
  added.add(m.id);
  toast('已加進食物庫');
  renderMessages();
});

// ---- 對話列表 ----
// 刪對話：按 × 變紅色「刪除？」，再按一次才刪；按別的地方或 3 秒沒按就變回來。
// 不用確認框：設計規定點框外面＝按主要按鈕，會變成點外面就刪掉
function arm(id) {
  armed = id;
  clearTimeout(armTimer);
  armTimer = setTimeout(disarm, 3000);
  renderSessions();
}
function disarm() {
  clearTimeout(armTimer);
  armed = null;
  renderSessions();
}
document.addEventListener('click', (e) => {
  if (armed && !e.target.closest(`[data-del="${armed}"]`)) disarm();
}, true);

async function removeSession(id) {
  disarm();
  await db.deleteChatSession(id);
  delete drafts[id];
  keep('chat-drafts', drafts);
  if (id === current) switchTo(null);
  await loadSessions();
  render();
}

for (const list of [$('#chat-sessions'), $('#chat-sessions-sheet')]) {
  list.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) return armed === del.dataset.del ? removeSession(armed) : arm(del.dataset.del);
    const row = e.target.closest('[data-open]');
    if (!row) return;
    $('#chat-list-dialog').close();
    await openSession(row.dataset.open);
  });
}
$('#chat-list-btn').addEventListener('click', () => $('#chat-list-dialog').showModal());
for (const btn of document.querySelectorAll('[data-chat-new]')) {
  btn.addEventListener('click', () => {
    switchTo(null);
    render();
    text.focus();
  });
}

// ---- 個人檔案（Claude 每次回答都會參考）----
// 每次打開都重抓（NAS 可能剛寫過）；抓不到就不打開，免得點外面把空白存回去、蓋掉原本的
$('#chat-profile-btn').addEventListener('click', async () => {
  const box = $('#chat-profile-text');
  box.value = await db.getChatProfile();
  if (await openDialog($('#chat-profile-dialog')) !== 'ok') return;
  await db.saveChatProfile(box.value);
  toast('個人檔案已儲存');
});

// ---- 輸入框 ----
// 跟著字變高（最高到 CSS 的 max-height，之後裡面捲）
function grow() {
  text.style.height = 'auto';
  text.style.height = `${text.scrollHeight + 2}px`;
}
function saveDraft() {
  if (text.value) drafts[draftKey()] = text.value; else delete drafts[draftKey()];
  keep('chat-drafts', drafts);
}
text.addEventListener('input', () => {
  grow();
  saveDraft();
});
// Enter 換行；Ctrl／Cmd＋Enter 送出
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('#chat-composer').requestSubmit();
  }
});
$('#chat-composer').addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});

function renderComposer() {
  $('#chat-thumbs').hidden = !images.length;
  $('#chat-thumbs').innerHTML = images.map((img, i) =>
    `<span class="chat-thumb"><img src="${img.url}" alt=""><button type="button" data-remove="${i}" aria-label="拿掉這張照片">×</button></span>`).join('');
  $('#chat-send').disabled = sending || waiting(); // 開著的對話還在等回答就先不能再問：回答才不會排錯順序、Claude 才看得到上一個回答
  $('#chat-photo').disabled = sending || images.length >= MAX_IMAGES;
  text.readOnly = sending; // 送出中打的字送完會被清掉，先不給打
}

// 新對話送出第一句才建對話（標題＝第一句的前 30 字，只有照片就叫「照片」）；送不出去打的字跟照片都留著
async function send() {
  const content = text.value.trim();
  if (sending || waiting() || (!content && !images.length)) return;
  sending = true;
  renderComposer();
  try {
    let sessionId = current;
    if (!sessionId) {
      sessionId = (await db.createChatSession([...content.replace(/\s+/g, ' ')].slice(0, 30).join('') || '照片')).id;
      delete drafts.new;
      current = sessionId;
      keep('chat-session', current);
      saveDraft(); // 萬一下面失敗，打的字記在新對話底下
    }
    const paths = [];
    for (const { blob } of images) paths.push(await db.uploadChatImage(sessionId, blob));
    await db.addChatMessage({ session_id: sessionId, content, image_paths: paths });
    // 上傳照片時換到別的對話了：只清掉送出的這個對話的草稿，不動畫面上那個對話打到一半的字
    delete drafts[sessionId];
    keep('chat-drafts', drafts);
    if (current === sessionId) {
      text.value = '';
      grow();
    }
    for (const img of images) URL.revokeObjectURL(img.url);
    images = [];
  } catch (err) {
    console.error(err);
    toast(`送不出去：${err.message}`);
    return;
  } finally {
    sending = false;
    renderComposer();
  }
  jump = true;
  await quietly(loadSessions, loadMessages);
  schedulePoll();
}

// ---- 照片：最多 4 張，縮到長邊 1600、存成 JPEG（品質 0.85）再上傳 ----
$('#chat-photo').addEventListener('click', () => $('#chat-file').click());
$('#chat-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = ''; // 同一張可以再選一次
  const room = MAX_IMAGES - images.length;
  if (files.length > room) toast(`一次最多 ${MAX_IMAGES} 張照片`);
  for (const file of files.slice(0, room)) {
    const blob = await shrink(file);
    images.push({ blob, url: URL.createObjectURL(blob) });
    renderComposer();
  }
});
$('#chat-thumbs').addEventListener('click', (e) => {
  const i = e.target.closest('[data-remove]')?.dataset.remove;
  if (i == null) return;
  URL.revokeObjectURL(images[i].url);
  images.splice(i, 1);
  renderComposer();
});

// 手機直拍的照片要照 EXIF 轉正
async function shrink(file) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadImage(file));
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('照片轉檔失敗'))), 'image/jpeg', 0.85));
}
// createImageBitmap 讀不了的（舊的 Safari）改用 <img> 讀；<img> 本來就會照 EXIF 轉正
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new Error('這張照片打不開'));
    img.src = URL.createObjectURL(file);
  });
}
