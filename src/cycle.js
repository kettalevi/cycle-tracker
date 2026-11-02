// Pure cycle-tracking logic. No DOM, no storage: easy to test and reuse.
// Dates are "YYYY-MM-DD" strings; arithmetic uses UTC day numbers so DST never matters.

export const DEFAULTS = Object.freeze({
  cycleLength: 28, // used until there is enough history
  periodLength: 5,
  lutealDays: 14, // days from ovulation to next period
});

const MIN_CYCLE = 15; // lengths outside this range are treated as outliers
const MAX_CYCLE = 90;
const HISTORY_WINDOW = 6; // most recent cycles used for averages

export const toDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const fromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (s, n) => fromDay(toDay(s) + n);
export const diffDays = (a, b) => toDay(a) - toDay(b); // a - b
export const todayStr = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function emptyData() {
  return { version: 1, periods: [], logs: {}, settings: { ...DEFAULTS } };
}

/** Validate/normalise imported data. Throws on anything unusable. */
export function normalizeData(raw) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!raw || typeof raw !== "object") throw new Error("Not a valid data file");
  const out = emptyData();
  for (const p of Array.isArray(raw.periods) ? raw.periods : []) {
    if (!p || !iso.test(p.start)) continue;
    const period = { start: p.start };
    if (p.end && iso.test(p.end) && diffDays(p.end, p.start) >= 0) period.end = p.end;
    out.periods.push(period);
  }
  out.periods.sort((a, b) => a.start.localeCompare(b.start));
  out.periods = out.periods.filter((p, i, a) => i === 0 || p.start !== a[i - 1].start);
  if (raw.logs && typeof raw.logs === "object") {
    for (const [d, l] of Object.entries(raw.logs)) {
      if (iso.test(d) && l && typeof l === "object") {
        out.logs[d] = {
          flow: ["light", "medium", "heavy"].includes(l.flow) ? l.flow : undefined,
          symptoms: Array.isArray(l.symptoms) ? l.symptoms.filter((x) => typeof x === "string").slice(0, 30) : [],
          mood: typeof l.mood === "string" ? l.mood.slice(0, 40) : undefined,
          notes: typeof l.notes === "string" ? l.notes.slice(0, 2000) : undefined,
        };
      }
    }
  }
  const s = raw.settings || {};
  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? Math.round(+v) : d);
  out.settings = {
    cycleLength: clamp(s.cycleLength, MIN_CYCLE, MAX_CYCLE, DEFAULTS.cycleLength),
    periodLength: clamp(s.periodLength, 1, 14, DEFAULTS.periodLength),
    lutealDays: clamp(s.lutealDays, 8, 18, DEFAULTS.lutealDays),
  };
  return out;
}

/** Log a period start. Starts within 3 days of an existing start are treated as the same period. */
export function addPeriodStart(data, date) {
  const near = data.periods.find((p) => Math.abs(diffDays(p.start, date)) <= 3);
  if (near) {
    if (date < near.start) near.start = date;
  } else {
    data.periods.push({ start: date });
  }
  data.periods.sort((a, b) => a.start.localeCompare(b.start));
  return data;
}

/** Mark the period that began on/before `date` (and is not yet over) as ending on `date`. */
export function endPeriod(data, date) {
  const p = [...data.periods].reverse().find((x) => x.start <= date);
  if (!p || diffDays(date, p.start) > 14) return data;
  p.end = date;
  return data;
}

export function removePeriod(data, start) {
  data.periods = data.periods.filter((p) => p.start !== start);
  return data;
}

/** Lengths between consecutive period starts, newest last. Outliers are dropped. */
export function cycleLengths(periods) {
  const out = [];
  for (let i = 1; i < periods.length; i++) {
    const len = diffDays(periods[i].start, periods[i - 1].start);
    if (len >= MIN_CYCLE && len <= MAX_CYCLE) out.push({ start: periods[i - 1].start, length: len });
  }
  return out;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => (a.length < 2 ? 0 : Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1)));

