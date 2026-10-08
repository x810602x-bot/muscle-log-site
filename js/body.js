import * as db from './db.js?v=1c6ea53';
import { $, esc, fmt, localDate } from './util.js?v=1c6ea53';

// 資料表欄位 ← 歐姆龍匯出檔的欄名（其餘欄位整列保留在 raw）
const COLUMNS = {
  weight: '體重(kg)', body_fat_pct: '體脂肪(%)', fat_mass: '體脂肪量(kg)', visceral: '內臟脂肪程度',
  bmr: '基礎代謝(kcal)', muscle_pct: '骨骼肌(%)', muscle_kg: '骨骼肌重量(kg)', bmi: 'BMI', body_age: '身體年齡(歲)',
};

// "2026/08/08 11:21" + "Asia/Taipei" → "2026-08-08T11:21:00+08:00"
function toTimestamp(local, timeZone) {
  const iso = local.trim().replace(/\//g, '-').replace(' ', 'T');
  const offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${iso}Z`)).find((p) => p.type === 'timeZoneName').value.slice(3) || '+00:00';
  return `${iso}:00${offset}`;
}

function parseOmron(text) {
  const { data } = Papa.parse(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
  if (!data.length || !('測量日期' in data[0])) throw new Error('這不是歐姆龍匯出的檔案');
  return data.map((row) => {
    const record = { measured_at: toTimestamp(row['測量日期'], row['時區']), raw: row };
    for (const [column, header] of Object.entries(COLUMNS)) {
      record[column] = row[header] === '' || row[header] == null ? null : Number(row[header]);
    }
    return record;
  });
}

// 畫面上會用到的歐姆龍欄位（歷史頁的線跟表格、每一筆的大字都照這份；體脂肪量 kg、骨骼肌率 % 存著但不顯示）
export const BODY_FIELDS = [
  { key: 'weight', label: '體重', unit: 'kg', digits: 2 },
  { key: 'body_fat_pct', label: '體脂', unit: '%', digits: 1 },
  { key: 'muscle_kg', label: '骨骼肌', unit: 'kg', digits: 2 },
  { key: 'visceral', label: '內臟脂肪', unit: '', digits: 1 },
  { key: 'body_age', label: '身體年齡', unit: '歲', digits: 0 },
  { key: 'bmi', label: 'BMI', unit: '', digits: 1 },
  { key: 'bmr', label: '基礎代謝', unit: 'kcal', digits: 0 },
];
// 一筆測量記錄（今日食物頁那一天有量也會列）：體重是標題，其餘用大字；點開是歐姆龍檔的全部欄位
const STATS = BODY_FIELDS.slice(1);
export function recordRow(r, note) {
  const when = new Date(r.measured_at).toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const details = Object.entries(r.raw ?? {})
    .filter(([key]) => key !== '測量日期' && key !== '時區')
    .map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('');
  return `<li><details class="row-details">
    <summary class="row">
      <span class="row-main">
        <span class="row-title">${fmt(r.weight, 2)} kg</span>
        <span class="row-sub">${esc(when)}</span>
        ${note ? `<span class="row-note">${esc(note)}</span>` : ''}
      </span>
      <span class="row-side pair">${STATS.map((f) => `<span>${fmt(r[f.key], f.digits)}<small>${`${f.unit} ${f.label}`.trim()}</small></span>`).join('')}</span>
    </summary>
    <dl class="detail-grid">${details}</dl>
  </details></li>`;
}

export async function show() {
  const [records, notes] = await Promise.all([db.listBodyRecords(), db.listDayNotes()]);
  const noteOf = new Map(notes.map((n) => [n.note_date, n.note]));
  $('#body-list').innerHTML = records.map((r) => recordRow(r, noteOf.get(localDate(new Date(r.measured_at))))).join('')
    || '<li class="empty">還沒有測量記錄，按上面的按鈕匯入</li>';
}

$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // 同一個檔可以再選一次
  if (!file) return;
  const { added, skipped } = await db.importBodyRecords(parseOmron(await file.text()));
  const result = $('#import-result');
  result.textContent = `新增 ${added} 筆、略過 ${skipped} 筆（已經有的不會重複存）`;
  result.hidden = false;
  await show();
});
