// Production IDs are kept stable. The source names are retained for employer matching.
export const RESRG_ID = "resrg-automotive-pl-sp-z-o-o-oddzia-boles-awiec-uzwpt-uszo-ob9g4b";
export const LEGACY_SRG_ID = "srg-global-boles-awiec-sp-z-o-o-uzwpt-uszo-60nn1k";
export const RESRG_NAME = "RESRG Automotive PL Sp. z o.o. oddział Bolesławiec UZwPT (USZO)";
const TOYOTA_PL_ID = "toyota-boshoku-poland-pt-pl-pstz-sa7uec";
const TOYOTA_PL_NAME = "Toyota Boshoku Poland PT PL (PSTZ)";

const normalizedName = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();

const HERMES = {
  id: "hermes-fulfilment-sp-z-o-o-uzwpt-7w2qf6",
  name: "Hermes Fulfilment Sp. z o.o. UZwPT",
  label: "HERMES",
};
const HERMES_PL = {
  id: "hermes-fulfilment-sp-z-o-o-pl-uzwpt-1bjm9qi",
  name: "Hermes Fulfilment Sp. z o.o. PL UZwPT",
  label: "HERMES PL",
};
const hermesNames = new Map([
  [HERMES.name, HERMES],
  [HERMES.name + " (USZO)", HERMES],
  ["Hermes Fulfilment", HERMES],
  ["Hermes Fulfilment (USZO)", HERMES],
  [HERMES_PL.name, HERMES_PL],
  [HERMES_PL.name + " (USZO)", HERMES_PL],
].map(([name, project]) => [normalizedName(name), project]));

export const getHermesProject = (name) => hermesNames.get(normalizedName(name));

export const isLegacySrg = (name) => /^srg global\b/i.test(normalizedName(name));
export const isResrg = (name) => /^(?:resrg$|resrg automotive\b)/i.test(normalizedName(name));
export const isResrgWorkplace = (name) => isResrg(name) || isLegacySrg(name);
export const isPlProject = ({ project, projectId }) =>
  projectId === TOYOTA_PL_ID || normalizedName(project) === normalizedName(TOYOTA_PL_NAME) ||
  projectId === HERMES_PL.id || getHermesProject(project) === HERMES_PL;
