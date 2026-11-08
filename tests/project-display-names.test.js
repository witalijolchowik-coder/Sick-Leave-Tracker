import assert from "node:assert/strict";
import test from "node:test";
import { searchSickLeaves } from "../src/lib/data.js";
import {
  assertUniqueProjectDisplayName, EXISTING_PROJECT_DISPLAY_NAMES, projectPresentation, validateProjectDisplayName,
} from "../src/lib/projectDisplayNames.js";
import { isPlProject } from "../src/lib/projectIdentity.js";
import { scopeWorkspace } from "../src/lib/workspace.js";

const regular = { projectId: "hermes-fulfilment-sp-z-o-o-uzwpt-7w2qf6", projectName: "Hermes Fulfilment Sp. z o.o. UZwPT" };
const polish = { projectId: "hermes-fulfilment-sp-z-o-o-pl-uzwpt-1bjm9qi", projectName: "Hermes Fulfilment Sp. z o.o. PL UZwPT" };
const originalName = polish.projectName + " (USZO)";
const employee = { id: "FIXTURE", aliases: ["FIXTURE"], projectId: polish.projectId, project: polish.projectName,
  rawProject: originalName, fullName: "Fixture Employee", companies: ["US"], productionNumber: "L0000420" };

test("existing project labels keep their IDs and new projects default to the full SOZ name", () => {
  const ids = Object.keys(EXISTING_PROJECT_DISPLAY_NAMES);
  const catalog = ids.map((projectId) => ({ projectId, projectName: projectId }));
  const fresh = { projectId: "new-project", projectName: "Full imported name" };
  const labels = projectPresentation([...catalog, fresh], [], {});
  assert.deepEqual(labels.slice(0, -1).map(({ displayName }) => displayName), [
    "CERLAND", "HERMES", "HERMES PL", "ID LOGISTICS", "RESRG",
    "TOYOTA", "TOYOTA PL", "SAINT-GOBAIN", "SAINT-GOBAIN PL",
  ]);
  assert.equal(labels.at(-1).displayName, fresh.projectName);
});

test("changing a label keeps the canonical filter value, raw source name, workspace and matching intact", () => {
  const projects = [regular, polish];
  const employees = [employee];
  const before = structuredClone({ projects, employees });
  const names = projectPresentation(projects, employees, { [polish.projectId]: "HP" });
  assert.equal(names[0].displayName, "HERMES");
  assert.deepEqual(names[1], { id: polish.projectId, projectName: polish.projectName, originalName, displayName: "HP" });
  const workspace = scopeWorkspace(projects, employees, [], { [polish.projectId]: true });
  const rows = searchSickLeaves({
    employees: workspace.employees, project: names[1].projectName,
    sickLeaves: [{ id: "FIXTURE", certificate: "TEST", start: "2026-10-01", end: "2026-10-03", companies: ["US"] }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employee.productionNumber, "L0000420");
  assert.equal(isPlProject(rows[0].employee), true);
  assert.equal(isPlProject({ project: regular.projectName }), false);
  assert.deepEqual({ projects, employees }, before);
});

test("short labels reject empty, long, reserved and visually equivalent duplicates", () => {
  const projects = projectPresentation([regular, polish, { id: "other", projectName: "New full name" }], [], {});
  assert.equal(validateProjectDisplayName("  Hermes   West  "), "Hermes West");
  assert.throws(() => validateProjectDisplayName("   "), /Wpisz/);
  assert.throws(() => validateProjectDisplayName("a".repeat(41)), /40 znaków/);
  assert.throws(() => validateProjectDisplayName("H\u200bP"), /niedozwolone/);
  for (const label of [" hermes ", "ＨＥＲＭＥＳ", "NEW FULL NAME", "Wszystkie projekty (2)"]) {
    assert.throws(() => assertUniqueProjectDisplayName(polish.projectId, label, projects, {}), /już używana/);
  }
  assert.throws(() => assertUniqueProjectDisplayName(polish.projectId, "HP", projects, {
    [regular.projectId]: "hp",
  }), /już używana/);
  assert.doesNotThrow(() => assertUniqueProjectDisplayName(polish.projectId, "HERMES PL", projects, {}));
});
