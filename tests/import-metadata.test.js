import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as XLSX from "xlsx";
import * as data from "../src/lib/data.js";
import * as projectIdentity from "../src/lib/projectIdentity.js";
import { scopeWorkspace } from "../src/lib/workspace.js";

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
const firestoreHarness = async ({ beforeBatch = async () => {}, beforeTransaction = async () => {} } = {}) => {
  const documents = new Map();
  let nextId = 0;
  let transactions = Promise.resolve();
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
    getDocFromServer: async (ref) => snapshot(ref.path, documents.get(ref.path)),
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
    getDocsFromServer: (target) => firestore.getDocs(target),
    limit: (count) => ({ type: "limit", count }),
    onSnapshot: () => () => {},
    orderBy: (field, direction) => ({ type: "orderBy", field, direction }),
    query: (ref, ...constraints) => ({ reference: ref, constraints }),
    serverTimestamp: () => ({ seconds: 1 }),
    setDoc: async (ref, value, options) => setDocument(ref, value, options),
    where: (field, operator, value) => ({ type: "where", field, operator, value }),
    writeBatch: () => {
      const mutations = [];
      const paths = [];
      return {
        set: (ref, value, options) => {
          paths.push(ref.path);
          mutations.push(() => setDocument(ref, value, options));
        },
        delete: (ref) => {
          paths.push(ref.path);
          mutations.push(() => documents.delete(ref.path));
        },
        commit: async () => {
          await beforeBatch(paths);
          mutations.forEach((mutation) => mutation());
        },
      };
    },
    runTransaction: async (_db, update) => {
      await beforeTransaction();
      const transaction = transactions.then(async () => {
        const batch = firestore.writeBatch();
        const value = await update({ ...batch, get: firestore.getDoc });
        await batch.commit();
        return value;
      });
      transactions = transaction.catch(() => {});
      return transaction;
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
  assert.equal(restored.activeEmployees[0].productionNumber, undefined);
  assert.equal(restored.archivedEmployees[0].productionNumber, undefined);
  assert.equal(restored.sickLeaves[0].certificate, "LEGACY-REAL-CERT");
  assert.equal(restored.sickLeaves[1].certificate, legacySynthetic.certificate);
});

