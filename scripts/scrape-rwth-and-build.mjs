import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://buchung.hsz.rwth-aachen.de/angebote/";
const SEMESTER_PATHS = [
  "aktueller_zeitraum/",
  "sommersemester/",
];
const OUTPUT_FILE = process.env.OUTPUT_FILE || "docs/data/events.json";
const MAX_COURSE_PAGES = Number(process.env.MAX_COURSE_PAGES || 450);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 30000);
const DEBUG_ROWS = process.env.DEBUG_ROWS === "1";

const weekdayMap = {
  Mo: 1,
  Di: 2,
  Mi: 3,
  Do: 4,
  Fr: 5,
  Sa: 6,
  So: 0,
};

async function main() {
  const allRows = [];
  const allStats = { totalPages: 0, totalRows: 0 };

  for (const semesterPath of SEMESTER_PATHS) {
    const startUrl = BASE_URL + semesterPath;
    console.log(`Scrape gestartet: ${startUrl}`);

    try {
      const indexHtml = await fetchText(startUrl);
      const courseLinks = extractCourseLinks(indexHtml, startUrl).slice(0, MAX_COURSE_PAGES);
      allStats.totalPages += courseLinks.length;

      for (const courseUrl of courseLinks) {
        try {
          const html = await fetchText(courseUrl);
          const parsed = parseBookingPage({
            html,
            bookingUrl: courseUrl,
            sourceTitle: inferTitleFromUrl(courseUrl),
          });

          allRows.push(...parsed);
          allStats.totalRows += parsed.length;
        } catch (error) {
          console.warn(`Kursseite fehlgeschlagen: ${courseUrl} (${error.message})`);
        }
      }

      console.log(`✓ ${semesterPath}: ${courseLinks.length} Kursseiten, ${allRows.length} Zeilen insgesamt`);
    } catch (error) {
      console.warn(`Semester fehlgeschlagen: ${semesterPath} (${error.message})`);
    }
  }

  // Deduplizieren nach Kursnummer + Wochentag + Start
  const uniqueRows = deduplicateRows(allRows);

  const events = uniqueRows
    .map((row, index) => rowToEvent(row, index + 1))
    .filter(Boolean);

  if (DEBUG_ROWS) {
    console.log("DEBUG rows sample:", uniqueRows.slice(0, 5));
    console.log(
      "DEBUG field coverage:",
      {
        withDay: uniqueRows.filter((r) => String(r.Wochentag || "").trim() !== "").length,
        withStart: uniqueRows.filter((r) => String(r.Start || "").trim() !== "").length,
        withEnde: uniqueRows.filter((r) => String(r.Ende || "").trim() !== "").length,
        withStartDt: uniqueRows.filter((r) => String(r.StartDatetime || "").trim() !== "").length,
        withEndDt: uniqueRows.filter((r) => String(r.EndDateTime || "").trim() !== "").length,
      }
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "hsz-multi-semester",
    stats: {
      semesters: SEMESTER_PATHS.length,
      coursePages: allStats.totalPages,
      rawRows: allStats.totalRows,
      deduplicatedRows: uniqueRows.length,
      events: events.length,
    },
    events,
  };

  const targetPath = path.resolve(OUTPUT_FILE);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(output, null, 2), "utf8");

  console.log(
    `Scrape fertig: ${SEMESTER_PATHS.length} Semester, ${allStats.totalPages} Kursseiten, ${uniqueRows.length} dedupliziert, ${events.length} Events -> ${OUTPUT_FILE}`
  );
}

function extractCourseLinks(indexHtml, baseUrl) {
  const links = [];

  for (const match of indexHtml.matchAll(/<dd[^>]*>\s*<span[^>]*><\/span>\s*<a href=["']([^"']+)["'][^>]*>/gi)) {
    const href = (match[1] || "").trim();
    if (!href) continue;
    if (href.startsWith("#")) continue;
    if (href.includes("kurssuche")) continue;

    const absolute = toAbsoluteUrl(baseUrl, href);
    if (!absolute.includes("/angebote/")) continue;
    if (!absolute.toLowerCase().endsWith(".html")) continue;
    links.push(absolute);
  }

  return unique(links);
}

