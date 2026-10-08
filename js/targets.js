// 每日目標：今日食物頁、歷史頁、設定頁都從這裡拿，「目標怎麼來」的規則只寫在這裡。
import * as db from './db.js?v=1c6ea53';
import { NUTRIENTS, autoStandard } from './nutrition.js?v=1c6ea53';

// 每項營養今天要比對的數字 → { 快照欄位: 數字或 null }
// 順序：自己訂的目標值（每公斤 × 最新體重）→ 依體重自動算的標準值。perKg = settings.targets 的格式 { 快照欄位: { per_kg } }
export function dailyTargets(perKg, weight) {
  const targets = {};
  for (const n of NUTRIENTS) {
    const mine = perKg?.[n.log]?.per_kg;
    targets[n.log] = mine != null && weight != null ? mine * weight : autoStandard(n, weight);
  }
  return targets;
}

// 抓設定跟歐姆龍最新體重，算出今天用的目標。weight／weighedAt 沒有體重資料時是 null
export async function loadTargets() {
  const [settings, latest] = await Promise.all([db.getSettings(), db.latestWeight()]);
  const perKg = settings.targets ?? {};
  return { targets: dailyTargets(perKg, latest?.weight), perKg, weight: latest?.weight ?? null, weighedAt: latest?.measured_at ?? null };
}

export const saveTargets = (perKg) => db.saveSettings({ targets: perKg });

// 「每公斤」↔「一天多少」的換算（設定頁填哪一格都行，另一格自動換算）；存的只有每公斤
export const perDayOf = (perKg, weight) => +(perKg * weight).toFixed(1);
export const perKgOf = (perDay, weight) => +(perDay / weight).toFixed(4);
