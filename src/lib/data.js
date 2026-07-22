import * as XLSX from "xlsx";

const HEADER_SCAN_LIMIT = 15;

export const cleanText = (value) =>
  String(value ?? "")
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/[\r\n\t\u00a0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeHeader = (value) =>
  cleanText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export const normalizeId = (value) => {
  const source = cleanText(value);
  if (!source) return "";
  const digits = source.replace(/\D/g, "");
  if (/^[\d\s.,+-]+$/.test(source) && digits.length >= 5) {
    return digits.length < 11 ? digits.padStart(11, "0") : digits;
  }
  return source.toUpperCase().replace(/[\s-]+/g, "");
};

export const normalizeProject = (value) => cleanText(value) || "Bez projektu";

export const normalizeProjectName = (value) => {
  const source = normalizeProject(value);
  return /hermes fulfilment/i.test(source)
    ? "Hermes Fulfilment Sp. z o.o. UZwPT"
    : source;
};

export const normalizeCompanyCode = (value) =>
  normalizeHeader(value).replace(/[^a-z0-9]+/g, "").toUpperCase();

const normalizeBusinessCode = (value) => normalizeCompanyCode(value).replace(/Z[OPT]?$/i, "");

export const projectCompanyCodes = (projectName, rawProjectName = projectName) => {
  const source = cleanText(rawProjectName || projectName);
  const normalized = normalizeHeader(source);
  if (normalized.includes("hermes fulfilment")) return ["US"];

  const codes = [...source.matchAll(/\(([^)]+)\)/g)]
    .map((match) => normalizeBusinessCode(match[1]))
    .filter(Boolean);
  return [...new Set(codes)];
};

export const employeeArchiveKey = (employee) =>
  `${employee.projectId || normalizeHeader(employee.project)}::${employee.pesel || employee.id}`;

const leaveCompanyCodes = (leave) =>
  (leave.companies || []).map(normalizeBusinessCode).filter(Boolean);

export const employeeMatchesLeaveCompany = (employee, leave) => {
  const expectedCompanies = employee.companies?.length
    ? employee.companies
    : projectCompanyCodes(employee.project);
  if (!expectedCompanies.length) return true;
  const actualCompanies = leaveCompanyCodes(leave);
  if (!actualCompanies.length) return true;
  return actualCompanies.some((actual) =>
    expectedCompanies.some((expected) => actual === normalizeBusinessCode(expected)),
  );
};

export const parseDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(utc);
    return Number.isNaN(date.getTime())
      ? null
      : new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  const source = cleanText(value);
  if (!source || source === "-") return null;
  const match = source.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/);
  if (match) {
    const [, first, second, third] = match;
    const yearFirst = first.length === 4;
    const year = Number(yearFirst ? first : third);
    const month = Number(second);
    const day = Number(yearFirst ? third : first);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date;
    }
  }
  return null;
};

export const toIsoDate = (value) => {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const formatDisplayDate = (value) => {
  const date = parseDate(value);
  if (!date) return cleanText(value);
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

const parseDateRange = (value) => {
  const source = cleanText(value);
  const match = source.match(
    /(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})\s*[-–—]\s*(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})/,
  );
  if (!match) return null;
  const start = toIsoDate(match[1]);
  const end = toIsoDate(match[2]);
  return start && end ? { start, end } : null;
};

const findHeaderRow = (rows, predicate) => {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  for (let index = 0; index < limit; index += 1) {
    const headers = (rows[index] || []).map(normalizeHeader);
    if (predicate(headers)) return index;
  }
  return 0;
};

const findIndex = (headers, tests, fallback = -1) => {
  for (const test of tests) {
    const index = headers.findIndex((header) =>
      typeof test === "string" ? header === test : test(header),
    );
    if (index >= 0) return index;
  }
  return fallback;
};

const rowsFromSheet = (sheet) =>
  XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    dateNF: "dd.mm.yyyy",
  });

export const readWorkbook = async (file) => {
  const data = await file.arrayBuffer();
  return XLSX.read(data, {
    type: "array",
    cellDates: true,
    cellText: true,
  });
};

