import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as XLSX from "xlsx";
import * as data from "../src/lib/data.js";
import * as projectIdentity from "../src/lib/projectIdentity.js";

const workbookFile = (name, sheets) => {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name, arrayBuffer: async () => bytes };
};

const employeeHeaders = ["Obecność", "Nazwisko", "Imię", "Numer paszportu"];
const leaveHeaders = [
  "Seria i nr zaświadczenia", "Kogo dotyczy", "Dokument tożsamości",
  "Data wystawienia", "Niezdolność do pracy",
];

test("employee imports preserve only explicit employer names independently of projects", async () => {
  for (const header of ["Pracodawca", "Nazwa pracodawcy", "Spółka", "Nazwa spółki"]) {
    const [employee] = await data.parseEmployeeFile(workbookFile("pracownicy.xlsx", {
      Personnel: [
        [...employeeHeaders, header],
        ["Hermes Fulfilment (USZO)", "Przykładowa", "Олена", "TESTA", "Przykładowy Pracodawca Sp. z o.o."],
      ],
    }));
    assert.equal(employee.employerName, "Przykładowy Pracodawca Sp. z o.o.");
    assert.equal(employee.project, "Hermes Fulfilment Sp. z o.o. UZwPT");
    assert.deepEqual(employee.companies, ["US"]);
    assert.equal(employee.firstName, "Олена");
  }

  const [withoutEmployer] = await data.parseEmployeeFile(workbookFile("archiwum.xlsx", {
    "USZO": [
      [...employeeHeaders, "Kod pracodawcy", "Projekt pracodawcy"],
      ["Hermes Fulfilment (USZO)", "Testowy", "Jan", "TESTB", "US", "Ukrainian Service"],
    ],
  }));
  assert.equal(withoutEmployer.employerName, "");
  assert.equal(withoutEmployer.archived, true);
});

test("ZUS imports preserve original numbers and issue dates without altering fallback keys", async () => {
  const records = await data.parseSickLeaveFile(workbookFile("zus.xlsx", {
    US: [
      leaveHeaders,
      ["TEST-CERT-01", "Przykładowa Олена", "TESTA", "10.10.2026", "12.10.2026 - 13.10.2026"],
      ["TEST-CERT-02", "Przykładowa Олена", "TESTA", "14.10.2026", "15.10.2026 – 16.10.2026"],
      ["", "Testowy Jan", "TESTB", "", "12.10.2026 - 12.10.2026"],
    ],
  }));
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.certificate), ["TEST-CERT-01", "TEST-CERT-02", "TESTB-2026-10-12-2026-10-12"]);
  assert.equal(records[0].issuedAt, "2026-10-10");
  assert.equal(records[0].start, "2026-10-12");
  assert.equal(records[0].end, "2026-10-13");
  assert.equal(records[2].issuedAt, "");

  const duplicate = { ...records[0], companies: ["PS"] };
  const merged = data.mergeSickLeaves([...records, duplicate]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0].companies, ["US", "PS"]);
  assert.equal(merged[0].certificate, "TEST-CERT-01");
});

// Exercise the real Firestore service with an isolated, in-memory transport.
// No Firebase app, credentials, or remote database is used by these tests.
const firestoreHarness = async () => {
  const documents = new Map();
  let nextId = 0;
  const reference = (parent, ...parts) => ({ path: [parent.path, ...parts].filter(Boolean).join("/") });
  const snapshot = (path, value) => ({
    id: path.split("/").at(-1),
    ref: { path },
    exists: () => value !== undefined,
    data: () => structuredClone(value),
  });
  const setDocument = (ref, value, options) => {
    const previous = options?.merge ? documents.get(ref.path) || {} : {};
    documents.set(ref.path, structuredClone({ ...previous, ...value }));
  };
  const firestore = {
    collection: reference,
    doc: (parent, ...parts) => reference(parent, ...(parts.length ? parts : [`test-${++nextId}`])),
    getDoc: async (ref) => snapshot(ref.path, documents.get(ref.path)),
    getDocs: async (target) => {
      const ref = target.reference || target;
      let entries = [...documents].filter(([path]) =>
        path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/"));
      for (const constraint of target.constraints || []) {
        if (constraint.type === "where") {
          assert.equal(constraint.operator, "==");
          entries = entries.filter(([, value]) => value[constraint.field] === constraint.value);
        } else if (constraint.type === "limit") {
          entries = entries.slice(0, constraint.count);
        }
      }
      return { docs: entries.map(([path, value]) => snapshot(path, value)) };
    },
    limit: (count) => ({ type: "limit", count }),
    onSnapshot: () => () => {},
    orderBy: (field, direction) => ({ type: "orderBy", field, direction }),
    query: (ref, ...constraints) => ({ reference: ref, constraints }),
    serverTimestamp: () => ({ seconds: 1 }),
    setDoc: async (ref, value, options) => setDocument(ref, value, options),
    where: (field, operator, value) => ({ type: "where", field, operator, value }),
    writeBatch: () => {
      const mutations = [];
      return {
        set: (ref, value, options) => mutations.push(() => setDocument(ref, value, options)),
        delete: (ref) => mutations.push(() => documents.delete(ref.path)),
        commit: async () => mutations.forEach((mutation) => mutation()),
      };
    },
    runTransaction: async (_db, update) => {
      const batch = firestore.writeBatch();
      const value = await update({ ...batch, get: firestore.getDoc });
      await batch.commit();
      return value;
    },
  };
  const context = vm.createContext({ console });
  const moduleFrom = (exports) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context });
  const dependencies = {
    "firebase/firestore": moduleFrom(firestore),
    "../config/firebase": moduleFrom({ db: { path: "" } }),
    "../lib/data": moduleFrom(data),
    "../lib/projectIdentity.js": moduleFrom(projectIdentity),
  };
  const source = await readFile(new URL("../src/services/firestoreData.js", import.meta.url), "utf8");
  const service = new vm.SourceTextModule(source, { context });
  await service.link((specifier) => {
    assert.ok(dependencies[specifier], `Unexpected service dependency: ${specifier}`);
    return dependencies[specifier];
  });
  await service.evaluate();
  return { service: service.namespace, documents };
};

