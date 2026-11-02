import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData, addPeriodStart, endPeriod, removePeriod, cycleLengths, stats, predict,
  currentCycle, classifyDay, normalizeData, addDays, diffDays, todayStr, remindersFor, buildICS,
} from "../src/cycle.js";

const mk = (starts) => {
  const d = emptyData();
  starts.forEach((s) => addPeriodStart(d, s));
  return d;
};

test("date helpers cross month, year and DST boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(diffDays("2026-03-30", "2026-03-28"), 2);
  assert.equal(todayStr(new Date(2026, 10, 2)), "2026-11-02");
});

test("period starts stay sorted and near duplicates merge", () => {
  const d = mk(["2026-02-01", "2026-01-01", "2026-01-03"]);
  assert.deepEqual(d.periods.map((p) => p.start), ["2026-01-01", "2026-02-01"]);
});

test("endPeriod sets end on the latest period, ignores stale ones", () => {
  const d = mk(["2026-01-01"]);
  endPeriod(d, "2026-01-05");
  assert.equal(d.periods[0].end, "2026-01-05");
  endPeriod(d, "2026-03-01");
  assert.equal(d.periods[0].end, "2026-01-05");
});

test("removePeriod", () => {
  const d = mk(["2026-01-01", "2026-01-29"]);
  removePeriod(d, "2026-01-01");
  assert.equal(d.periods.length, 1);
});

test("cycleLengths drops outliers", () => {
  const d = mk(["2026-01-01", "2026-01-29", "2026-02-26", "2026-08-01"]);
  assert.deepEqual(cycleLengths(d.periods).map((c) => c.length), [28, 28]);
});

test("stats uses defaults with no history, averages with history", () => {
  assert.equal(stats(emptyData()).avgCycle, 28);
  assert.equal(stats(emptyData()).hasHistory, false);
  const s = stats(mk(["2026-01-01", "2026-01-29", "2026-02-28"]));
  assert.equal(s.avgCycle, 29);
  assert.equal(s.cycleCount, 2);
  assert.equal(s.shortest, 28);
  assert.equal(s.longest, 30);
});

test("predict: ovulation is luteal days before next period; fertile window 5 before to 1 after", () => {
  const [p] = predict(mk(["2026-01-01", "2026-01-29"]), 1);
  assert.equal(p.periodStart, "2026-02-26");
  assert.equal(p.ovulation, "2026-02-12");
  assert.equal(p.fertileStart, "2026-02-07");
  assert.equal(p.fertileEnd, "2026-02-13");
});

test("predict returns requested count and nothing without data", () => {
  assert.deepEqual(predict(emptyData()), []);
  const ps = predict(mk(["2026-01-01"]), 3);
  assert.deepEqual(ps.map((p) => p.periodStart), ["2026-01-29", "2026-02-26", "2026-03-26"]);
});

test("uncertainty grows with irregular cycles and is capped", () => {
  const regular = predict(mk(["2026-01-01", "2026-01-29", "2026-02-26"]), 1)[0];
  const irregular = predict(mk(["2026-01-01", "2026-01-22", "2026-02-27", "2026-03-20"]), 1)[0];
  assert.ok(irregular.uncertainty > regular.uncertainty);
  assert.ok(irregular.uncertainty <= 7);
});

test("currentCycle: day number, phases, countdown, lateness", () => {
  const d = mk(["2026-01-01"]);
  endPeriod(d, "2026-01-05");
  let c = currentCycle(d, "2026-01-01");
  assert.equal(c.day, 1);
  assert.equal(c.phase, "menstrual");
  assert.equal(currentCycle(d, "2026-01-08").phase, "follicular");
  assert.equal(currentCycle(d, "2026-01-14").phase, "fertile");
  assert.equal(currentCycle(d, "2026-01-22").phase, "luteal");
  c = currentCycle(d, "2026-01-20");
  assert.equal(c.daysUntilPeriod, 9);
  assert.equal(c.lateBy, 0);
  assert.equal(currentCycle(d, "2026-02-02").lateBy, 4);
  assert.equal(currentCycle(emptyData(), "2026-01-01"), null);
});

