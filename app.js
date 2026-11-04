import {
  addPeriodStart, endPeriod, removePeriod, stats, predict, currentCycle, classifyDay,
  cycleLengths, normalizeData, emptyData, addDays, diffDays, todayStr, remindersFor, buildICS,
} from "./src/cycle.js";
import { load, save, wipe } from "./src/storage.js";

const SYMPTOMS = ["Cramps", "Headache", "Bloating", "Fatigue", "Back pain", "Tender breasts", "Acne", "Nausea", "Cravings", "Spotting"];
const MOODS = ["Happy", "Calm", "Anxious", "Irritable", "Low", "Energetic"];
const FLOWS = ["light", "medium", "heavy"];

let data = load();
let today = todayStr();
let selected = today;
let view = { y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 };

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
const fmt = (s, opts = { month: "short", day: "numeric" }) =>
  new Date(s + "T12:00:00").toLocaleDateString(undefined, opts);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function commit(msg) {
  if (!save(data)) toast("Could not save: your browser is blocking storage.");
  else if (msg) toast(msg);
  render();
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

const PHASES = {
  menstrual: ["Period", "Rest and be kind to yourself."],
  follicular: ["Follicular phase", "Energy often rises as ovulation approaches."],
  fertile: ["Fertile window (est.)", "Pregnancy is most likely around now."],
  luteal: ["Luteal phase", "PMS symptoms can show up in the days before your period."],
};

function renderToday() {
  const el = $("today");
  el.replaceChildren();
  const c = currentCycle(data, today);
  if (!c) {
    el.append(
      h("div", { class: "big" }, "Welcome 👋"),
      h("p", { class: "sub" }, "Log the first day of your last period to get predictions. More logged cycles means better estimates."),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => pickStart() }, "Log a period start")),
    );
    return;
  }
  const [phaseName, phaseTip] = PHASES[c.phase];
  const st = stats(data);
  let countdown;
  if (c.lateBy > 0) countdown = `Period is ${plural(c.lateBy, "day")} later than predicted`;
  else if (c.daysUntilPeriod === 0) countdown = "Period expected today";
  else countdown = `Next period in about ${plural(c.daysUntilPeriod, "day")} (${fmt(c.next.periodStart)})`;
  const ovText = c.daysUntilOvulation > 0
    ? `${fmt(c.next.ovulation)} (in ${plural(c.daysUntilOvulation, "day")})`
    : c.daysUntilOvulation === 0 ? "Today" : `${fmt(c.next.ovulation)}`;
  const ongoing = data.periods.length && !data.periods[data.periods.length - 1].end &&
    diffDays(today, data.periods[data.periods.length - 1].start) <= 14 && c.phase === "menstrual";

  el.append(
    h("div", { class: "big" }, `Day ${c.day}`, h("span", { class: "badge" }, phaseName)),
    h("div", { class: "sub" }, countdown),
    h("p", { class: "sub" }, phaseTip),
    h("div", { class: "stats" },
      h("div", {}, h("b", {}, `${fmt(c.next.fertileStart)} – ${fmt(c.next.fertileEnd)}`), h("span", {}, "Next fertile window (est.)")),
      h("div", {}, h("b", {}, ovText), h("span", {}, "Ovulation (est.)")),
      h("div", {}, h("b", {}, st.hasHistory ? `${st.avgCycle} days` : `${st.avgCycle} (default)`),
        h("span", {}, st.cycleCount ? `Avg cycle${st.cycleCount > 1 ? ` · ±${c.next.uncertainty}d` : ""}` : "Avg cycle")),
    ),
    h("div", { class: "row" },
      h("button", { class: "primary", onclick: () => { addPeriodStart(data, today); selected = today; commit("Period start logged"); } }, "Period started today"),
      ongoing ? h("button", { onclick: () => { endPeriod(data, today); commit("Period end logged"); } }, "Period ended today") : null,
      h("button", { onclick: () => pickStart() }, "Log another date"),
    ),
  );
}

function pickStart() {
  addPeriodStart(data, selected);
  commit(`Period start logged for ${fmt(selected)}`);
}