function parseBookingPage({ html, bookingUrl, sourceTitle }) {
  const sport = extractSportHeadline(html) || sourceTitle;
  const rows = extractCourseRowsFromHtml(html);

  return rows
    .map((row) => {
      const courseNumber = row.courseNumber;
      if (!isCourseNumber(courseNumber)) return null;

      const einzeltermin = row.details.includes("Ein Termin") ? "ja" : "nein";
      const scheduleTimes = buildScheduleTimes(row.time, row.duration);

      return {
        ID: courseNumber,
        Titel: row.details,
        Sportart: sourceTitle || sport || null,
        Wochentag: row.day,
        Start: row.time,
        Ende: row.duration,
        StartDatetime: scheduleTimes.start,
        EndDateTime: scheduleTimes.end,
        ReocurringEnd: scheduleTimes.recurringEnd,
        Einzeltermin: einzeltermin,
        Ort: row.location,
        URL: bookingUrl,
        Buchung: row.bookingStatus,
        preisStudierende: row.price,
        instructor: row.instructor,
      };
    })
    .filter(Boolean);
}

function extractSportHeadline(html) {
  const match = html.match(/class=["'][^"']*bs_head[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (!match) return null;
  return cleanText(match[1]);
}

function extractCourseColumns(html) {
  const tdRegex = /<td[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/td>/gi;
  const courses = [];
  const bookingCells = [];

  for (const match of html.matchAll(tdRegex)) {
    const className = match[1];
    const inner = match[2] || "";

    if (!/\bbs_s(knr|det|stag|szeit|sort|szr|skl|spreis|sbuch)\b/i.test(className)) {
      continue;
    }

    const text = cleanText(inner);
    courses.push(text);

    if (/\bbs_sbuch\b/i.test(className)) {
      bookingCells.push(inner);
    }
  }

  return { courses, bookingCells };
}

function extractCourseRowsFromHtml(html) {
  const out = [];

  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] || "";
    if (!/\bbs_sknr\b/i.test(rowHtml)) continue;

    const courseNumber = cleanText(extractCellHtml(rowHtml, "bs_sknr"));
    const details = cleanText(extractCellHtml(rowHtml, "bs_sdet"));
    const day = cleanText(extractCellHtml(rowHtml, "bs_stag"));
    const time = cleanText(extractCellHtml(rowHtml, "bs_szeit"));
    const location = cleanText(extractCellHtml(rowHtml, "bs_sort"));
    const duration = cleanText(extractCellHtml(rowHtml, "bs_szr"));
    const instructor = cleanText(extractCellHtml(rowHtml, "bs_skl"));
    const price = cleanText(extractCellHtml(rowHtml, "bs_spreis"));
    const bookingHtml = extractCellHtml(rowHtml, "bs_sbuch");
    const bookingStatus = extractBookingStatus(bookingHtml);

    out.push({
      courseNumber,
      details,
      day,
      time,
      location,
      duration,
      instructor,
      price,
      bookingStatus,
    });
  }

  return out;
}

function extractCellHtml(rowHtml, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<td[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
    "i"
  );
  const match = rowHtml.match(regex);
  return match ? match[1] : "";
}

function parseCourseRows({ courses, bookingCells, sport, sourceTitle, bookingUrl }) {
  const out = [];
  const cleaned = courses.map(cleanText).filter(Boolean);

  let i = 0;
  let bookingIndex = 0;

  while (i < cleaned.length) {
    let courseNumber = cleaned[i] || "";
    if (!isCourseNumber(courseNumber)) {
      i++;
      continue;
    }

    if (!courseNumber) {
      courseNumber = randomCourseNumber();
    }
    i++;

    const details = cleaned[i] || "";
    i++;

    const scheduleBlocks = [];

    while (i < cleaned.length && isDay(cleaned[i])) {
      const day = cleaned[i] || "";
      const time = cleaned[i + 1] || "";
      let location = "";

      if (!isTimeRange(time)) break;
      i += 2;

      const candidateLocation = cleaned[i] || "";
      if (looksLikeLocation(candidateLocation)) {
        location = candidateLocation;
        i++;
      }

      scheduleBlocks.push({ day, time, location });
    }

    let duration = "";
    let instructor = "";
    let price = "";

    if (i < cleaned.length && isDateRange(cleaned[i])) {
      duration = cleaned[i];
      i++;
    }

    if (i < cleaned.length && !isPrice(cleaned[i]) && !isCourseNumber(cleaned[i])) {
      instructor = cleaned[i];
      i++;
    }

    if (i < cleaned.length && isPrice(cleaned[i])) {
      price = cleaned[i];
      i++;
    }

    const bookingStatus = extractBookingStatus(bookingCells[bookingIndex] || "");
    bookingIndex += 1;

    const einzeltermin = details.includes("Ein Termin") ? "ja" : "nein";

    for (const block of scheduleBlocks) {
      const scheduleTimes = buildScheduleTimes(block.time, duration);

      out.push({
        ID: courseNumber,
        Titel: details,
        Sportart: sourceTitle || sport || null,
        Wochentag: block.day,
        Start: block.time,
        Ende: duration,
        StartDatetime: scheduleTimes.start,
        EndDateTime: scheduleTimes.end,
        ReocurringEnd: scheduleTimes.recurringEnd,
        Einzeltermin: einzeltermin,
        Ort: block.location || "",
        URL: bookingUrl,
        Buchung: bookingStatus,
        preisStudierende: price,
        instructor,
      });
    }
  }

  return out;
}

function rowToEvent(rawRow, index) {
  const row = normalizeRow(rawRow);

  const title = normalizeEventTitle({
    rawTitle: orElse(row.titel),
    sport: orElse(row.sportart),
    courseId: orElse(row.id),
    fallback: `Kurs ${index}`,
  });
  const id = orElse(row.id, `row-${index}`);
  const start = parseDateTime(orElse(row.startdatetime));
  const end = parseDateTime(orElse(row.enddatetime));

  const recurringEndDate = parseDate(orElse(row.reocurringend, row.recurringend));
  const weekday = extractWeekday(row.wochentag);
  const durationRange = parseDateRange(
    orElse(row.ende, row.duration, row.reocurringend, row.recurringend, row.titel)
  );

  const timeFromStartDate = start ? formatTime(start) : null;
  const timeFromEndDate = end ? formatTime(end) : null;
  const timeRange = parseTimeRange(orElse(row.start, row.zeit, row.time));

  const startTime = timeFromStartDate || timeRange?.start || null;
  const endTime = timeFromEndDate || timeRange?.end || null;

  const isSingle = /^ja$/i.test((row.einzeltermin || "").trim());
  const canRecurFromFields = Boolean(
    !isSingle &&
    weekday !== null &&
    startTime &&
    endTime &&
    durationRange &&
    durationRange.type === "range"
  );
  const canRecurFromExplicitDates = Boolean(
    !isSingle &&
    recurringEndDate &&
    weekday !== null &&
    startTime &&
    endTime &&
    start
  );

  const base = {
    id: `${id}-${index}`,
    title,
    url: row.url || undefined,
    extendedProps: {
      courseId: row.id || null,
      sport: row.sportart || null,
      location: row.ort || null,
      bookingStatus: row.buchung || null,
      price: row.preisstudierende || null,
      sourceTitle: row.titel || null,
    },
  };

  if (canRecurFromFields) {
    const startRecur = toDateString(durationRange.startYear, durationRange.startMonth, durationRange.startDay);
    const endRecurExclusive = formatDate(
      addDays(new Date(durationRange.endYear, durationRange.endMonth - 1, durationRange.endDay), 1)
    );

    return {
      ...base,
      daysOfWeek: [weekday],
      startTime: withSeconds(startTime),
      endTime: withSeconds(endTime),
      startRecur,
      endRecur: endRecurExclusive,
    };
  }

  if (canRecurFromExplicitDates) {
    return {
      ...base,
      daysOfWeek: [weekday],
      startTime: withSeconds(startTime),
      endTime: withSeconds(endTime),
      startRecur: formatDate(start),
      endRecur: formatDate(addDays(recurringEndDate, 1)),
    };
  }

  if (start && end) {
    return {
      ...base,
      start: toLocalIso(start),
      end: toLocalIso(end),
    };
  }

  if (isSingle && durationRange && startTime && endTime) {
    const startDate = new Date(
      durationRange.startYear,
      durationRange.startMonth - 1,
      durationRange.startDay,
      Number(startTime.split(":")[0]),
      Number(startTime.split(":")[1]),
      0
    );
    const endDate = new Date(
      durationRange.startYear,
      durationRange.startMonth - 1,
      durationRange.startDay,
      Number(endTime.split(":")[0]),
      Number(endTime.split(":")[1]),
      0
    );

    return {
      ...base,
      start: toLocalIso(startDate),
      end: toLocalIso(endDate),
    };
  }

  if (start) {
    return {
      ...base,
      start: toLocalIso(start),
    };
  }

  return null;
}

function normalizeEventTitle({ rawTitle, sport, courseId, fallback }) {
  let value = cleanText(rawTitle || "");

  if (!value) {
    return sport || fallback;
  }

  const idMatch = value.match(/\b\d{6,10}\b/);
  if (idMatch && idMatch.index !== undefined) {
    const before = value.slice(0, idMatch.index).trim();
    const afterFull = value.slice(idMatch.index + idMatch[0].length).trim();
    let after = afterFull;

    if (before && afterFull.toLowerCase().startsWith(before.toLowerCase())) {
      after = afterFull.slice(before.length).trim();
    }

    value = [before, after].filter(Boolean).join(" ").trim();
  }

  value = value
    .replace(/\b\d{2}\.\d{2}\.\d{4}\s*-\s*\d{2}\.\d{2}\.\d{4}\b.*$/g, "")
    .replace(/\b\d{2}\.\d{2}\.\d{4}\b.*$/g, "")
    .replace(/\b\d{6,10}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) {
    return sport || fallback;
  }

  if (sport) {
    const sportLower = sport.toLowerCase();
    const valueLower = value.toLowerCase();
    if (valueLower === sportLower) return sport;
    if (valueLower.startsWith(`${sportLower} ${sportLower}`)) {
      return `${sport} ${value.slice(sport.length * 2).trim()}`.trim();
    }
  }

  return value;
}

function toAbsoluteUrl(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

function inferTitleFromUrl(url) {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] || "";
    return decodeURIComponent(slug)
      .replace(/\.html?$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
  } catch {
    return null;
  }
}

function unique(items) {
  return Array.from(new Set(items));
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    uuml: "ue",
    auml: "ae",
    ouml: "oe",
    Uuml: "Ue",
    Auml: "Ae",
    Ouml: "Oe",
    szlig: "ss",
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, token) => {
    if (token.startsWith("#x") || token.startsWith("#X")) {
      const cp = Number.parseInt(token.slice(2), 16);
      return Number.isNaN(cp) ? _ : String.fromCodePoint(cp);
    }
    if (token.startsWith("#")) {
      const cp = Number.parseInt(token.slice(1), 10);
      return Number.isNaN(cp) ? _ : String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(named, token) ? named[token] : _;
  });
}

