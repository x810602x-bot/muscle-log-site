import * as db from './db.js?v=1c6ea53';
import { $, esc, fmt, localDate, addDays } from './util.js?v=1c6ea53';
import { nutrient, sumOf } from './nutrition.js?v=1c6ea53';
import { loadTargets } from './targets.js?v=1c6ea53';
import { openDate } from './today.js?v=1c6ea53';
import { BODY_FIELDS } from './body.js?v=1c6ea53';

// 每條線數字大小差很多，所以各自一格、上下排，共用同一條時間軸
// item = 從每天吃的東西算出來的營養項目（有每日目標虛線；要多畫一條線在這裡加一列就好）；其餘都是歐姆龍的欄位。
// off = 圖上預設先不勾（全勾圖會太長），表格一律都列
const dailySeries = (key, log, color, extra = {}) => {
  const item = nutrient(log);
  return { key, item, label: item.label, unit: item.unit, digits: item.digits, color, ...extra };
};
const SERIES = [
  dailySeries('protein', 'protein_g', '--series-1', { labelDigits: 0 }), // 每天一點很密，點上的數字取整數才塞得下
  dailySeries('kcal', 'kcal', '--series-9'),
  ...BODY_FIELDS.map((f, i) => ({ ...f, color: `--series-${i + 2}`, off: i >= 3 })),
];
const PANEL_HEIGHT = 130;
const NEAR_MS = 4 * 86400e3; // 提示框會帶出每條線離游標 4 天內最近的那一點

Chart.register(ChartDataLabels); // 每個點上面寫數字
Chart.defaults.font.family ='system-ui, -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif';

const DAILY_SERIES = SERIES.filter((s) => s.item);
const BODY_SERIES = SERIES.filter((s) => !s.item);
const hidden = new Set(SERIES.filter((s) => s.off).map((s) => s.key));
let days = 30;
let chart = null;

// 每條線各找離游標最近的一點（每天的蛋白質跟每週的體重，日期本來就對不齊）
Chart.Interaction.modes.nearestPerSeries = (chartInstance, event) => {
  const x = chartInstance.scales.x.getValueForPixel(event.x);
  const items = [];
  chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
    if (dataset.isTarget || !chartInstance.isDatasetVisible(datasetIndex)) return;
    let best = -1;
    dataset.data.forEach((point, index) => {
      if (best < 0 || Math.abs(point.x - x) < Math.abs(dataset.data[best].x - x)) best = index;
    });
    if (best >= 0 && Math.abs(dataset.data[best].x - x) <= NEAR_MS) {
      items.push({ element: chartInstance.getDatasetMeta(datasetIndex).data[best], datasetIndex, index: best });
    }
  });
  return items;
};

// 游標所在的直線
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(c) {
    if (!c.tooltip?.getActiveElements().length) return;
    const { ctx, chartArea } = c;
    ctx.save();
    ctx.strokeStyle = css('--axis');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c.tooltip.caretX, chartArea.top);
    ctx.lineTo(c.tooltip.caretX, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// 每一格左上角寫上這格是什麼（比直排的軸標題省空間，手機也放得下）
const panelLabels = {
  id: 'panelLabels',
  afterDraw(c) {
    const { ctx, chartArea } = c;
    ctx.save();
    ctx.font = `600 11px ${Chart.defaults.font.family}`;
    ctx.fillStyle = css('--text-secondary');
    ctx.textBaseline = 'top';
    for (const s of SERIES) {
      if (c.scales[s.key]) ctx.fillText(`${s.label} ${s.unit}`, chartArea.left + 6, c.scales[s.key].top + 2);
    }
    ctx.restore();
  },
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const shortDate = (ms) => new Date(ms).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });

export async function show() {
  const since = days ? addDays(localDate(), -days) : null;
  const [logRows, bodies, { targets }, allNotes] = await Promise.all([
    db.logsSince(since), db.listBodyRecords(), loadTargets(), db.listDayNotes(),
  ]);
  const notes = allNotes.filter((n) => (!since || n.note_date >= since) && n.note_date <= localDate());
  const records = bodies.filter((r) => !since || localDate(new Date(r.measured_at)) >= since).reverse();
  // 每一天的記錄加成那天的總和（跟今日食物頁「今天總共」同一個算法）
  const byDay = new Map();
  for (const l of logRows) (byDay.get(l.log_date) ?? byDay.set(l.log_date, []).get(l.log_date)).push(l);
  const totals = [...byDay].sort(([a], [b]) => a.localeCompare(b))
    .map(([log_date, rows]) => ({ log_date, ...Object.fromEntries(DAILY_SERIES.map((s) => [s.key, sumOf(s.item, rows)])) }));
  const points = {};
  for (const { key } of DAILY_SERIES) {
    points[key] = totals.filter((t) => t[key] != null).map((t) => ({ x: new Date(`${t.log_date}T00:00`).getTime(), y: t[key] }));
  }
  for (const { key } of BODY_SERIES) {
    points[key] = records.filter((r) => r[key] != null).map((r) => ({ x: new Date(r.measured_at).getTime(), y: Number(r[key]) }));
  }

  for (const btn of document.querySelectorAll('#range button')) btn.setAttribute('aria-pressed', Number(btn.dataset.days) === days);
  renderToggles();
  renderChart(points, targets, since);
  renderTable(totals, records, notes);
}

function renderToggles() {
  $('#series-toggles').innerHTML = SERIES.map((s) => `<label class="series-toggle">
      <input type="checkbox" data-series="${s.key}" ${hidden.has(s.key) ? '' : 'checked'}>
      <span class="line-key" style="background: var(${s.color})"></span>${s.label}
    </label>`).join('') + '<span class="hint">虛線是每日目標 · 點圖上的點可以看那天吃了什麼</span>';
}