test("Hermes production numbers follow the matched PESEL through active and archive imports", async () => {
  const { service } = await firestoreHarness();
  const fixtures = [
    ["pracownicy.xls", "01010100001", "L0002451"],
    ["archiwum.xls", "02020200002", "L0000007"],
  ];
  for (const [filename, pesel, productionNumber] of fixtures) {
    const [employee] = await data.parseEmployeeFile(workbookFile(filename, {
      Employees: [
        ["LP", "Obecność", "Nr produkcyjny pracownika ", "Nazwisko", "Imię", "PESEL"],
        [1, "Hermes Fulfilment (USZO)", productionNumber, "Testowa", "Anna", pesel],
      ],
    }));
    await service.replaceProjectEmployees({
      projectName: employee.project,
      archived: employee.archived,
      records: [employee],
    });
  }
  const { activeEmployees, archivedEmployees } = await service.loadCloudData();
  const rows = data.searchSickLeaves({
    employees: [...activeEmployees, ...archivedEmployees],
    sickLeaves: fixtures.map(([, id]) => ({
      id, certificate: `TEST-${id}`, start: "2026-10-12", end: "2026-10-13", companies: ["US"],
    })),
  });
  assert.equal(rows.length, 2);
  for (const [filename, pesel, productionNumber] of fixtures) {
    const { employee } = rows.find((row) => row.id === pesel);
    assert.equal(employee.productionNumber, productionNumber);
    assert.equal(employee.archived, filename.includes("archiwum"));
  }
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

test("users add, hide and remove projects independently from the shared registers", async () => {
  const { service, documents } = await firestoreHarness();
  documents.set("appState/current", { sickLeavesVersion: "shared" });
  const record = { id: "123", firstName: "Test", lastName: "Employee", project: "Cerland", aliases: ["123"] };
  const { projectId } = await service.replaceProjectEmployees({
    projectName: record.project, records: [record], archived: false, user: { uid: "fixture-a" },
  });
  const scope = (cloud, uid) => scopeWorkspace(cloud.projects, cloud.activeEmployees, [],
    documents.get("userSettings/" + uid)?.workspaceProjects);
  const original = await service.loadCloudData();
  assert.equal(scope(original, "fixture-a").employees.length, 1);
  assert.equal(scope(original, "fixture-b").employees.length, 0);
  await service.setWorkspaceProject("fixture-b", projectId, true);
  await service.saveProjectVisibility("fixture-a", projectId, true);
  assert.equal(documents.get("userSettings/fixture-a").hiddenProjects[projectId], true);
  assert.equal(documents.get("userSettings/fixture-b").hiddenProjects[projectId], undefined);
  assert.equal(scope(original, "fixture-a").employees.length, 1);
  assert.equal(scope(original, "fixture-b").employees.length, 1);
  await service.setWorkspaceProject("fixture-a", projectId, false);
  const reloaded = await service.loadCloudData();
  assert.equal(scope(reloaded, "fixture-a").employees.length, 0);
  assert.equal(scope(reloaded, "fixture-b").employees.length, 1);
  assert.equal(reloaded.activeEmployees.length, 1);
  assert.deepEqual(documents.get("appState/current"), { sickLeavesVersion: "shared" });
});

test("concurrent ZUS publishers compare news against the actual predecessor and retain the latest complete upload", async () => {
  const { service, documents } = await firestoreHarness();
  const employee = { id: "1", project: "Cerland", fullName: "Test Employee", aliases: ["1"] };
  const original = { id: "1", certificate: "FIXTURE", start: "2026-10-01", end: "2026-10-02" };
  await service.replaceSickLeaves({ records: [original], employees: [employee], user: { uid: "a" } });
  const changed = { ...original, end: "2026-10-03" };
  const uploads = await Promise.all(["a", "b"].map((uid) =>
    service.replaceSickLeaves({ records: [changed], employees: [employee], user: { uid } })));
  const cloud = await service.loadCloudData();
  assert.equal(cloud.sickLeaves.length, 1);
  assert.equal(cloud.sickLeaves[0].end, changed.end);
  assert.equal(cloud.newsEvents.length, 1);
  assert.equal(cloud.newsEvents[0].type, "changed");
  assert.ok(uploads.some(({ version }) => cloud.state.sickLeavesVersion === version));
  assert.equal(cloud.state.lastSickLeavesImportAt.seconds, 1);
  const dataset = documents.get("sickLeaves/" + cloud.state.sickLeavesVersion);
  assert.equal(cloud.state.lastSickLeavesImportByUid, dataset.importedByUid);
});

test("failed staging keeps the shared ZUS and employee versions readable", async () => {
  let failurePrefix;
  const { service } = await firestoreHarness({
    beforeBatch: async (paths) => {
      if (failurePrefix && paths.some((path) => path.startsWith(failurePrefix))) {
        throw new Error("Fixture interruption");
      }
    },
  });
  const employee = { id: "1", project: "Cerland", aliases: ["1"] };
  const leave = { id: "1", certificate: "FIXTURE", start: "2026-10-01", end: "2026-10-02" };
  await service.replaceProjectEmployees({ projectName: "Cerland", archived: false, records: [employee] });
  const { version } = await service.replaceSickLeaves({ records: [leave] });
  failurePrefix = "sickLeaves/";
  await assert.rejects(service.replaceSickLeaves({ records: [{ ...leave, end: "2026-10-05" }] }), /Fixture interruption/);
  failurePrefix = "employees/";
  await assert.rejects(service.replaceProjectEmployees({
    projectName: "Cerland", archived: false, records: [{ ...employee, id: "2" }],
  }), /Fixture interruption/);
  const reloaded = await service.loadCloudData();
  assert.equal(reloaded.state.sickLeavesVersion, version);
  assert.equal(reloaded.sickLeaves[0].end, leave.end);
  assert.equal(reloaded.activeEmployees[0].id, "1");
});

test("retiring one project register never deletes another coordinator's staged version", async () => {
  let pauseNextPublish = false;
  let staged;
  let resume;
  const ready = new Promise((resolve) => { staged = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  const { service } = await firestoreHarness({
    beforeTransaction: async () => {
      if (!pauseNextPublish) return;
      pauseNextPublish = false;
      staged();
      await gate;
    },
  });
  const upload = (projectName, id, uid, archived = false) =>
    service.replaceProjectEmployees({ projectName, archived, records: [{ id, aliases: [id] }], user: { uid } });
  await upload("Cerland", "old", "a");
  await upload("Cerland", "archive", "a", true);
  await upload("Hermes Fulfilment", "hermes", "a");
  pauseNextPublish = true;
  const pending = upload("Cerland", "second", "b");
  await ready;
  try {
    await upload("Cerland", "first", "a");
    const first = await service.loadCloudData();
    assert.deepEqual(Array.from(first.activeEmployees, (employee) => employee.id).sort(), ["first", "hermes"]);
  } finally {
    resume();
  }
  await pending;
  const second = await service.loadCloudData();
  assert.deepEqual(Array.from(second.activeEmployees, (employee) => employee.id).sort(), ["hermes", "second"]);
  assert.deepEqual(Array.from(second.archivedEmployees, (employee) => employee.id), ["archive"]);
});

test("HERMES and HERMES PL publish separate registers, archives, workspace entries and news for the same PESEL", async () => {
  const { service, documents } = await firestoreHarness();
  const normal = "Hermes Fulfilment Sp. z o.o. UZwPT (USZO)";
  const polish = "Hermes Fulfilment Sp. z o.o. PL UZwPT (USZO)";
  const user = { uid: "fixture-user" };
  const pesel = "01010100001";
  const upload = async (project, productionNumber, archived = false) => {
    const filename = archived ? "archiwum.xlsx" : "same-filename.xlsx";
    const records = await data.parseEmployeeFile(workbookFile(filename, {
      Register: [
        ["LP", "Obecność", "Nr produkcyjny pracownika", "Nazwisko", "Imię", "PESEL"],
        [1, project, productionNumber, "Testowa", "Anna", archived ? "02020200002" : pesel],
      ],
    }));
    return service.replaceProjectEmployees({ projectName: records[0].project, records, archived, user });
  };
  const a = await upload(normal, "L0000001");
  const b = await upload(polish, "L0000002");
  await upload(normal, "L0000003", true);
  await upload(polish, "L0000004", true);
  const initial = await service.loadCloudData();
  assert.notEqual(a.projectId, b.projectId);
  assert.deepEqual(Array.from(initial.projects, (project) => projectIdentity.getHermesProject(project.projectName).label).sort(), ["HERMES", "HERMES PL"]);
  const snapshot = (cloud, id) => cloud.projects.find((project) => project.projectId === id);
  const originalPL = snapshot(initial, b.projectId);
  await upload(normal, "L0000005");
  const afterNormal = await service.loadCloudData();
  assert.deepEqual(snapshot(afterNormal, b.projectId), originalPL);
  const currentNormal = snapshot(afterNormal, a.projectId);
  await upload(polish, "L0000006");
  const cloud = await service.loadCloudData();
  assert.deepEqual(snapshot(cloud, a.projectId), currentNormal);
  for (const project of cloud.projects) {
    assert.equal(project.activeEmployeeCount, 1);
    assert.equal(project.archivedEmployeeCount, 1);
  }
  assert.deepEqual(Array.from(cloud.archivedEmployees, (employee) => employee.productionNumber).sort(), ["L0000003", "L0000004"]);
  await service.saveProjectVisibility(user.uid, b.projectId, true);
  const settings = documents.get("userSettings/" + user.uid);
  assert.equal(settings.hiddenProjects[a.projectId], undefined);
  const workspace = scopeWorkspace(cloud.projects, cloud.activeEmployees, [], settings.workspaceProjects);
  assert.equal(workspace.projects.length, 2);
  const employees = data.mergeEmployees(workspace.employees);
  const leave = { id: pesel, certificate: "TEST", start: "2026-09-29", end: "2026-10-02", companies: ["US"] };
  const rows = data.searchSickLeaves({ employees, sickLeaves: [leave] });
  assert.deepEqual(Array.from(rows, ({ employee }) => employee.productionNumber).sort(), ["L0000005", "L0000006"]);
  await service.replaceSickLeaves({ records: [leave], user, employees });
  await service.replaceSickLeaves({ records: [{ ...leave, end: "2026-10-03" }], user, employees });
  const updated = await service.loadCloudData();
  assert.equal(updated.sickLeaves.length, 1);
  assert.deepEqual(Array.from(updated.newsEvents, (event) => event.projectId).sort(), [a.projectId, b.projectId].sort());
});

test("Saint-Gobain imports replace only their own version, with separate workspace visibility", async () => {
  const { service, documents } = await firestoreHarness();
  const regular = "Saint-Gobain Sekurit Polska Sp. z o.o. oddział Konin Żagański PT (HSZO)";
  const polish = regular.replace("PT (HSZO)", "PT PL (HSZO)");
  const upload = async (project, uid, pesel, archived = false) => {
    const records = await data.parseEmployeeFile(workbookFile(archived ? "archiwum.xls" : "identical-name.xls", {
      Register: [["Obecność", "Nazwisko", "Imię", "PESEL"], [project, "Testowa", "Anna", pesel]],
    }));
    assert.deepEqual(records[0].companies, ["HS"]);
    return service.replaceProjectEmployees({ projectName: records[0].project, records, archived, user: { uid } });
  };
  const a = await upload(regular, "a", "01010100001");
  const b = await upload(polish, "b", "01010100001");
  assert.equal(a.projectId, "saint-gobain-sekurit-polska-sp-z-o-o-oddzia-konin-zaganski-pt-hszo-1774ymb");
  assert.notEqual(a.projectId, b.projectId);
  await upload(regular, "a", "02020200002", true);
  await upload(polish, "b", "03030300003", true);
  const before = await service.loadCloudData();
  const project = (cloud, id) => cloud.projects.find((item) => item.projectId === id);
  assert.equal((await upload(polish, "b", "04040400004")).projectId, b.projectId);
  const afterPL = await service.loadCloudData();
  assert.deepEqual(project(afterPL, a.projectId), project(before, a.projectId));
  assert.equal((await upload(regular, "a", "05050500005")).projectId, a.projectId);
  const after = await service.loadCloudData();
  assert.deepEqual(project(after, b.projectId), project(afterPL, b.projectId));
  assert.equal(after.activeEmployees.length, 2);
  assert.equal(after.archivedEmployees.length, 2);
  await service.setWorkspaceProject("a", b.projectId, true);
  await service.saveProjectVisibility("a", b.projectId, true);
  const preferences = documents.get("userSettings/a");
  assert.deepEqual(preferences.hiddenProjects, { [b.projectId]: true });
  assert.equal(scopeWorkspace(after.projects, after.activeEmployees, [], preferences.workspaceProjects).projects.length, 2);
  assert.equal(Object.keys(documents.get("userSettings/b").workspaceProjects).length, 1);
});
