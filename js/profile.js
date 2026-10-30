import * as db from './db.js?v=f62ec67';
import { $, fmt, numOrNull, openDialog, toast } from './util.js?v=f62ec67';
import { BODY_FIELDS } from './body.js?v=f62ec67';

// 個人檔案（右上角頭像 → 個人檔案）：基本資料、目標存 settings；最新身體數值抓歐姆龍最新一筆（跟上一次比）；自述共用 chat_profiles

const ageOf = (birthday) => {
  if (!birthday) return '';
  const b = new Date(`${birthday}T00:00`), now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age--;
  return age >= 0 ? `（${age} 歲）` : '';
};

function renderBody(latest, prev) {
  if (!latest) {
    $('#profile-body-when').textContent = '還沒有身體數值：先到「身體」匯入歐姆龍。';
    $('#profile-body').innerHTML = '';
    return;
  }
  const when = new Date(latest.measured_at).toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#profile-body-when').textContent = `${when} 量的${prev ? `，小字是跟上一次（${new Date(prev.measured_at).toLocaleDateString('zh-TW')}）比` : ''}`;
  $('#profile-body').innerHTML = BODY_FIELDS.map((f) => {
    const value = latest[f.key];
    let diff = '';
    if (prev && value != null && prev[f.key] != null) {
      const d = Number(value) - Number(prev[f.key]);
      diff = `<span class="diff">${d === 0 ? '持平' : `${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), f.digits)}`}</span>`;
    }
    return `<div><dt>${f.label}</dt><dd>${value == null ? '—' : `${fmt(value, f.digits)}<small>${f.unit}</small>`}${diff}</dd></div>`;
  }).join('');
}

// 目標體重、體脂跟最新數值差多少
function renderGoalDiff(latest) {
  const parts = [];
  const gw = numOrNull($('#profile-goal-weight').value), gf = numOrNull($('#profile-goal-fat').value);
  if (gw != null && latest?.weight != null) {
    const d = Number(latest.weight) - gw;
    parts.push(`體重${Math.abs(d) < 0.05 ? '已達標' : `還差 ${fmt(Math.abs(d), 1)} kg（要${d > 0 ? '減' : '增'}）`}`);
  }
  if (gf != null && latest?.body_fat_pct != null) {
    const d = Number(latest.body_fat_pct) - gf;
    parts.push(`體脂${Math.abs(d) < 0.05 ? '已達標' : `還差 ${fmt(Math.abs(d), 1)} %（要${d > 0 ? '減' : '增'}）`}`);
  }
  $('#profile-goal-diff').textContent = parts.join('　');
}

export async function open(user) {
  const [settings, records, bio] = await Promise.all([db.getSettings(), db.latestBodyRecords(2), db.getChatProfile()]);
  const [latest, prev] = records;
  const meta = user.user_metadata ?? {};
  const avatar = $('#profile-avatar');
  avatar.hidden = !(meta.avatar_url || meta.picture);
  if (!avatar.hidden) avatar.src = meta.avatar_url || meta.picture;
  $('#profile-email').textContent = user.email ?? '';

  $('#profile-nickname').value = settings.nickname ?? meta.full_name ?? meta.name ?? '';
  $('#profile-gender').value = settings.gender ?? '';
  $('#profile-birthday').value = settings.birthday ?? '';
  $('#profile-age').textContent = ageOf(settings.birthday);
  $('#profile-height').value = settings.height_cm ?? '';
  $('#profile-goal-weight').value = settings.goal_weight ?? '';
  $('#profile-goal-fat').value = settings.goal_body_fat ?? '';
  $('#profile-bio').value = bio;
  renderBody(latest, prev);
  renderGoalDiff(latest);

  const dialog = $('#profile-dialog');
  const onInput = (e) => {
    if (e.target.id === 'profile-birthday') $('#profile-age').textContent = ageOf(e.target.value);
    else renderGoalDiff(latest);
  };
  dialog.addEventListener('input', onInput);
  const result = await openDialog(dialog);
  dialog.removeEventListener('input', onInput);
  if (result !== 'ok') return;

  await Promise.all([
    db.saveSettings({
      nickname: $('#profile-nickname').value.trim() || null,
      gender: $('#profile-gender').value || null,
      birthday: $('#profile-birthday').value || null,
      height_cm: numOrNull($('#profile-height').value),
      goal_weight: numOrNull($('#profile-goal-weight').value),
      goal_body_fat: numOrNull($('#profile-goal-fat').value),
    }),
    $('#profile-bio').value !== bio ? db.saveChatProfile($('#profile-bio').value) : null,
  ]);
  toast('個人檔案已儲存');
}