function renderChart(points, targets, since) {
  chart?.destroy();
  const visible = SERIES.filter((s) => !hidden.has(s.key));
  const empty = !visible.some((s) => points[s.key].length);
  $('#chart-empty').hidden = !empty;
  $('#chart-box').hidden = empty;
  if (empty) return;
  $('#chart-box').style.height = `${visible.length * PANEL_HEIGHT + 36}px`;

  const xs = visible.flatMap((s) => points[s.key].map((p) => p.x));
  const xMin = since ? new Date(`${since}T00:00`).getTime() : Math.min(...xs) - 86400e3;
  const xMax = new Date(`${localDate()}T23:59`).getTime();
  const surface = css('--surface');
  const tick = { color: css('--text-muted'), font: { size: 11 } };

  const datasets = visible.map((s) => ({
    label: s.label, unit: s.unit, digits: s.digits, labelDigits: s.labelDigits ?? s.digits, data: points[s.key], yAxisID: s.key,
    borderColor: css(s.color), backgroundColor: css(s.color), borderWidth: 2,
    pointRadius: 4, pointHoverRadius: 6, pointBorderColor: surface, pointBorderWidth: 2, pointHoverBorderColor: surface,
  }));
  for (const s of visible.filter((v) => v.item && v.item.target(targets) != null)) {
    const target = s.item.target(targets);
    datasets.push({
      isTarget: true, data: [{ x: xMin, y: target }, { x: xMax, y: target }], yAxisID: s.key,
      borderColor: css('--text-muted'), borderWidth: 1, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0,
    });
  }

  const scales = {
    x: {
      type: 'time', min: xMin, max: xMax, time: { unit: days === 30 ? 'day' : undefined, displayFormats: { day: 'M/d', week: 'M/d', month: 'yyyy/M' } },
      grid: { display: false }, border: { color: css('--axis') }, ticks: { ...tick, maxRotation: 0, autoSkipPadding: 16 },
    },
  };
  // 疊起來的軸是由下往上排，所以倒著加，蛋白質才會在最上面
  for (const s of [...visible].reverse()) {
    scales[s.key] = {
      stack: 'panels', offset: true, grace: '15%',
      grid: { color: css('--grid') }, border: { display: false }, ticks: { ...tick, maxTicksLimit: 4 },
    };
  }

  chart = new Chart($('#chart'), {
    type: 'line',
    data: { datasets },
    plugins: [crosshair, panelLabels],
    options: {
      maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearestPerSeries' },
      // 點圖：跳到離點下去的位置最近的那一天
      onClick(event, items, c) {
        const x = c.scales.x.getValueForPixel(event.x);
        const xs = items.map((item) => c.data.datasets[item.datasetIndex].data[item.index].x);
        if (xs.length) openDate(localDate(new Date(xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)))));
      },
      scales,
      plugins: {
        legend: { display: false },
        // 點上面的小數字；點太密、字會疊在一起時自動藏掉一些（'auto'）
        datalabels: {
          display: (ctx) => (ctx.dataset.isTarget ? false : 'auto'),
          formatter: (point, ctx) => fmt(point.y, ctx.dataset.labelDigits),
          align: 'top', offset: 3, color: css('--text-secondary'), font: { size: 10 },
        },
        tooltip: {
          backgroundColor: css('--tooltip-bg'), titleColor: css('--tooltip-text'), bodyColor: css('--tooltip-text'),
          padding: 10, boxWidth: 12, boxHeight: 2, boxPadding: 6,
          callbacks: {
            title: () => '',
            label: (item) => `${fmt(item.parsed.y, item.dataset.digits)} ${item.dataset.unit}  ${item.dataset.label} · ${shortDate(item.parsed.x)}`,
            labelColor: (item) => ({ backgroundColor: item.dataset.borderColor, borderColor: item.dataset.borderColor }),
          },
        },
      },
    },
  });
}

// 同樣的數字用表格再列一次（最新的在上面）
function renderTable(totals, records, notes) {
  const byDate = new Map();
  const rowOf = (date) => byDate.get(date) ?? byDate.set(date, {}).get(date);
  for (const t of totals) Object.assign(rowOf(t.log_date), t);
  for (const n of notes) rowOf(n.note_date).note = n.note;
  for (const r of records) Object.assign(rowOf(localDate(new Date(r.measured_at))), r);

  const cell = (value, digits) => `<td>${value == null ? '' : fmt(value, digits)}</td>`;
  const rows = [...byDate.keys()].sort().reverse().map((date) => {
    const r = byDate.get(date);
    return `<tr data-date="${date}" tabindex="0"><th>${shortDate(`${date}T00:00`)}</th>${SERIES.map((s) => cell(r[s.key], s.digits)).join('')}<td class="note-cell">${esc(r.note)}</td></tr>`;
  });
  $('#daily-table').innerHTML = rows.length
    ? `<thead><tr><th>日期</th>${SERIES.map((s) => `<th>${s.label} ${s.unit}</th>`).join('')}<th>備註</th></tr></thead><tbody>${rows.join('')}</tbody>`
    : '<tbody><tr><td class="empty">這段期間還沒有資料</td></tr></tbody>';
}

$('#daily-table').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-date]');
  if (row) openDate(row.dataset.date);
});

$('#range').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-days]');
  if (!btn) return;
  days = Number(btn.dataset.days);
  show();
});
$('#series-toggles').addEventListener('change', (e) => {
  const key = e.target.dataset.series;
  if (e.target.checked) hidden.delete(key); else hidden.add(key);
  show();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!$('#page-trends').hidden) show();
});