export function stats(data) {
  const s = { ...DEFAULTS, ...data.settings };
  const lens = cycleLengths(data.periods).slice(-HISTORY_WINDOW).map((c) => c.length);
  const periodLens = data.periods
    .filter((p) => p.end)
    .slice(-HISTORY_WINDOW)
    .map((p) => diffDays(p.end, p.start) + 1)
    .filter((n) => n >= 2 && n <= 14); // 1-day entries are usually a mis-tap
  return {
    cycleCount: lens.length,
    avgCycle: lens.length ? Math.round(mean(lens)) : s.cycleLength,
    variability: lens.length >= 2 ? sd(lens) : 0,
    shortest: lens.length ? Math.min(...lens) : null,
    longest: lens.length ? Math.max(...lens) : null,
    avgPeriod: periodLens.length ? Math.round(mean(periodLens)) : s.periodLength,
    lutealDays: s.lutealDays,
    hasHistory: lens.length > 0,
  };
}

/**
 * Predict the next `count` cycles after the most recent logged period start.
 * Ovulation is estimated as `lutealDays` before the next period; the fertile
 * window is the 5 days before ovulation plus ovulation day and the day after.
 * `uncertainty` (days) widens the period range when cycles vary.
 */
export function predict(data, count = 3) {
  if (!data.periods.length) return [];
  const st = stats(data);
  const uncertainty = Math.min(7, Math.max(st.cycleCount ? 1 : 3, Math.round(st.variability)));
  const out = [];
  let start = data.periods[data.periods.length - 1].start;
  for (let i = 0; i < count; i++) {
    start = addDays(start, st.avgCycle);
    const ovulation = addDays(start, -st.lutealDays);
    out.push({
      periodStart: start,
      periodEnd: addDays(start, st.avgPeriod - 1),
      earliest: addDays(start, -uncertainty),
      latest: addDays(start, uncertainty),
      ovulation,
      fertileStart: addDays(ovulation, -5),
      fertileEnd: addDays(ovulation, 1),
      uncertainty,
    });
  }
  return out;
}

/** Where is `today` in the cycle? Returns null when no period has been logged. */
export function currentCycle(data, today) {
  const past = data.periods.filter((p) => p.start <= today);
  if (!past.length) return null;
  const last = past[past.length - 1];
  const st = stats(data);
  const day = diffDays(today, last.start) + 1;
  const periodEnd = last.end || addDays(last.start, st.avgPeriod - 1);
  const ovulationDay = st.avgCycle - st.lutealDays + 1; // cycle day
  let phase;
  if (today <= periodEnd && day <= 14) phase = "menstrual";
  else if (day < ovulationDay - 5) phase = "follicular";
  else if (day <= ovulationDay + 1) phase = "fertile";
  else phase = "luteal";
  const next = predict({ ...data, periods: data.periods.slice(0, data.periods.indexOf(last) + 1) }, 1)[0];
  return {
    day,
    phase,
    periodStart: last.start,
    lateBy: Math.max(0, diffDays(today, next.periodStart)),
    daysUntilPeriod: diffDays(next.periodStart, today),
    daysUntilOvulation: diffDays(next.ovulation, today),
    next,
  };
}

/** Classify one calendar day for rendering. */
export function classifyDay(data, date, predictions, today) {
  const st = stats(data);
  const tags = new Set();
  for (const p of data.periods) {
    const end = p.end || (p.start <= today ? addDays(p.start, Math.min(st.avgPeriod - 1, Math.max(0, diffDays(today, p.start)))) : p.start);
    if (date >= p.start && date <= end) tags.add("period");
  }
  if (!tags.has("period")) {
    for (const pr of predictions) {
      if (date >= pr.periodStart && date <= pr.periodEnd && date > today) tags.add("predicted-period");
      if (date === pr.ovulation) tags.add("ovulation");
      else if (date >= pr.fertileStart && date <= pr.fertileEnd) tags.add("fertile");
    }
  }
  return tags;
}