function renderCalendar() {
  const cal = $("calendar");
  cal.replaceChildren();
  const first = `${view.y}-${String(view.m + 1).padStart(2, "0")}-01`;
  $("month-label").textContent = fmt(first, { month: "long", year: "numeric" });
  const weekStart = 1; // Monday
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  labels.forEach((l) => cal.append(h("div", { class: "dow", "aria-hidden": "true" }, l[0])));
  const jsDow = new Date(first + "T12:00:00").getDay();
  const offset = (jsDow - weekStart + 7) % 7;
  for (let i = 0; i < offset; i++) cal.append(h("div", { class: "day blank" }));
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const preds = predict(data, 6);
  for (let d = 1; d <= days; d++) {
    const date = `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const tags = classifyDay(data, date, preds, today);
    const cls = ["day", ...tags];
    if (date === today) cls.push("today");
    if (date === selected) cls.push("selected");
    if (data.logs[date] && (data.logs[date].symptoms?.length || data.logs[date].mood || data.logs[date].notes || data.logs[date].flow)) cls.push("has-log");
    const desc = [fmt(date, { weekday: "long", month: "long", day: "numeric" }), ...[...tags].map((t) => t.replace("-", " "))].join(", ");
    cal.append(h("button", { class: cls.join(" "), "aria-label": desc, "aria-pressed": date === selected, onclick: () => { selected = date; render(); } }, String(d)));
  }
}

function renderDayPanel() {
  const el = $("day-panel");
  el.replaceChildren();
  el.hidden = false;
  const log = data.logs[selected] || { symptoms: [] };
  const period = data.periods.find((p) => p.start <= selected && diffDays(selected, p.start) <= 14);
  const isStart = data.periods.some((p) => p.start === selected);
  const set = (patch) => {
    const next = { ...log, ...patch };
    const empty = !next.flow && !next.mood && !next.notes && !(next.symptoms || []).length;
    if (empty) delete data.logs[selected]; else data.logs[selected] = next;
    save(data);
  };
  const toggle = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const chip = (label, pressed, onclick) => h("button", { class: "chip", "aria-pressed": String(!!pressed), onclick }, label);

  el.append(
    h("h2", {}, fmt(selected, { weekday: "long", month: "long", day: "numeric" })),
    h("div", { class: "row" },
      isStart
        ? h("button", { onclick: () => { removePeriod(data, selected); commit("Period start removed"); } }, "Remove period start")
        : h("button", { class: "primary", onclick: () => { addPeriodStart(data, selected); commit("Period start logged"); } }, "Period started this day"),
      period
        ? h("button", { onclick: () => { endPeriod(data, selected); commit("Period end logged"); } }, "Period ended this day")
        : null,
    ),
    h("p", { class: "hint" }, "Flow"),
    h("div", { class: "chips" }, FLOWS.map((f) => chip(f[0].toUpperCase() + f.slice(1), log.flow === f, () => { set({ flow: log.flow === f ? undefined : f }); render(); }))),
    h("p", { class: "hint" }, "Symptoms"),
    h("div", { class: "chips" }, SYMPTOMS.map((s) => chip(s, (log.symptoms || []).includes(s), () => { set({ symptoms: toggle(log.symptoms || [], s) }); render(); }))),
    h("p", { class: "hint" }, "Mood"),
    h("div", { class: "chips" }, MOODS.map((m) => chip(m, log.mood === m, () => { set({ mood: log.mood === m ? undefined : m }); render(); }))),
    h("label", {}, h("span", { class: "hint" }, "Notes"),
      h("textarea", { maxlength: "2000", onchange: (e) => { set({ notes: e.target.value.trim() || undefined }); renderCalendar(); } }, log.notes || "")),
  );
  const ta = el.querySelector("textarea");
  ta.value = log.notes || "";
}

function renderHistory() {
  const el = $("history");
  el.replaceChildren();
  const lens = cycleLengths(data.periods);
  if (!data.periods.length) {
    el.append(h("p", { class: "hint" }, "Nothing logged yet."));
    return;
  }
  if (lens.length) {
    const recent = lens.slice(-12);
    const max = Math.max(...recent.map((c) => c.length), 35);
    el.append(
      h("div", { class: "bars", role: "img", "aria-label": `Cycle lengths in days: ${recent.map((c) => c.length).join(", ")}` },
        recent.map((c) => h("div", { class: "bar", style: `height:${(c.length / max) * 100}%` }, h("span", {}, String(c.length))))),
      h("div", { class: "bar-labels", "aria-hidden": "true" }, recent.map((c) => h("span", {}, fmt(c.start, { month: "short" })))),
    );
    const st = stats(data);
    el.append(h("p", { class: "hint" }, `Average ${st.avgCycle} days · shortest ${st.shortest} · longest ${st.longest} (last ${plural(st.cycleCount, "cycle")}).`));
  }
  el.append(h("ul", { class: "hist-list" },
    [...data.periods].reverse().map((p) => {
      const len = p.end ? diffDays(p.end, p.start) + 1 : null;
      return h("li", {}, h("span", {}, `${fmt(p.start, { month: "short", day: "numeric", year: "numeric" })}${len ? ` · ${plural(len, "day")}` : ""}`),
        h("button", { "aria-label": `Delete period starting ${p.start}`, onclick: () => { removePeriod(data, p.start); commit("Deleted"); } }, "Delete"));
    })));
}

const NOTIFIED_KEY = "cycle-tracker:notified";
function notifiedIds() {
  try { return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || []; } catch { return []; }
}

/** Show today's reminders as a banner, and as a system notification once each (if allowed). */
async function renderReminders() {
  const banner = $("banner");
  const due = remindersFor(data, today);
  banner.replaceChildren();
  banner.hidden = !due.length || dismissed === today + due.map((r) => r.id).join();
  if (!banner.hidden) {
    banner.append(h("span", {}, "🔔 " + due.map((r) => r.text).join(" ")),
      h("button", { onclick: () => { dismissed = today + due.map((r) => r.id).join(); banner.hidden = true; } }, "Dismiss"));
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const seen = notifiedIds();
  const fresh = due.filter((r) => !seen.includes(r.id));
  if (!fresh.length) return;
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
  const sent = [];
  for (const r of fresh) {
    try {
      if (reg) await reg.showNotification("Cycle Tracker", { body: r.text, icon: "icons/icon.svg", tag: r.id });
      else new Notification("Cycle Tracker", { body: r.text, tag: r.id });
      sent.push(r.id); // only remember it once delivery worked, so a failure is retried next time
    } catch { /* try again on a later visit */ }
  }
  try {
    if (sent.length) localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...seen, ...sent].slice(-30)));
  } catch { /* ignore */ }
}
let dismissed = "";

function renderNotifyButton() {
  const b = $("notify");
  if (!("Notification" in window)) { b.hidden = true; return; }
  const p = Notification.permission;
  b.textContent = p === "granted" ? "Notifications are on ✓" : p === "denied" ? "Notifications blocked in browser" : "Turn on notifications";
  b.disabled = p !== "default";
}

function renderSettings() {
  const s = data.settings;
  $("set-remind").value = String(s.remindDays);
  renderNotifyButton();
  $("set-cycle").value = s.cycleLength;
  $("set-period").value = s.periodLength;
  $("set-luteal").value = s.lutealDays;
}

function render() {
  today = todayStr();
  renderToday();
  renderCalendar();
  renderDayPanel();
  renderHistory();
  renderSettings();
  renderReminders();
}

$("prev").onclick = () => { view = view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 }; renderCalendar(); };
$("next").onclick = () => { view = view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 }; renderCalendar(); };

for (const [id, key] of [["set-cycle", "cycleLength"], ["set-period", "periodLength"], ["set-luteal", "lutealDays"]]) {
  $(id).addEventListener("change", (e) => {
    data.settings[key] = +e.target.value;
    data = normalizeData(data);
    commit();
  });
}

$("set-remind").addEventListener("change", (e) => { data.settings.remindDays = +e.target.value; commit("Reminder updated"); });
$("notify").onclick = async () => {
  try { await Notification.requestPermission(); } catch { /* ignore */ }
  render();
};
$("ics").onclick = () => {
  if (!data.periods.length) { toast("Log a period first so there is something to predict."); return; }
  const blob = new Blob([buildICS(data)], { type: "text/calendar" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "cycle-tracker-predictions.ics" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `cycle-tracker-${today}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("import").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const imported = normalizeData(JSON.parse(await file.text()));
    if (data.periods.length && !confirm("Importing replaces your current data. Continue?")) return;
    data = imported;
    commit(`Imported ${plural(data.periods.length, "period")}`);
  } catch {
    toast("That file isn't a valid Cycle Tracker export.");
  }
};
$("wipe").onclick = () => {
  if (!confirm("Delete ALL your data from this device? This cannot be undone.")) return;
  wipe();
  data = emptyData();
  render();
  toast("All data deleted");
};

document.addEventListener("visibilitychange", () => { if (!document.hidden && todayStr() !== today) render(); });
render();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