export const parseEmployeeFile = async (file) => {
  const workbook = await readWorkbook(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = rowsFromSheet(sheet);
  const headerRowIndex = findHeaderRow(
    rows,
    (headers) =>
      headers.some((header) => header.includes("nazwisko")) &&
      headers.some((header) => header === "pesel" || header.includes("paszportu")),
  );
  const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
  const indexes = {
    project: findIndex(headers, [
      "obecnosc",
      (header) => header.includes("obecnosc"),
      (header) => header === "projekt",
      (header) => header === "nr projektu",
    ]),
    surname: findIndex(headers, [
      (header) => header === "nazwisko" || header.endsWith(" nazwisko"),
      (header) => header.includes("nazwisko"),
    ]),
    firstName: findIndex(headers, [
      (header) => header === "imie" || header.endsWith(" imie"),
      (header) => header.includes("imie") && !header.includes("ojca") && !header.includes("matki"),
    ]),
    pesel: findIndex(headers, ["pesel", (header) => header.includes("pesel")]),
    passport: findIndex(headers, [
      (header) => header.includes("seria i numer paszportu"),
      (header) => header.includes("numer paszportu"),
    ]),
  };

  if (indexes.project < 0 || indexes.surname < 0 || indexes.firstName < 0) {
    throw new Error(`Nie rozpoznano kolumn pracowników w pliku „${file.name}”.`);
  }

  const archived = normalizeHeader(file.name).includes("archiwum");
  return rows.slice(headerRowIndex + 1).flatMap((row, rowIndex) => {
    const pesel = indexes.pesel >= 0 ? normalizeId(row[indexes.pesel]) : "";
    const passport = indexes.passport >= 0 ? normalizeId(row[indexes.passport]) : "";
    const primaryId = pesel || passport;
    if (!primaryId) return [];
    const lastName = cleanText(row[indexes.surname]);
    const firstName = cleanText(row[indexes.firstName]);
    return [{
      id: primaryId,
      aliases: [...new Set([pesel, passport].filter(Boolean))],
      pesel,
      passport,
      project: normalizeProjectName(row[indexes.project]),
      rawProject: normalizeProject(row[indexes.project]),
      companies: projectCompanyCodes(row[indexes.project]),
      fullName: `${lastName} ${firstName}`.trim() || primaryId,
      lastName,
      firstName,
      archived,
      sourceFile: file.name,
      sourceRow: headerRowIndex + rowIndex + 2,
    }];
  });
};

export const mergeEmployees = (records) => {
  const sorted = [...records].sort(
    (left, right) => Number(left.archived) - Number(right.archived),
  );
  const seenActive = new Set();
  const seenArchive = new Set();
  return sorted.filter((employee) => {
    const keys = employee.aliases?.length ? employee.aliases : [employee.id];
    if (!employee.archived) {
      if (keys.some((key) => seenActive.has(key))) return false;
      keys.forEach((key) => seenActive.add(key));
      return true;
    }
    const projectKey = employee.projectId || normalizeHeader(employee.project);
    if (keys.some((key) => seenArchive.has(`${projectKey}::${key}`))) return false;
    keys.forEach((key) => seenArchive.add(`${projectKey}::${key}`));
    return true;
  });
};

export const parseSickLeaveFile = async (file) => {
  const workbook = await readWorkbook(file);
  const entries = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = rowsFromSheet(sheet);
    const headerRowIndex = findHeaderRow(
      rows,
      (headers) =>
        headers.some((header) => header.includes("pesel") || header.includes("tozsamosci")) &&
        headers.some((header) => header.includes("niezdolnosc do pracy")),
    );
    const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
    const indexes = {
      certificate: findIndex(headers, [(header) => header.includes("seria i nr")]),
      person: findIndex(headers, [(header) => header.includes("kogo dotyczy")]),
      id: findIndex(headers, [
        (header) => header.includes("pesel") || header.includes("tozsamosci"),
      ]),
      range: findIndex(headers, [(header) => header.includes("niezdolnosc do pracy")]),
      care: findIndex(headers, [(header) => header.includes("na opieke")]),
      hospital: findIndex(headers, [(header) => header.includes("pobyt w szpitalu")]),
      status: findIndex(headers, ["status"]),
    };
    if (indexes.id < 0 || indexes.range < 0) continue;

    rows.slice(headerRowIndex + 1).forEach((row, rowIndex) => {
      const id = normalizeId(row[indexes.id]);
      const range = parseDateRange(row[indexes.range]);
      if (!id || !range) return;
      const hospitalValue = indexes.hospital >= 0 ? cleanText(row[indexes.hospital]) : "";
      entries.push({
        id,
        certificate:
          (indexes.certificate >= 0 && cleanText(row[indexes.certificate])) ||
          `${id}-${range.start}-${range.end}`,
        sourceName: indexes.person >= 0 ? cleanText(row[indexes.person]) : "",
        start: range.start,
        end: range.end,
        care: indexes.care >= 0 && /^tak$/i.test(cleanText(row[indexes.care])),
        hospital: !/^(nie|-|)$/i.test(hospitalValue),
        hospitalPeriod: hospitalValue,
        status: indexes.status >= 0 ? cleanText(row[indexes.status]) : "",
        companies: [cleanText(sheetName)],
        sourceFile: file.name,
        sourceRow: headerRowIndex + rowIndex + 2,
      });
    });
  }
  return entries;
};

