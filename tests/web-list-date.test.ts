// Published dates on list pages: a date without a zone is read in the source's offset, whatever zone
// the server runs in (Docker runs in UTC; run this file with TZ=UTC and TZ=Asia/Shanghai to see both).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLooseDate } from "@aihot/backend/sources/web-list";

const iso = (v: string, offset?: string, dayFirst = false) => parseLooseDate(v, offset, dayFirst)?.toISOString() ?? null;

test("a day-first date (Brazil DD/MM/YYYY) is read as day-first, in the source's offset, only when asked", () => {
  assert.equal(iso("25/09/2026", "-03:00", true), "2026-09-25T03:00:00.000Z");
  assert.equal(iso("25.09.2026", "-03:00", true), "2026-09-25T03:00:00.000Z");
  // A day ≤ 12 is still read day-first, not month-first, when the flag is on.
  assert.equal(iso("02/09/2026", "-03:00", true), "2026-09-02T03:00:00.000Z");
  // Without the flag, a day-first slash date is not read at all (avoid US/BR ambiguity).
  assert.equal(iso("25/09/2026", "-03:00"), null);
});

test("a date and time without a zone is in the source's offset, not the server's", () => {
  assert.equal(iso("2026-09-26 10:00"), "2026-09-26T02:00:00.000Z");
  assert.equal(iso("2026-09-26T10:00:00"), "2026-09-26T02:00:00.000Z");
  assert.equal(iso("2026/09/26 10:00"), "2026-09-26T02:00:00.000Z");
  assert.equal(iso("2026年9月26日 10:00"), "2026-09-26T02:00:00.000Z");
  assert.equal(iso("2026-09-26 10:00", "-07:00"), "2026-09-26T17:00:00.000Z");
});

test("a bare date is midnight in the source's offset; an ISO date alone stays UTC midnight", () => {
  assert.equal(iso("2026/09/26"), "2026-09-25T16:00:00.000Z");
  assert.equal(iso("2026年9月26日"), "2026-09-25T16:00:00.000Z");
  assert.equal(iso("Sep 26, 2026"), "2026-09-25T16:00:00.000Z");
  assert.equal(iso("2026-09-26"), "2026-09-26T00:00:00.000Z");
  assert.equal(iso("September 26th, 2026", "+00:00"), "2026-09-26T00:00:00.000Z");
});

test("a date that carries its zone keeps it", () => {
  assert.equal(iso("2026-09-26T10:00:00Z"), "2026-09-26T10:00:00.000Z");
  assert.equal(iso("2026-09-26T10:00:00.000+09:00"), "2026-09-26T01:00:00.000Z");
  assert.equal(iso("Sat, 26 Sep 2026 10:00:00 GMT"), "2026-09-26T10:00:00.000Z");
  assert.equal(iso("Sat, 26 Sep 2026 10:00:00 +0200", "-07:00"), "2026-09-26T08:00:00.000Z");
});

test("an Arabic date (Zawya Arabic Eastern Arabic-Indic digits) is read in the source's offset", () => {
  // "نُشر ٢ أكتوبر ٢٠٢٦, ١٤:٤٥ (GMT+8)" → 2 October 2026 at midnight in +08:00.
  assert.equal(iso("نُشر ٢ أكتوبر ٢٠٢٦, ١٤:٤٥ (GMT+8)", "+08:00"), "2026-10-01T16:00:00.000Z");
  // ASCII digits + word directly work too, and the ال prefix on the month is tolerated.
  assert.equal(iso("نشر 25 يناير 2026", "+08:00"), "2026-01-24T16:00:00.000Z");
  assert.equal(iso("نشر 3 فبراير 2026", "+08:00"), "2026-02-02T16:00:00.000Z");
  assert.equal(iso("نشر 4 مارس 2026", "+08:00"), "2026-03-03T16:00:00.000Z");
  assert.equal(iso("نشر 5 أبريل 2026", "+08:00"), "2026-04-04T16:00:00.000Z");
  assert.equal(iso("نشر 6 مايو 2026", "+08:00"), "2026-05-05T16:00:00.000Z");
  assert.equal(iso("نشر 7 يونيو 2026", "+08:00"), "2026-06-06T16:00:00.000Z");
  assert.equal(iso("نشر 8 يوليو 2026", "+08:00"), "2026-07-07T16:00:00.000Z");
  assert.equal(iso("نشر 9 أغسطس 2026", "+08:00"), "2026-08-08T16:00:00.000Z");
  assert.equal(iso("نشر 10 سبتمبر 2026", "+08:00"), "2026-09-09T16:00:00.000Z");
  assert.equal(iso("نشر 11 نوفمبر 2026", "+08:00"), "2026-11-10T16:00:00.000Z");
  assert.equal(iso("نشر 12 ديسمبر 2026", "+08:00"), "2026-12-11T16:00:00.000Z");
});

test("no date at all is null", () => {
  assert.equal(iso(""), null);
  assert.equal(iso("yesterday"), null);
});
