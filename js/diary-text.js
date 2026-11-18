// 日曆一天的記錄（diary_logs 一列）→ 一行字，例如「生理期 · 有前戲 10 分鐘 · 前庭痛 · 日記：…」；沒記東西回傳空字串。
// 就醫紀錄卡片上「那天日曆」跟助理的背景資料共用。不碰畫面，家裡電腦上的程式也 import 這個檔。
// 欄位跟選項的名字照 index.html 的 diary-dialog（picks 的格式寫在 js/diary.js 開頭）。
const PAIN = { none: '不痛', vestibule: '前庭痛', vaginal: '陰道裡面痛', anal: '肛門前裂開' };

export function diaryText(r) {
  const p = r?.picks ?? {};
  const vaseline = p.vaseline === true ? 'yes' : p.vaseline; // 2026-11-08 前存的 true＝有擦
  const foreplay = p.foreplay === 'yes' ? '有前戲' : p.foreplay === 'no' ? '無前戲' : p.foreplay_min ? '前戲' : '';
  return [
    r?.period && '生理期',
    p.pill_day && `避孕藥第 ${p.pill_day} 天`,
    vaseline === 'yes' ? '有擦凡士林' : vaseline === 'no' ? '沒擦凡士林' : '',
    foreplay && `${foreplay}${p.foreplay_min ? ` ${p.foreplay_min} 分鐘` : ''}`,
    p.lube && `潤滑液 ${p.lube}`,
    p.pain?.length && p.pain.map((k) => PAIN[k] ?? k).join('、'),
    p.swab?.length && `棉棒測試 ${p.swab.length} 處痛`,
    r?.note && `日記：${String(r.note).trim().replace(/\s*\n\s*/g, '／')}`,
  ].filter(Boolean).join(' · ');
}
