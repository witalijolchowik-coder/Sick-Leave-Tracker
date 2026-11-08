import CFB from "cfb";
import { countWorkingDays, parseDate, safeFilePart } from "./data.js";
import { isPlProject } from "./projectIdentity.js";

const sheetPath = "xl/worksheets/sheet1.xml";
const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const xmlText = (value) => String(value)
  .replace(/_x[\da-f]{4}_/gi, (escape) => `_x005F_${escape.slice(1)}`)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const excelDate = (value) => {
  const date = parseDate(value);
  return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
};

const absenceRows = (rows, hours, project, { start: from, end: until }) => rows.flatMap((row) => {
  if (project !== "all" && row.employee.project !== project) return [];
  const start = from && row.start < from ? from : row.start;
  const end = until && row.end > until ? until : row.end;
  if (!start || !end || start > end) return [];
  const { employee } = row;
  const days = countWorkingDays(start, end);
  const notes = [row.care && "opieka", row.hospital && "szpital"].filter(Boolean);
  return [[
    employee.lastName.toUpperCase(), employee.firstName.toUpperCase(),
    isPlProject(employee) ? "" : String(employee.passport || ""), String(employee.pesel || ""),
    "Godziny chorobowe (L4)", "L4", excelDate(start), excelDate(end), days, days * hours, notes.join(", "),
  ]];
});

// Edit only the data rows and filter bounds. Round-tripping the whole template
// through the general workbook writer would drop its native Excel formatting.
export function buildAbsenceReport(template, rows, hours, project = "all", range = {}) {
  const data = absenceRows(rows, hours, project, range);
  if (!data.length) return null;
  const workbook = CFB.read(new Uint8Array(template), { type: "array" });
  const sheet = CFB.find(workbook, `/${sheetPath}`);
  const xml = new TextDecoder().decode(sheet.content);
  const prototype = xml.match(/<row r="2"[^>]*>.*?<\/row>/s)[0];
  const body = data.map((values, index) => {
    const rowNumber = index + 2;
    return prototype.replace('r="2"', `r="${rowNumber}"`).replace(
      /<c r="([A-K])2" s="(\d+)"\s*\/>/g,
      (_cell, column, style) => {
        const value = values[column.charCodeAt(0) - 65];
        const cell = `<c r="${column}${rowNumber}" s="${style}"`;
        if (value === "") return `${cell}/>`;
        if (typeof value === "number") return `${cell}><v>${value}</v></c>`;
        return `${cell} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
      },
    );
  }).join("");
  const updated = xml.replace(prototype, () => body).replaceAll('ref="A1:K2"', `ref="A1:K${data.length + 1}"`);
  sheet.content = new TextEncoder().encode(updated);
  sheet.size = sheet.content.length;
  return CFB.write(workbook, { fileType: "zip", type: "array", compression: true });
}

export async function exportAbsenceReport(rows, hours, project, range) {
  const response = await fetch(new URL("../assets/absence-template.xlsx", import.meta.url));
  if (!response.ok) throw new Error("Nie udało się pobrać szablonu XLSX.");
  const bytes = buildAbsenceReport(await response.arrayBuffer(), rows, hours, project, range);
  if (!bytes) return false;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  link.download = `Raport_Absencja_${safeFilePart(project === "all" ? "WSZYSTKIE" : project)}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return true;
}
