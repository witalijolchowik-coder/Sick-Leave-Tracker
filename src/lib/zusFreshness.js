const warsawCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
});

const dateKey = (date) => {
  const parts = Object.fromEntries(warsawCalendar.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const fixedHolidays = new Set([
  "01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26",
]);

// Gregorian Easter (Meeus/Jones/Butcher), used for the Polish movable holidays.
const easterSunday = (year) => {
  const cycle = year % 19;
  const century = Math.floor(year / 100);
  const remainder = year % 100;
  const leapCenturies = Math.floor(century / 4);
  const correction = Math.floor((century + 8) / 25);
  const epact = (19 * cycle + century - leapCenturies -
    Math.floor((century - correction + 1) / 3) + 15) % 30;
  const weekday = (32 + 2 * (century % 4) + 2 * Math.floor(remainder / 4) -
    epact - remainder % 4) % 7;
  const offset = epact + weekday - 7 * Math.floor((cycle + 11 * epact + 22 * weekday) / 451) + 114;
  return Date.UTC(year, Math.floor(offset / 31) - 1, offset % 31 + 1);
};

const isWorkingDay = (date) => {
  const weekday = date.getUTCDay();
  const day = date.toISOString().slice(5, 10);
  const year = date.getUTCFullYear();
  if (weekday === 0 || weekday === 6 || fixedHolidays.has(day) || (year >= 2025 && day === "12-24")) {
    return false;
  }
  const daysAfterEaster = (date.getTime() - easterSunday(year)) / 86_400_000;
  return daysAfterEaster !== 1 && daysAfterEaster !== 60;
};

export const toUploadDate = (timestamp) => {
  if (!timestamp) return null;
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function zusFreshness(timestamp, now = new Date()) {
  const uploaded = toUploadDate(timestamp);
  if (!uploaded) return { color: "#94A3B8", label: "Brak danych ZUS" };
  const uploadedDay = dateKey(uploaded);
  const today = dateKey(now);
  if (uploadedDay === today) {
    return { color: "#22D3A2", label: "Dane ZUS zaktualizowane dzisiaj" };
  }
  const previous = new Date(today + "T00:00:00Z");
  do {
    previous.setUTCDate(previous.getUTCDate() - 1);
  } while (!isWorkingDay(previous));
  const previousDay = previous.toISOString().slice(0, 10);
  if (uploadedDay >= previousDay && uploadedDay < today) {
    return {
      color: "#F6C85F",
      label: uploadedDay === previousDay
        ? "Dane ZUS z poprzedniego dnia roboczego"
        : "Dane ZUS zaktualizowane po poprzednim dniu roboczym",
    };
  }
  return { color: "#FF6B86", label: "Dane ZUS wymagają aktualizacji" };
}
