const MISSING = "Brak danych";
const CARD_WIDTH = 1200;
const MIN_CARD_HEIGHT = 675;
const RENDER_SCALE = 2;
const FONT_FAMILY = '"Segoe UI", Arial, sans-serif';
// Confirmed legal employers keyed by the original ZUS worksheet name.
const EMPLOYERS_BY_WORKSHEET = new Map([
  ["US", "Ukrainian Service Sp. z o.o."],
  ["PST", "Personnel Support Sp. z o.o."],
  ["PS", "Personnel Service Sp. z o.o."],
  ["HS", "Human Support Sp. z o.o."],
  ["HCS", "Human Capital Service Sp. z o.o."],
  ["RENESANS", "Renesans"],
]);
// Workplace suffix cleanup remains separate from legal employer resolution.
const PROJECT_SUFFIX = /(?:\s*\((?:(?:US|PS|PST)(?:Z[OPT]?)?|UZwPT)\)|\s+(?:(?:US|PS|PST)(?:Z[OPT]?)?|UZwPT))\s*$/iu;

const text = (value) => String(value ?? "")
  .normalize("NFC")
  .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\ufeff]/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

export const cleanPngWorkplace = (value) => {
  let workplace = text(value);
  let previous;
  do {
    previous = workplace;
    workplace = workplace.replace(PROJECT_SUFFIX, "").trim();
  } while (workplace !== previous);
  return !workplace || workplace === "Bez projektu" ? MISSING : workplace;
};

const employerName = (row) => {
  // Leave companies are persisted ZUS worksheet names. Employee companies and
  // project suffixes have different provenance and must not select an employer.
  const worksheets = [...new Set((row?.companies || []).map((value) => text(value).toUpperCase()))];
  // Deduplication can merge a certificate from several worksheets. Do not guess
  // a single employer when its source worksheet is missing or ambiguous.
  return worksheets.length === 1 ? EMPLOYERS_BY_WORKSHEET.get(worksheets[0]) || MISSING : MISSING;
};

export const formatPngDate = (value) => {
  let year;
  let month;
  let day;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  } else {
    const match = text(value).match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/u);
    if (!match) return MISSING;
    const yearFirst = match[1].length === 4;
    year = Number(yearFirst ? match[1] : match[3]);
    month = Number(match[2]);
    day = Number(yearFirst ? match[3] : match[1]);
  }
  const date = new Date(year, month - 1, day);
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    return MISSING;
  }
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
};

