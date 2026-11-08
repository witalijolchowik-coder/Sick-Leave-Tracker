import { RESRG_ID } from "./projectIdentity.js";

export const MAX_PROJECT_DISPLAY_NAME_LENGTH = 40;

// Existing aliases are tied to deployed IDs. Future projects use their full
// names until a coordinator adds a label.
export const EXISTING_PROJECT_DISPLAY_NAMES = Object.freeze({
  "cerland-industry-sp-z-o-o-oddzia-boles-awiec-uz-pszo-1x1eb32": "CERLAND",
  "hermes-fulfilment-sp-z-o-o-uzwpt-7w2qf6": "HERMES",
  "hermes-fulfilment-sp-z-o-o-pl-uzwpt-1bjm9qi": "HERMES PL",
  "id-logistics-polska-s-a-zgorzelec-uzwpt-pstz-1kwppcb": "ID LOGISTICS",
  [RESRG_ID]: "RESRG",
  "toyota-boshoku-poland-pt-pstz-hrczl8": "TOYOTA",
  "toyota-boshoku-poland-pt-pl-pstz-sa7uec": "TOYOTA PL",
  "saint-gobain-sekurit-polska-sp-z-o-o-oddzia-konin-zaganski-pt-hszo-1774ymb": "SAINT-GOBAIN",
  "saint-gobain-sekurit-polska-sp-z-o-o-oddzia-konin-zaganski-pt-pl-hszo-xqykqz": "SAINT-GOBAIN PL",
});

export function projectDisplayName({ id, projectName, originalName }, displayNames = {}) {
  return displayNames[id] || EXISTING_PROJECT_DISPLAY_NAMES[id] || originalName || projectName;
}

export function projectPresentation(projects, employees, displayNames) {
  const sources = new Map();
  for (const employee of employees) {
    if (!employee.projectId || !employee.rawProject || employee.historicalOnly) continue;
    const source = sources.get(employee.projectId);
    if (!source || (source.archived && !employee.archived)) {
      sources.set(employee.projectId, employee);
    }
  }
  return projects.map((project) => {
    const id = project.projectId || project.id;
    const originalName = sources.get(id)?.rawProject || project.projectName;
    const presentation = { id, projectName: project.projectName, originalName };
    return { ...presentation, displayName: projectDisplayName(presentation, displayNames) };
  });
}

const labelKey = (value) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pl");

export function validateProjectDisplayName(value) {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label) throw new Error("Wpisz krótką nazwę projektu.");
  if (label.length > MAX_PROJECT_DISPLAY_NAME_LENGTH) {
    throw new Error(`Krótka nazwa może mieć maksymalnie ${MAX_PROJECT_DISPLAY_NAME_LENGTH} znaków.`);
  }
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("Krótka nazwa zawiera niedozwolone znaki.");
  return label;
}

export function assertUniqueProjectDisplayName(id, label, projects, displayNames) {
  const key = labelKey(label);
  const duplicate = projects.some((project) => project.id !== id &&
    labelKey(projectDisplayName(project, displayNames)) === key);
  if (duplicate || /^wszystkie projekty(?: \(\d+\))?$/.test(key)) {
    throw new Error("Ta nazwa jest już używana. Wybierz inną krótką nazwę.");
  }
}