test("currentCycle ignores periods in the future of 'today'", () => {
  const d = mk(["2026-01-01", "2026-01-29"]);
  assert.equal(currentCycle(d, "2026-01-15").periodStart, "2026-01-01");
});

test("classifyDay tags actual, predicted, fertile and ovulation days", () => {
  const d = mk(["2026-01-01", "2026-01-29"]);
  endPeriod(d, "2026-01-05");
  const today = "2026-02-02";
  const preds = predict(d, 2);
  assert.ok(classifyDay(d, "2026-01-02", preds, today).has("period"));
  assert.ok(classifyDay(d, "2026-02-26", preds, today).has("predicted-period"));
  assert.ok(classifyDay(d, "2026-02-12", preds, today).has("ovulation"));
  assert.ok(classifyDay(d, "2026-02-09", preds, today).has("fertile"));
  assert.equal(classifyDay(d, "2026-02-03", preds, today).size, 0);
});

test("normalizeData rejects junk, cleans bad fields, clamps settings", () => {
  assert.throws(() => normalizeData(null));
  const n = normalizeData({
    periods: [{ start: "2026-02-01" }, { start: "bad" }, { start: "2026-01-01", end: "2025-01-01" }],
    logs: { "2026-01-02": { flow: "oops", symptoms: ["cramps", 5], notes: "hi" }, nope: {} },
    settings: { lutealDays: 99, cycleLength: 30 },
  });
  assert.deepEqual(n.periods, [{ start: "2026-01-01" }, { start: "2026-02-01" }]);
  assert.deepEqual(Object.keys(n.logs), ["2026-01-02"]);
  assert.equal(n.logs["2026-01-02"].flow, undefined);
  assert.deepEqual(n.logs["2026-01-02"].symptoms, ["cramps"]);
  assert.equal(n.settings.lutealDays, 14);
  assert.equal(n.settings.cycleLength, 30);
});

test("average period length ignores 1-day entries and uses real ones", () => {
  const d = mk(["2026-01-01", "2026-01-29", "2026-02-26"]);
  d.periods[0].end = "2026-01-01"; // mis-tap
  assert.equal(stats(d).avgPeriod, 5); // falls back to default
  d.periods[1].end = "2026-02-02"; // 5 days
  d.periods[2].end = "2026-03-01"; // 4 days
  assert.equal(stats(d).avgPeriod, 5);
});

test("remindersFor: upcoming, today, late, fertile start, off, nothing logged", () => {
  const d = mk(["2026-09-01", "2026-09-29", "2026-10-27"]); // next period 2026-11-24, fertile starts 11-05
  assert.deepEqual(remindersFor(d, "2026-11-21"), []); // 3 days out, default 2
  assert.match(remindersFor(d, "2026-11-22")[0].text, /in 2 days/);
  assert.match(remindersFor(d, "2026-11-23")[0].text, /in 1 day\./);
  assert.match(remindersFor(d, "2026-11-24")[0].text, /today/);
  assert.match(remindersFor(d, "2026-11-26")[0].text, /2 days later/);
  assert.match(remindersFor(d, "2026-11-05")[0].text, /fertile window starts today/);
  assert.equal(remindersFor(d, "2026-11-05")[0].id, "fertile:2026-11-05");
  d.settings.remindDays = 0;
  assert.deepEqual(remindersFor(d, "2026-11-24"), []);
  assert.deepEqual(remindersFor(emptyData(), "2026-11-24"), []);
});

test("remindDays is clamped on import", () => {
  assert.equal(normalizeData({ settings: { remindDays: 50 } }).settings.remindDays, 2);
  assert.equal(normalizeData({ settings: { remindDays: 0 } }).settings.remindDays, 0);
});

test("buildICS makes a valid-looking calendar with CRLF lines, alarms and no raw newlines in values", () => {
  const d = mk(["2026-09-01", "2026-09-29", "2026-10-27"]);
  const ics = buildICS(d, new Date("2026-11-02T10:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 12);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 12);
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261124"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261129")); // exclusive end: 5-day period
  assert.ok(ics.includes("TRIGGER:-P2D"));
  d.settings.remindDays = 0;
  assert.ok(!buildICS(d).includes("VALARM"));
  assert.equal(buildICS(emptyData()).includes("VEVENT"), false);
});