function stripTags(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return decodeHtmlEntities(stripTags(String(value || "")))
    .replace(/\[\/cgi\/webpage\.cgi\?[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBookingStatus(html) {
  const text = String(html || "");
  const valueMatch = text.match(/value=["']([^"']+)["']/i);
  if (valueMatch) return cleanText(valueMatch[1]);

  const textMatch = text.match(/>([^<]+)</);
  if (textMatch) return cleanText(textMatch[1]);

  return "";
}

function randomCourseNumber() {
  return `--${Math.floor(1000000000 + Math.random() * 9000000000)}`;
}

function isCourseNumber(value) {
  const v = cleanText(value);
  return /^\d+$/.test(v) || /^--\d{10}$/.test(v);
}

function isDay(value) {
  return /^(Mo|Di|Mi|Do|Fr|Sa|So)$/i.test(cleanText(value));
}

function isTimeRange(value) {
  return /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.test(cleanText(value));
}

function isDateRange(value) {
  const v = cleanText(value);
  return /^\d{2}\.\d{2}\.\d{4}$/.test(v)
    || /^\d{2}\.\d{2}\.$/.test(v)
    || /^\d{2}\.\d{2}\.\d{2,4}\s*-\s*\d{2}\.\d{2}\.\d{2,4}$/.test(v)
    || /^\d{2}\.\d{2}\.\s*-\s*\d{2}\.\d{2}\.$/.test(v);
}

function isPrice(value) {
  return /€|eur/i.test(cleanText(value));
}

function looksLikeLocation(value) {
  const v = cleanText(value);
  if (!v) return false;
  if (isDay(v) || isTimeRange(v) || isDateRange(v) || isPrice(v) || isCourseNumber(v)) return false;
  return true;
}

function parseTimeRange(value) {
  if (!value) return null;
  const match = cleanText(value).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) return null;

  return {
    start: padTime(match[1]),
    end: padTime(match[2]),
  };
}

function padTime(v) {
  const [h, m] = v.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseDateRange(durationText) {
  const v = cleanText(durationText).replace(/\s+/g, "");
  const currentYear = new Date().getFullYear();

  let match = v.match(/(\d{2})\.(\d{2})\.(\d{4})-(\d{2})\.(\d{2})\.(\d{4})/);
  if (match) {
    return {
      type: "range",
      startDay: Number(match[1]),
      startMonth: Number(match[2]),
      startYear: Number(match[3]),
      endDay: Number(match[4]),
      endMonth: Number(match[5]),
      endYear: Number(match[6]),
    };
  }

  match = v.match(/(\d{2})\.(\d{2})\.-(\d{2})\.(\d{2})\./);
  if (match) {
    const startMonth = Number(match[2]);
    const endMonth = Number(match[4]);
    const startYear = currentYear;
    const endYear = endMonth < startMonth ? startYear + 1 : startYear;

    return {
      type: "range",
      startDay: Number(match[1]),
      startMonth,
      startYear,
      endDay: Number(match[3]),
      endMonth,
      endYear,
    };
  }

  match = v.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    return {
      type: "single",
      startDay: day,
      startMonth: month,
      startYear: year,
      endDay: day,
      endMonth: month,
      endYear: year,
    };
  }

  match = v.match(/(\d{2})\.(\d{2})\./);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);

    return {
      type: "single",
      startDay: day,
      startMonth: month,
      startYear: currentYear,
      endDay: day,
      endMonth: month,
      endYear: currentYear,
    };
  }

  return null;
}

function buildScheduleTimes(timeText, durationText) {
  const parsedTime = parseTimeRange(timeText);
  const parsedRange = parseDateRange(durationText);

  if (!parsedTime || !parsedRange) {
    return {
      start: "",
      end: "",
      recurringEnd: "",
    };
  }

  return {
    start: toLocalIsoFromParts(
      parsedRange.startYear,
      parsedRange.startMonth,
      parsedRange.startDay,
      Number(parsedTime.start.split(":")[0]),
      Number(parsedTime.start.split(":")[1])
    ),
    end: toLocalIsoFromParts(
      parsedRange.startYear,
      parsedRange.startMonth,
      parsedRange.startDay,
      Number(parsedTime.end.split(":")[0]),
      Number(parsedTime.end.split(":")[1])
    ),
    recurringEnd: toLocalIsoFromParts(
      parsedRange.endYear,
      parsedRange.endMonth,
      parsedRange.endDay,
      23,
      59
    ),
  };
}

function toLocalIsoFromParts(year, month, day, hour, minute) {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
}

function toDateString(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function withSeconds(time) {
  return time.length === 5 ? `${time}:00` : time;
}

function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const normKey = String(key)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    out[normKey] = String(value ?? "").trim();
  }
  return out;
}

function extractWeekday(raw) {
  if (!raw) return null;
  const match = raw.match(/(Mo|Di|Mi|Do|Fr|Sa|So)/i);
  if (!match) return null;
  const short = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  return weekdayMap[short] ?? null;
}

function parseDateTime(value) {
  if (!value) return null;

  const trimmed = value.trim();

  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;

  let match = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      0
    );
  }

  match = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    return new Date(
      2000 + Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      0
    );
  }

  return null;
}

function parseDate(value) {
  if (!value) return null;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return new Date(direct.getFullYear(), direct.getMonth(), direct.getDate());
  }

  let match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) {
    return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }

  match = value.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (match) {
    return new Date(2000 + Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }

  return null;
}

function toLocalIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function orElse(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function deduplicateRows(rows) {
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const id = String(row.ID || "");
    const day = String(row.Wochentag || "").toLowerCase();
    const start = String(row.Start || "").trim();
    const sport = String(row.Sportart || "").toLowerCase();

    const key = `${id}|${day}|${start}|${sport}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  }

  return unique;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "hochschulsport-scraper-pages/1.0 (+github-actions)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
