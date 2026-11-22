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

// 食物、組合、記錄共用的一列：標題（可帶徽章）＋灰字副標＋右邊那塊。
// title／sub／side 是 HTML，呼叫的人自己 esc()；attrs 放 data-*（點下去要認哪一筆）
export const rowHtml = ({ cls = '', attrs = '', title, sub, side = '' }) =>
  `<li><button class="row${cls ? ` ${cls}` : ''}" ${attrs}>
      <span class="row-main">
        <span class="row-title">${title}</span>
        <span class="row-sub">${sub}</span>
      </span>${side}
    </button></li>`;

// 組合到哪裡都是這個藍色徽章（今日食物的選食物格子、已經記的、食物庫）
export const comboBadge = '<span class="badge combo">組合</span>';

// 今日食物頁所有小卡的小灰字都只寫熱量跟蛋白質；其他營養點進去（數量框）看
export const energyText = (kcal, protein) => `熱量 ${fmt(kcal, 0)} kcal · 蛋白質 ${fmt(protein)} g`;

// 一組營養數字 → <dt>/<dd>；沒資料的項目顯示「—」。noteOf 可以在數字下面再加一行小字
export const nutrientCells = (items, valueOf, noteOf = () => '') => items.map((n) => {
  const value = valueOf(n);
  return `<div><dt>${n.label}</dt><dd>${value == null ? '—' : `${fmt(value, n.digits)}<small>${n.unit}</small>`}</dd>${noteOf(n, value)}</div>`;
}).join('');

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