const filePart = (value) => text(value)
  .replace(/[<>:"/\\|?*]/gu, "")
  .replace(/\s+/gu, "_")
  .replace(/[. ]+$/gu, "") || "Brak_danych";

export const sickLeavePngFilename = (row) => {
  const employee = row?.employee || {};
  const names = [text(employee.firstName), text(employee.lastName)].filter(Boolean);
  const namePart = names.length ? names.map(filePart).join("_") : "Brak_danych";
  return `${namePart}_L4_${filePart(formatPngDate(row?.start))}-${filePart(formatPngDate(row?.end))}.png`;
};

export const buildSickLeaveSummary = (row) => {
  const employee = row?.employee || {};
  const certificate = text(row?.certificate) === `${row?.id}-${row?.start}-${row?.end}`
    ? ""
    : text(row?.certificate);

  // Keep this allowlist explicit: source records also contain identifiers and
  // medical flags that must never enter an exported image.
  return {
    employer: employerName(row),
    workplace: cleanPngWorkplace(employee.project),
    employeeName: [text(employee.firstName), text(employee.lastName)].filter(Boolean).join(" ") || MISSING,
    certificate: certificate || MISSING,
    issuedAt: formatPngDate(row?.issuedAt),
    period: `${formatPngDate(row?.start)} – ${formatPngDate(row?.end)}`,
  };
};

const setFont = (context, size, weight = 400) => {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
};

const graphemes = (value) => typeof Intl.Segmenter === "function"
  ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (entry) => entry.segment)
  : Array.from(value);

const wrapText = (context, value, width) => {
  const lines = [];
  let line = "";
  for (const word of text(value).split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    // A long single word (or a script without spaces) still wraps without
    // splitting a surrogate pair or, where supported, a grapheme cluster.
    for (const character of graphemes(word)) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [MISSING];
};

const roundedRect = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
  context.fill();
};

const drawLines = (context, lines, x, y, lineHeight) => {
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
};

export const renderSickLeaveCard = (summary) => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Przeglądarka nie obsługuje generowania obrazu PNG.");

  const left = 64;
  const contentWidth = CARD_WIDTH - left * 2;
  const columnGap = 48;
  const columnWidth = (contentWidth - columnGap) / 2;
  const rightColumn = left + columnWidth + columnGap;

  setFont(context, 40, 700);
  const nameLines = wrapText(context, summary.employeeName, contentWidth);
  setFont(context, 24, 600);
  const employerLines = wrapText(context, summary.employer, columnWidth);
  const workplaceLines = wrapText(context, summary.workplace, columnWidth);
  const certificateLines = wrapText(context, summary.certificate, columnWidth);
  const issuedLines = wrapText(context, summary.issuedAt, columnWidth);
  setFont(context, 36, 700);
  const periodLines = wrapText(context, summary.period, contentWidth - 48);

  const nameTop = 164;
  const companyTop = nameTop + nameLines.length * 48 + 30;
  const companyHeight = Math.max(2, employerLines.length, workplaceLines.length) * 33;
  const periodTop = companyTop + 30 + companyHeight + 24;
  const periodHeight = 66 + periodLines.length * 44;
  const certificateTop = periodTop + periodHeight + 30;
  const certificateHeight = Math.max(certificateLines.length, issuedLines.length) * 33;
  const height = Math.max(MIN_CARD_HEIGHT, certificateTop + 30 + certificateHeight + 64);

  canvas.width = CARD_WIDTH * RENDER_SCALE;
  canvas.height = Math.ceil(height * RENDER_SCALE);
  context.scale(RENDER_SCALE, RENDER_SCALE);
  context.textBaseline = "top";
  context.fillStyle = "#eef3f8";
  context.fillRect(0, 0, CARD_WIDTH, height);
  context.fillStyle = "#ffffff";
  roundedRect(context, 24, 24, CARD_WIDTH - 48, height - 48, 20);

  context.fillStyle = "#1b6674";
  context.fillRect(left, 65, 5, 25);
  context.fillStyle = "#21374a";
  setFont(context, 23, 700);
  context.fillText("INFORMACJA O ZWOLNIENIU LEKARSKIM", left + 20, 64);
  context.fillStyle = "#e3eaf0";
  context.fillRect(left, 112, contentWidth, 1);

  const label = (value, x, y) => {
    setFont(context, 17, 500);
    context.fillStyle = "#536879";
    context.fillText(value, x, y);
  };
  label("Pracownik", left, 136);
  setFont(context, 40, 700);
  context.fillStyle = "#172e40";
  drawLines(context, nameLines, left, nameTop, 48);

  label("Pracodawca", left, companyTop);
  label("Miejsce wykonywania pracy", rightColumn, companyTop);
  setFont(context, 24, 600);
  context.fillStyle = "#21374a";
  drawLines(context, employerLines, left, companyTop + 30, 33);
  drawLines(context, workplaceLines, rightColumn, companyTop + 30, 33);

  context.fillStyle = "#edf5f7";
  roundedRect(context, left, periodTop, contentWidth, periodHeight, 12);
  label("Okres zwolnienia", left + 24, periodTop + 19);
  setFont(context, 36, 700);
  context.fillStyle = "#165b6b";
  drawLines(context, periodLines, left + 24, periodTop + 51, 44);

  label("Numer zaświadczenia", left, certificateTop);
  label("Data wystawienia", rightColumn, certificateTop);
  setFont(context, 24, 600);
  context.fillStyle = "#21374a";
  drawLines(context, certificateLines, left, certificateTop + 30, 33);
  drawLines(context, issuedLines, rightColumn, certificateTop + 30, 33);
  return canvas;
};

export const downloadSickLeavePng = (row) => {
  const canvas = renderSickLeaveCard(buildSickLeaveSummary(row));
  const png = canvas.toDataURL("image/png");
  if (!png.startsWith("data:image/png")) {
    throw new Error("Nie udało się wygenerować obrazu PNG.");
  }
  const link = document.createElement("a");
  link.href = png;
  link.download = sickLeavePngFilename(row);
  link.hidden = true;
  document.body.appendChild(link);
  try {
    // Keep rendering and clicking synchronous to preserve the original user
    // activation in mobile browsers; system fonts need no network or await.
    link.click();
  } finally {
    // Give browsers time to consume the download before removing its anchor.
    setTimeout(() => link.remove(), 1000);
  }
};