test("employer and certificate metadata survives actual service writes and reloads for active and archived employees", async () => {
  const { service } = await firestoreHarness();
  const active = await data.parseEmployeeFile(workbookFile("pracownicy.xlsx", {
    Employees: [
      [...employeeHeaders, "Nazwa pracodawcy"],
      ["Hermes Fulfilment (USZO)", "Przykładowa", "Олена", "TESTA", "Pracodawca Testowy A Sp. z o.o."],
      ["Toyota Boshoku Poland (PSTZ)", "Testowy", "Jan", "TESTB", "Pracodawca Testowy B Sp. z o.o."],
    ],
  }));
  const archive = await data.parseEmployeeFile(workbookFile("archiwum.xlsx", {
    Employees: [
      [...employeeHeaders, "Pracodawca"],
      ["Cerland (PS)", "Archiwalna", "Anna", "TESTC", "Pracodawca Testowy C Sp. z o.o."],
    ],
  }));
  for (const employee of [...active, ...archive]) {
    await service.replaceProjectEmployees({
      projectName: employee.project,
      archived: employee.archived,
      records: [employee],
      user: { uid: "test-user" },
    });
  }
  const records = await data.parseSickLeaveFile(workbookFile("zus.xlsx", {
    US: [
      leaveHeaders,
      ["TEST-A1", "Przykładowa Олена", "TESTA", "10.10.2026", "12.10.2026 - 13.10.2026"],
      ["TEST-A2", "Przykładowa Олена", "TESTA", "14.10.2026", "15.10.2026 - 16.10.2026"],
    ],
    PSTZ: [
      leaveHeaders,
      ["TEST-B1", "Testowy Jan", "TESTB", "10.10.2026", "12.10.2026 - 13.10.2026"],
    ],
    PS: [
      leaveHeaders,
      ["TEST-C1", "Archiwalna Anna", "TESTC", "10.10.2026", "12.10.2026 - 13.10.2026"],
    ],
  }));
  await service.replaceSickLeaves({ records, user: { uid: "test-user" } });
  const restored = await service.loadCloudData();
  assert.deepEqual(Array.from(restored.activeEmployees, (employee) => employee.employerName), active.map((employee) => employee.employerName));
  assert.equal(restored.archivedEmployees[0].employerName, archive[0].employerName);
  assert.equal(restored.archivedEmployees[0].archived, true);
  assert.deepEqual(Array.from(restored.sickLeaves, (record) => [record.certificate, record.issuedAt, record.start, record.end]), records.map((record) => [record.certificate, record.issuedAt, record.start, record.end]));

  const results = data.searchSickLeaves({
    employees: [...restored.activeEmployees, ...restored.archivedEmployees],
    sickLeaves: restored.sickLeaves,
  });
  assert.equal(results.length, 4);
  assert.equal(results.filter((record) => record.id === "TESTA").length, 2);
  assert.equal(results.find((record) => record.id === "TESTC").employee.employerName, archive[0].employerName);
});

test("legacy records keep real certificates and lack of employer data through replacement and reload", async () => {
  const { service, documents } = await firestoreHarness();
  documents.set("projects/legacy", {
    projectId: "legacy", projectName: "Hermes Fulfilment (USZO)", activeVersion: "old", archivedVersion: "old",
  });
  for (const collection of ["employees", "employeeArchives"]) {
    documents.set(`${collection}/legacy-person`, {
      employeeId: "TESTLEGACY", projectId: "legacy", projectName: "Hermes Fulfilment (USZO)",
      fullName: "Testowy Jan", firstName: "Jan", lastName: "Testowy", version: "old",
    });
  }
  const base = { id: "TESTLEGACY", start: "2026-10-12", end: "2026-10-13", issuedAt: "2026-10-10", companies: ["US"] };
  const legacyReal = { ...base, certificate: "LEGACY-REAL-CERT" };
  const legacySynthetic = { ...base, certificate: "TESTLEGACY-2026-10-12-2026-10-13" };
  await service.replaceSickLeaves({ records: [legacyReal, legacySynthetic] });
  const restored = await service.loadCloudData();
  assert.equal(restored.activeEmployees[0].employerName, "");
  assert.equal(restored.archivedEmployees[0].employerName, "");
  assert.equal(restored.sickLeaves[0].certificate, "LEGACY-REAL-CERT");
  assert.equal(restored.sickLeaves[1].certificate, legacySynthetic.certificate);
});

