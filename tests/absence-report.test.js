import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildAbsenceReport } from "../src/lib/absenceReport.js";
import { getHermesProject } from "../src/lib/projectIdentity.js";

const template = await readFile(new URL("../src/assets/absence-template.xlsx", import.meta.url));
const toyota = "Toyota Boshoku Poland PT (PSTZ)";
const toyotaPl = "Toyota Boshoku Poland PT PL (PSTZ)";
const employee = { project: toyota, firstName: "Żaneta", lastName: "Test & Przykład", pesel: "01234567890", passport: "00042" };
const period = { start: "2026-10-01", end: "2026-10-31" };

test("Absencja clips both edges, keeps Excel dates and text identifiers, and excludes other projects and non-overlap", () => {
  const rows = [
    { start: "2026-09-29", end: "2026-10-05", employee },
    { start: "2026-10-29", end: "2026-11-10", employee },
    { start: "2026-09-25", end: "2026-11-10", employee },
    { start: "2026-10-10", end: "2026-10-15", employee },
    { start: "2026-11-01", end: "2026-11-02", employee },
    { start: "2026-10-10", end: "2026-10-15", employee: { ...employee, project: toyotaPl } },
  ];
  const original = structuredClone(rows);
  const report = XLSX.read(buildAbsenceReport(template, rows, 12, toyota, period), { cellDates: true });
  assert.deepEqual(report.SheetNames, ["Absencja", "Słownik"]);
  const sheet = report.Sheets.Absencja;
  assert.equal(sheet["!ref"], "A1:K5");
  assert.equal(sheet["!autofilter"].ref, "A1:K5");
  assert.equal(sheet.A2.v, "TEST & PRZYKŁAD");
  assert.equal(sheet.C2.t, "s");
  assert.equal(sheet.C2.v, "00042");
  assert.equal(sheet.D2.t, "s");
  assert.equal(sheet.D2.v, "01234567890");
  assert.deepEqual([2, 3, 4, 5].map(i => [sheet[`G${i}`].w, sheet[`H${i}`].w, sheet[`I${i}`].v, sheet[`J${i}`].v]), [
    ["10/1/26", "10/5/26", 3, 36], ["10/29/26", "10/31/26", 2, 24],
    ["10/1/26", "10/31/26", 22, 264], ["10/10/26", "10/15/26", 4, 48],
  ]);
  assert.equal(sheet.G2.t, "d");
  const dictionary = XLSX.utils.sheet_to_json(report.Sheets.Słownik, { header: 1 });
  assert.deepEqual(dictionary.slice(1).map(row => row[2]), ["NN", "NU", "NI", "UW", "UB", "OP", "UO", "L4", "LO", "O5", "SR", "GN"]);
  assert.deepEqual(rows, original);
});

test("PL passports stay blank and missing PESEL is never replaced by the leave identifier", () => {
  const row = { id: "00042", start: "2026-10-15", end: "2026-10-19", employee: { ...employee, project: toyotaPl, pesel: "" } };
  const range = { start: "2026-10-16", end: "2026-10-18" };
  const report = XLSX.read(buildAbsenceReport(template, [row], 8, "all", range));
  assert.equal(report.Sheets.Absencja.C2, undefined);
  assert.equal(report.Sheets.Absencja.D2, undefined);
  assert.equal(report.Sheets.Absencja.J2.v, 8);
  assert.equal(buildAbsenceReport(template, [row], 8, toyota, range), null);
});

test("Hermes projects keep the same 11 columns and apply passport rules independently", () => {
  const hermes = getHermesProject("Hermes Fulfilment Sp. z o.o. UZwPT (USZO)");
  const pl = getHermesProject("Hermes Fulfilment Sp. z o.o. PL UZwPT (USZO)");
  const rows = [hermes, pl].map(({ id, name }) => ({
    start: "2026-09-29", end: "2026-10-05",
    employee: { ...employee, project: name, projectId: id },
  }));
  const sheet = XLSX.read(buildAbsenceReport(template, rows, 8, "all", period)).Sheets.Absencja;
  assert.equal(sheet["!ref"], "A1:K3");
  assert.equal(sheet.C2.v, "00042");
  assert.equal(sheet.C3, undefined);
  assert.equal(sheet.D2.v, "01234567890");
  assert.equal(sheet.D3.v, "01234567890");
  assert.equal(sheet.G2.w, "10/1/26");
  assert.equal(sheet.G3.w, "10/1/26");
});