export const mergeSickLeaves = (records) => {
  const byKey = new Map();
  records.forEach((entry) => {
    const key = `${entry.certificate}|${entry.id}|${entry.start}|${entry.end}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...entry, companies: [...entry.companies] });
      return;
    }
    existing.companies = [...new Set([...existing.companies, ...entry.companies])];
  });
  return [...byKey.values()];
};

export const searchSickLeaves = ({
  employees,
  sickLeaves,
  project = "all",
  dateStart = "",
  dateEnd = "",
  hiddenArchiveKeys = new Set(),
}) => {
  const activeById = new Map();
  const archiveById = new Map();
  employees.forEach((employee) => {
    const aliases = employee.aliases?.length ? employee.aliases : [employee.id];
    aliases.forEach((alias) => {
      const lookup = employee.archived ? archiveById : activeById;
      if (!lookup.has(alias)) lookup.set(alias, []);
      lookup.get(alias).push(employee);
    });
  });
  const results = [];
  sickLeaves.forEach((leave) => {
    if (dateStart && leave.end < dateStart) return;
    if (dateEnd && leave.start > dateEnd) return;
    if (normalizeHeader(leave.status).includes("anul")) return;
    const activeCandidates = activeById.get(leave.id) || [];
    const archiveCandidates = archiveById.get(leave.id) || [];
    const activeProjectKeys = new Set(
      activeCandidates.map((employee) => employee.projectId || normalizeHeader(employee.project)),
    );
    [...activeCandidates, ...archiveCandidates].forEach((employee) => {
      if (project !== "all" && employee.project !== project) return;
      if (!employeeMatchesLeaveCompany(employee, leave)) return;
      const archiveKey = employeeArchiveKey(employee);
      if (employee.archived && hiddenArchiveKeys.has(archiveKey)) return;
      const employeeProjectKey = employee.projectId || normalizeHeader(employee.project);
      if (employee.archived && activeProjectKeys.has(employeeProjectKey)) return;
      results.push({
        ...leave,
        employee,
        archiveKey,
        resultId: `${employee.archived ? "archive" : "active"}|${leave.certificate}|${leave.id}|${leave.start}|${employee.project}`,
      });
    });
  });
  return results.sort(
    (left, right) =>
      right.start.localeCompare(left.start) ||
      left.employee.fullName.localeCompare(right.employee.fullName, "pl"),
  );
};

export const countWorkingDays = (startValue, endValue) => {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end || start > end) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};

const safeFilePart = (value) =>
  cleanText(value || "WSZYSTKIE")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .slice(0, 80);

export const exportAbsenceReport = (rows, hoursPerDay, project = "all") => {
  const headers = [
    "Nazwisko",
    "Imię",
    "Pesel",
    "Rodzaj absencji",
    "Skrót",
    "OD",
    "DO",
    "Dni robocze",
    "Godziny",
    "Uwagi",
  ];
  const data = rows.map((row) => {
    const workingDays = countWorkingDays(row.start, row.end);
    const notes = [];
    if (row.care) notes.push("opieka");
    if (row.hospital) notes.push("szpital");
    return [
      row.employee.lastName.toUpperCase(),
      row.employee.firstName.toUpperCase(),
      row.employee.pesel || row.id,
      "Godziny chorobowe (L4)",
      "L4",
      formatDisplayDate(row.start),
      formatDisplayDate(row.end),
      workingDays,
      workingDays * hoursPerDay,
      notes.join(", "),
    ];
  });
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
  worksheet["!cols"] = [
    { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 27 }, { wch: 8 },
    { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 10 }, { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Absencje");
  const projectName = project === "all" ? "WSZYSTKIE" : safeFilePart(project);
  XLSX.writeFile(workbook, `Raport_Absencja_${projectName}.xlsx`);
};

export const exportToyotaReport = (rows) => {
  const headers = [
    "l.p.",
    "nazwisko i imię pracownika",
    "rodzaj nieobecności",
    "data od",
    "data do",
  ];
  const data = rows.map((row, index) => [
    index + 1,
    `${row.employee.lastName.toUpperCase()} ${row.employee.firstName.toUpperCase()}`,
    row.care || row.hospital ? "L4 + opieka/szpital" : "L4",
    formatDisplayDate(row.start),
    formatDisplayDate(row.end),
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
  worksheet["!cols"] = [
    { wch: 7 }, { wch: 34 }, { wch: 25 }, { wch: 13 }, { wch: 13 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "RAPORT TBPL");
  const today = new Intl.DateTimeFormat("pl-PL")
    .format(new Date())
    .replace(/\./g, "-");
  XLSX.writeFile(workbook, `Raport L4_PS_${today}.xlsx`);
};
