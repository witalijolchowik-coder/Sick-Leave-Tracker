import assert from "node:assert/strict";
import test from "node:test";
import { zusFreshness } from "../src/lib/zusFreshness.js";

test("freshness uses the Warsaw calendar day at midnight, including a server timestamp", () => {
  const timestamp = { toDate: () => new Date("2026-11-08T23:05:00Z") };
  const monday = new Date("2026-11-09T00:00:00Z");
  assert.equal(zusFreshness(timestamp, monday).label, "Dane ZUS zaktualizowane dzisiaj");
  assert.equal(zusFreshness(null, monday).label, "Brak danych ZUS");
});

test("Friday is the previous working day on Monday, with separate weekend upload wording", () => {
  const monday = new Date("2026-11-09T12:00:00Z");
  assert.equal(zusFreshness("2026-11-06T12:00:00Z", monday).label, "Dane ZUS z poprzedniego dnia roboczego");
  assert.equal(zusFreshness("2026-11-05T12:00:00Z", monday).label, "Dane ZUS wymagają aktualizacji");
  assert.equal(zusFreshness("2026-11-08T12:00:00Z", monday).label, "Dane ZUS zaktualizowane po poprzednim dniu roboczym");
});

test("the previous working day skips Polish fixed and movable holidays", () => {
  for (const [uploaded, now] of [
    ["2026-11-10", "2026-11-12"],
    ["2026-04-03", "2026-04-07"],
    ["2026-06-03", "2026-06-05"],
    ["2026-12-23", "2026-12-28"],
  ]) {
    assert.equal(zusFreshness(uploaded + "T12:00:00Z", new Date(now + "T12:00:00Z")).label,
      "Dane ZUS z poprzedniego dnia roboczego");
  }
});