test("RESRG keeps its current register, projects legacy history once and honors archived hides", async () => {
  const { service, documents } = await firestoreHarness();
  const { RESRG_ID, LEGACY_SRG_ID, RESRG_NAME } = projectIdentity;
  const oldName = "SRG GLOBAL BOLESŁAWIEC SP. Z O.O. UZwPT (USZO)";
  documents.set(`projects/${LEGACY_SRG_ID}`, { projectId: LEGACY_SRG_ID, projectName: oldName, activeVersion: "old", archivedVersion: "old" });
  const record = (id) => ({ id, aliases: [id], pesel: id, passport: "00042", firstName: "Jan", lastName: "Testowy", companies: ["US"] });
  const legacy = (id) => ({ ...record(id), employeeId: id, projectId: LEGACY_SRG_ID, projectName: oldName, version: "old" });
  documents.set("employees/legacy-overlap", legacy("OVERLAP"));
  documents.set("employees/legacy-only", legacy("LEGACY"));
  documents.set("employeeArchives/legacy-overlap", legacy("OVERLAP"));
  documents.set("employeeArchives/legacy-hidden", legacy("HIDDEN"));
  documents.set("hiddenArchiveSickLeaves/legacy-hidden", { archiveKey: `${LEGACY_SRG_ID}::HIDDEN` });
  documents.set("newsEvents/legacy-news", { projectId: LEGACY_SRG_ID, projectName: oldName });
  await service.replaceProjectEmployees({ projectName: RESRG_NAME, records: [record("OVERLAP")], archived: false });
  await service.replaceProjectEmployees({ projectName: "RESRG", records: [record("LEGACY")], archived: true });
  await service.replaceProjectEmployees({ projectName: oldName, records: [record("HISTORIC-IMPORT")], archived: false });
  const leave = (id) => ({ id, start: "2026-10-12", end: "2026-10-15", certificate: `TEST-${id}`, companies: ["US"] });
  const latest = ["OVERLAP", "LEGACY", "HIDDEN", "HISTORIC-IMPORT"].map(leave);
  await service.replaceSickLeaves({ records: latest });
  const cloud = await service.loadCloudData();
  assert.deepEqual(Array.from(cloud.projects, (project) => project.projectId), [RESRG_ID]);
  assert.deepEqual(Array.from(cloud.activeEmployees, (employee) => employee.id), ["OVERLAP"]);
  assert.equal(cloud.newsEvents[0].projectName, RESRG_NAME);
  const employees = data.mergeEmployees([...cloud.activeEmployees, ...cloud.archivedEmployees]);
  const search = (current, history = []) => data.searchSickLeaves({ employees, sickLeaves: [...current, ...history], hiddenArchiveKeys: cloud.hiddenArchiveKeys, project: RESRG_NAME });
  const results = search(cloud.sickLeaves);
  assert.deepEqual(results.map((row) => row.id).sort(), ["HISTORIC-IMPORT", "LEGACY", "OVERLAP"]);
  assert.equal(results.find((row) => row.id === "OVERLAP").employee.archived, false);
  assert.equal(results.find((row) => row.id === "LEGACY").employee.historicalOnly, undefined);
  await service.replaceSickLeaves({ records: [leave("OVERLAP")], employees });
  const reload = await service.loadCloudData();
  assert.equal(reload.sickLeaves.length, 1);
  assert.equal(reload.historicalSickLeaves.length, 3);
  assert.equal(search(reload.sickLeaves, reload.historicalSickLeaves).length, 3);
  assert.equal(documents.has(`projects/${LEGACY_SRG_ID}`), true);
  assert.equal(documents.has("employees/legacy-only"), true);
});

test("visibility writes use separate user documents and leave the shared dataset pointer intact", async () => {
  const { service, documents } = await firestoreHarness();
  documents.set("appState/current", { sickLeavesVersion: "shared" });
  await service.saveProjectVisibility("fixture-a", "cerland", true);
  await service.saveProjectVisibility("fixture-b", "cerland", false);
  assert.deepEqual(documents.get("appState/projectVisibility_fixture-a"), { hiddenProjects: { cerland: true } });
  assert.deepEqual(documents.get("appState/projectVisibility_fixture-b"), { hiddenProjects: { cerland: false } });
  assert.deepEqual(documents.get("appState/current"), { sickLeavesVersion: "shared" });
});
