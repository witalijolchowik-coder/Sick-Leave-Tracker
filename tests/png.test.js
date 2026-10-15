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
    workplace: "Hermes Fulfilment, Konin Żagański",
    employeeName: "Євген Żółć",
    certificate: "AB 0123456",
    issuedAt: "11.10.2026",
    period: "12.10.2026 – 15.10.2026",
  });
});

test("legacy and incomplete records never infer an employer or export a synthetic certificate or identity", () => {
  const legacy = { ...row, companies: [], certificate: `${row.id}-${row.start}-${row.end}`, employee: { project: "Toyota Boshoku Poland (PSTZ)" } };
  assert.equal(buildSickLeaveSummary(legacy).employer, "Brak danych");
  assert.equal(buildSickLeaveSummary(legacy).certificate, "Brak danych");
  assert.equal(buildSickLeaveSummary({ ...legacy, employee: { fullName: row.id } }).employeeName, "Brak danych");
  assert.equal(buildSickLeaveSummary({ ...row, certificate: "" }).certificate, "Brak danych");
  assert.equal(buildSickLeaveSummary({ ...row, issuedAt: "2026-02-30" }).issuedAt, "Brak danych");
});

test("verified dashboard projects use their approved PNG workplace names", () => {
  const projects = [
    ["Cerland (PS)", "Cerland Industry, Przejęsław"],
    ["Hermes Fulfilment Sp. z o.o. UZwPT", "Hermes Fulfilment, Konin Żagański"],
    ["ID Logistics (USZO)", "ID Logistics, Magazyn w Zgorzelcu"],
    ["SRG Global (Poland)", "RESRG Automotive, Bolesławiec"],
    ["Toyota Boshoku Poland PT (PSTZ)", "Toyota Boshoku Poland"],
    ["Toyota Boshoku Poland PT PL (PS)", "Toyota Boshoku Poland"],
  ];
  for (const [project, workplace] of projects) {
    const record = { ...row, employee: { ...row.employee, project, projectId: `unchanged-${project}` } };
    const before = JSON.stringify(record);
    const summary = buildSickLeaveSummary(record);
    assert.equal(summary.workplace, workplace);
    assert.equal(summary.employer, "Ukrainian Service Sp. z o.o.");
    assert.equal(JSON.stringify(record), before, "Project identity and source record must remain unchanged");
    assert.equal(cleanPngWorkplace(project.toUpperCase()), workplace);
  }
});

test("unmapped projects retain existing suffix cleanup", () => {
  assert.equal(cleanPngWorkplace("Toyota Boshoku Poland (PSTZ)"), "Toyota Boshoku Poland");
  assert.equal(cleanPngWorkplace("Other Workplace (Poland) (USZO)"), "Other Workplace (Poland)");
  assert.equal(cleanPngWorkplace("Other Workplace (Poland)"), "Other Workplace (Poland)");
  assert.equal(cleanPngWorkplace("USZO Logistics"), "USZO Logistics");
  assert.equal(cleanPngWorkplace("Bez projektu"), "Brak danych");
});

test("all confirmed ZUS worksheet names resolve to full legal employer names", () => {
  const employers = {
    US: "Ukrainian Service Sp. z o.o.",
    PST: "Personnel Support Sp. z o.o.",
    PS: "Personnel Service Sp. z o.o.",
    HS: "Human Support Sp. z o.o.",
    HCS: "Human Capital Service Sp. z o.o.",
    RENESANS: "Renesans",
  };
  for (const [worksheet, employer] of Object.entries(employers)) {
    const record = { ...row, companies: [worksheet], employee: { ...row.employee, employerName: "Ignored employee value", companies: ["PS"] } };
    assert.equal(buildSickLeaveSummary(record).employer, employer);
    assert.equal(buildSickLeaveSummary(JSON.parse(JSON.stringify(record))).employer, employer);
    assert.equal(buildSickLeaveSummary({ ...record, companies: [` ${worksheet.toLowerCase()} `, worksheet] }).employer, employer);
    const { employer: ignored, ...rest } = buildSickLeaveSummary(record);
    const { employer: originalEmployer, ...originalRest } = buildSickLeaveSummary(row);
    assert.deepEqual(rest, originalRest, "Only the employer field may change");
  }
});

test("missing, unknown and conflicting worksheets never infer an employer from employee data", () => {
  for (const companies of [undefined, [], [""], ["CUSTOM"], ["USZO"], ["PSTZ"], ["US", "PS"], ["US", "CUSTOM"]]) {
    assert.equal(buildSickLeaveSummary({ ...row, companies }).employer, "Brak danych");
  }
  assert.equal(buildSickLeaveSummary({ ...row, employee: { project: "Toyota Boshoku Poland (PSTZ)" } }).employer, "Ukrainian Service Sp. z o.o.");
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
