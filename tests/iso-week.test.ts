// ISO week + Europe/Berlin scheduling (CET/CEST) tests.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  atBerlinTime,
  berlinOffsetMs,
  berlinWallClock,
  fridayBerlin830,
  isFridayBerlinRunSlot,
  isoWeekIdOf,
  mondayOfIsoWeek,
} from "../shared/iso-week.ts";

test("isoWeekIdOf: 2026-11-20 falls in 2026-W47", () => {
  assert.equal(isoWeekIdOf(new Date("2026-11-20T10:00:00Z")), "2026-W47");
});

test("isoWeekIdOf: the four ROARA sample briefs map to W42-W45", () => {
  assert.equal(isoWeekIdOf(new Date("2026-10-16T10:00:00Z")), "2026-W42");
  assert.equal(isoWeekIdOf(new Date("2026-10-23T10:00:00Z")), "2026-W43");
  assert.equal(isoWeekIdOf(new Date("2026-10-30T10:00:00Z")), "2026-W44");
  assert.equal(isoWeekIdOf(new Date("2026-11-06T10:00:00Z")), "2026-W45");
});

test("isoWeekIdOf handles ISO year boundaries", () => {
  // 2026-01-01 is a Thursday -> W01 of 2026; its Monday is 2025-12-29.
  assert.equal(isoWeekIdOf(new Date("2025-12-29T00:00:00Z")), "2026-W01");
  assert.equal(isoWeekIdOf(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  // 2027-01-01 (Friday) belongs to 2026-W53.
  assert.equal(isoWeekIdOf(new Date("2027-01-01T00:00:00Z")), "2026-W53");
});

test("mondayOfIsoWeek inverts isoWeekIdOf for every week of 2026 (53 weeks)", () => {
  for (let w = 1; w <= 53; w++) {
    const id = `2026-W${String(w).padStart(2, "0")}`;
    const monday = mondayOfIsoWeek(id);
    assert.equal(monday.toISOString().slice(0, 10), monday.toISOString().slice(0, 10));
    assert.equal(isoWeekIdOf(monday), id, `${id} should round-trip`);
  }
  assert.equal(mondayOfIsoWeek("2026-W47").toISOString().slice(0, 10), "2026-11-16");
});

test("mondayOfIsoWeek rejects nonsensical week ids", () => {
  assert.throws(() => mondayOfIsoWeek("2026-W54"));
  assert.throws(() => mondayOfIsoWeek("2026-W00"));
  assert.throws(() => mondayOfIsoWeek("not-a-week"));
});

test("fridayBerlin830 resolves CET vs CEST explicitly", () => {
  // W47 Friday = 2026-11-20. Berlin is CET (UTC+1) in November.
  assert.equal(fridayBerlin830("2026-W47").toISOString(), "2026-11-20T07:30:00.000Z");
  // W30 Friday = 2026-07-24. Berlin is CEST (UTC+2) in July.
  assert.equal(fridayBerlin830("2026-W30").toISOString(), "2026-07-24T06:30:00.000Z");
});

test("berlinOffsetMs knows CET (+1h) and CEST (+2h)", () => {
  assert.equal(berlinOffsetMs(new Date("2026-11-20T12:00:00Z")), 3600000);
  assert.equal(berlinOffsetMs(new Date("2026-07-20T12:00:00Z")), 7200000);
});

test("berlinWallClock renders 07:30Z as 08:30 Berlin", () => {
  const wc = berlinWallClock(new Date("2026-11-20T07:30:00Z"));
  assert.equal(wc.date, "2026-11-20");
  assert.equal(wc.hours, 8);
  assert.equal(wc.minutes, 30);
});

test("cron guard selects exactly one 08:30 Berlin slot per week", () => {
  // Winter week W47: the "30 7 * * 5" UTC cron fires the real slot.
  assert.equal(isFridayBerlinRunSlot(new Date("2026-11-20T07:30:00Z")), true);
  assert.equal(isFridayBerlinRunSlot(new Date("2026-11-20T07:15:00Z")), true); // within tolerance
  // The other cron's slot (06:30 UTC) is NOT the run slot in winter.
  assert.equal(isFridayBerlinRunSlot(new Date("2026-11-20T06:30:00Z")), false);
  // Summer week W30: the "30 6 * * 5" UTC cron fires the real slot.
  assert.equal(isFridayBerlinRunSlot(new Date("2026-07-24T06:30:00Z")), true);
  assert.equal(isFridayBerlinRunSlot(new Date("2026-07-24T07:30:00Z")), false);
  // Not a Friday slot at all (Saturday and Tuesday of W47).
  assert.equal(isFridayBerlinRunSlot(new Date("2026-11-21T07:30:00Z")), false);
  assert.equal(isFridayBerlinRunSlot(new Date("2026-11-17T07:30:00Z")), false);
});

test("atBerlinTime converts a Berlin wall time to the right instant", () => {
  assert.equal(atBerlinTime(new Date("2026-11-20T00:00:00Z"), 8, 30).toISOString(), "2026-11-20T07:30:00.000Z");
  assert.equal(atBerlinTime(new Date("2026-07-24T00:00:00Z"), 8, 30).toISOString(), "2026-07-24T06:30:00.000Z");
});
