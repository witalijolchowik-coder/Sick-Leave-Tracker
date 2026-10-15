import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSickLeaveSummary,
  cleanPngWorkplace,
  formatPngDate,
  sickLeavePngFilename,
} from "../src/lib/sickLeavePng.js";

const row = {
  id: "12345678901",
  certificate: "AB 0123456",
  issuedAt: "2026-10-11",
  start: "2026-10-12",
  end: "2026-10-15",
  care: true,
  hospital: true,
  companies: ["US"],
  employee: {
    firstName: "Євген",
    lastName: "Żółć",
    fullName: "Żółć Євген",
    employerName: "Ukrainian Service Sp. z o.o.",
    project: "Hermes Fulfilment Sp. z o.o. UZwPT",
    pesel: "12345678901",
    archived: true,
  },
};

test("summary keeps legal employer, workplace and certificate data separate and excludes private fields", () => {
  assert.deepEqual(buildSickLeaveSummary(row), {
    employer: "Ukrainian Service Sp. z o.o.",
    workplace: "Hermes Fulfilment Sp. z o.o.",
    employeeName: "Євген Żółć",
    certificate: "AB 0123456",
    issuedAt: "11.10.2026",
    period: "12.10.2026 – 15.10.2026",
  });
});

test("legacy and incomplete records never infer an employer or export a synthetic certificate or identity", () => {
  const legacy = { ...row, certificate: `${row.id}-${row.start}-${row.end}`, employee: { project: "Toyota Boshoku Poland (PSTZ)" } };
  assert.equal(buildSickLeaveSummary(legacy).employer, "Brak danych");
  assert.equal(buildSickLeaveSummary(legacy).certificate, "Brak danych");
  assert.equal(buildSickLeaveSummary({ ...legacy, employee: { fullName: row.id } }).employeeName, "Brak danych");
  assert.equal(buildSickLeaveSummary({ ...row, certificate: "" }).certificate, "Brak danych");
  assert.equal(buildSickLeaveSummary({ ...row, issuedAt: "2026-02-30" }).issuedAt, "Brak danych");
});

test("only recognized trailing project suffixes are removed", () => {
  assert.equal(cleanPngWorkplace("Toyota Boshoku Poland (PSTZ)"), "Toyota Boshoku Poland");
  assert.equal(cleanPngWorkplace("ID Logistics (USZO)"), "ID Logistics");
  assert.equal(cleanPngWorkplace("Cerland (Poland) (USZO)"), "Cerland (Poland)");
  assert.equal(cleanPngWorkplace("SRG Global (Poland)"), "SRG Global (Poland)");
  assert.equal(cleanPngWorkplace("USZO Logistics"), "USZO Logistics");
  assert.equal(cleanPngWorkplace("Cerland (PS)"), "Cerland");
  assert.equal(cleanPngWorkplace("Bez projektu"), "Brak danych");
});

test("employer codes are never displayed as verified legal company names", () => {
  for (const employerName of ["US", "PS", "PSTZ", "(USZO)"]) {
    assert.equal(buildSickLeaveSummary({ ...row, employee: { ...row.employee, employerName } }).employer, "Brak danych");
  }
  assert.equal(buildSickLeaveSummary({ ...row, companies: ["CUSTOM"], employee: { ...row.employee, employerName: "CUSTOM" } }).employer, "Brak danych");
});

test("Unicode filenames use the individual certificate dates and remove invalid filename characters", () => {
  assert.equal(sickLeavePngFilename(row), "Євген_Żółć_L4_12.10.2026-15.10.2026.png");
  assert.equal(sickLeavePngFilename({ ...row, employee: { firstName: 'J/an:*?"<>|', lastName: "Kowalski\\Nowak" }, end: "2026-11-01" }), "Jan_KowalskiNowak_L4_12.10.2026-01.11.2026.png");
  assert.equal(sickLeavePngFilename({}), "Brak_danych_L4_Brak_danych-Brak_danych.png");
  assert.notEqual(sickLeavePngFilename(row), sickLeavePngFilename({ ...row, start: "2026-10-14" }));
});

test("dates remain exact across parsing and a persisted JSON round trip", () => {
  assert.equal(formatPngDate("2024-02-29"), "29.02.2024");
  assert.equal(formatPngDate("2025-02-29"), "Brak danych");
  assert.equal(formatPngDate("12.10.2026"), "12.10.2026");
  assert.equal(formatPngDate("not a date"), "Brak danych");
  assert.deepEqual(buildSickLeaveSummary(JSON.parse(JSON.stringify(row))), buildSickLeaveSummary(row));
});
