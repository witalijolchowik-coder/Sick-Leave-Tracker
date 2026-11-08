import assert from "node:assert/strict";
import test from "node:test";
import { mergeEmployees } from "../src/lib/data.js";
import { isPlProject, projectVariant, RESRG_NAME } from "../src/lib/projectIdentity.js";

test("standalone PL suffixes separate variant families without changing employer or workplace identity", () => {
  for (const [normal, pl] of [
    ["Toyota Boshoku Poland PT (PSTZ)", "Toyota Boshoku Poland PT PL (PSTZ)"],
    ["Hermes Fulfilment Sp. z o.o. UZwPT", "Hermes Fulfilment Sp. z o.o. PL UZwPT"],
    ["Future Project PT (PSZO)", "Future Project PT PL (PSZO)"],
    ["Future Project (PSZO)", "Future Project PL (PSZO)"],
  ]) {
    assert.equal(projectVariant(normal).family, projectVariant(pl).family);
    assert.equal(isPlProject({ project: normal }), false);
    assert.equal(isPlProject({ project: pl }), true);
    const employee = { id: "TEST", aliases: ["TEST"] };
    assert.deepEqual(mergeEmployees([normal, pl, normal, pl].map((project) => ({ ...employee, project })))
      .map(({ project }) => project), [normal, pl]);
  }
  for (const project of [RESRG_NAME, "APL Polska PT (HSZO)", "ACME PL Sp. z o.o. PT (HSZO)", "ACME PT (PL)"]) {
    assert.equal(isPlProject({ project }), false);
  }
  assert.notEqual(projectVariant("Future Project PT PL (HSZO)").family, projectVariant("Future Project PT (PSZO)").family);
  assert.notEqual(projectVariant("Future Project North PT PL (HSZO)").family, projectVariant("Future Project South PT (HSZO)").family);
});
