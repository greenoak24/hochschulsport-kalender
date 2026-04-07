import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

const BASE_URL = "https://buchung.hsz.rwth-aachen.de/angebote/";
const SEMESTER_PATHS = [
  "aktueller_zeitraum/",
  "Sommersemester/",
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
            semester: semesterPath.replace('/', ''),
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

  // 1. Array of raw events completely mapped
  const rawEvents = uniqueRows
    .map((row, index) => rowToEvent(row, index + 1))
    .filter(Boolean);

  // 2. Discover boundaries per semester dynamically
  const semesterBounds = {};
  for (const sem of SEMESTER_PATHS) {
    const semName = sem.replace('/', '');
    const evs = rawEvents.filter(e => e.extendedProps?.semester === semName && e.startRecur && e.endRecur);
    
    const p1Dates = [];
    const p2Dates = [];
    
    for (const e of evs) {
      const sStr = e.startRecur;
      const eStr = e.endRecur;
      const sMonth = parseInt(sStr.split('-')[1], 10);
      
      // Filtere extreme "Ganzsemester"-Kurse heraus, damit sie die typischen P1/P2-Grenzen nicht verfälschen
      const days = (new Date(eStr) - new Date(sStr)) / (1000 * 60 * 60 * 24);
      if (days > 120) continue; 
      
      if (semName === "Sommersemester") {
        if (sMonth <= 6) p1Dates.push(e);
        else p2Dates.push(e);
      } else {
        if (sMonth >= 9 || sMonth <= 1) p1Dates.push(e); // Winter: Oct-Jan
        else p2Dates.push(e); // Winter: Feb-Apr
      }
    }
    
    const getBounds = (list) => {
      if (!list.length) return { start: 0, end: 99999999 };
      let minS = 99999999;
      let maxE = 0;
      for (const e of list) {
        minS = Math.min(minS, parseInt(e.startRecur.replace(/-/g, ""), 10));
        maxE = Math.max(maxE, parseInt(e.endRecur.replace(/-/g, ""), 10));
      }
      return { start: minS, end: maxE };
    };
    
    semesterBounds[semName] = {
      p1: getBounds(p1Dates),
      p2: getBounds(p2Dates)
    };
  }

  console.log("Dynamische Zeiträume ermittelt:", semesterBounds);

  // 3. Assign p1 and p2 flags strictly based on these discovered bounds
  const events = rawEvents.map(e => {
    let p1 = false;
    let p2 = false;
    const semName = e.extendedProps?.semester;
    const bounds = semesterBounds[semName];
    
    if (e.extendedProps?.explicitP1) p1 = true;
    if (e.extendedProps?.explicitP2) p2 = true;

    // Use intersection logic ONLY if the course isn't explicitly labelled
    if (!p1 && !p2 && bounds) {
      const sStr = e.startRecur || (e.start ? e.start.split('T')[0] : null);
      const eStr = e.endRecur || sStr;
      
      if (sStr && eStr) {
        const sDate = parseInt(sStr.replace(/-/g, ""), 10);
        const eDate = parseInt(eStr.replace(/-/g, ""), 10);
        
        // A course is in P1 if it intersects with P1 bounds
        if (sDate <= bounds.p1.end && eDate >= bounds.p1.start) p1 = true;
        // A course is in P2 if it intersects with P2 bounds
        if (sDate <= bounds.p2.end && eDate >= bounds.p2.start) p2 = true;
      }
    }
    
    e.extendedProps.period1 = p1;
    e.extendedProps.period2 = p2;
    return e;
  });

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
    semesterBounds,
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
  const dom = new JSDOM(indexHtml);
  const document = dom.window.document;

  const anchors = document.querySelectorAll("dd > a, dd > span + a");

  for (const a of anchors) {
    const href = (a.getAttribute("href") || "").trim();
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

function parseBookingPage({ html, bookingUrl, sourceTitle, semester }) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const sport = extractSportHeadline(document) || sourceTitle;
  const rows = extractCourseRowsFromHtml(document);

  return rows
    .map((row) => {
      const courseNumber = row.courseNumber;
      if (!isCourseNumber(courseNumber)) return null;

      const einzeltermin = row.details.includes("Ein Termin") ? "ja" : "nein";
      const scheduleTimes = buildScheduleTimes(row.time, row.duration);

      return {
        ID: courseNumber,
        Titel: row.details,
        Semester: semester || null,
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
        explicitP1: row.explicitP1,
        explicitP2: row.explicitP2,
      };
    })
    .filter(Boolean);
}

function extractSportHeadline(document) {
  const head = document.querySelector(".bs_head");
  if (!head) return null;
  return cleanText(head.textContent);
}

function extractCourseRowsFromHtml(document) {
  const out = [];
  const rows = document.querySelectorAll("tr.bs_odd, tr.bs_even");
  
  for (const row of rows) {
    if (!row.querySelector(".bs_sknr")) continue;

    const block = row.closest(".bs_angblock");
    const blockText = block ? block.textContent : document.body.textContent;
    const explicitP1 = /1\.?\s*zeitraum|erster\s*zeitraum/i.test(blockText);
    const explicitP2 = /2\.?\s*zeitraum|zweiter\s*zeitraum/i.test(blockText);

    const getCellText = (cls) => cleanText(row.querySelector(`.${cls}`)?.innerHTML || "");
    const getCellEl = (cls) => row.querySelector(`.${cls}`);

    out.push({
      courseNumber: getCellText("bs_sknr"),
      details: getCellText("bs_sdet"),
      day: getCellText("bs_stag"),
      time: getCellText("bs_szeit"),
      location: getCellText("bs_sort"),
      duration: getCellText("bs_szr"),
      instructor: getCellText("bs_skl"),
      price: getCellText("bs_spreis"),
      bookingStatus: extractBookingStatus(getCellEl("bs_sbuch")),
      explicitP1,
      explicitP2,
    });
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
      kategorie: getCategory(title),
      semester: row.semester || null,
      sport: row.sportart || null,
      location: row.ort || null,
      bookingStatus: row.buchung || null,
      price: row.preisstudierende || null,
      sourceTitle: row.titel || null,
      explicitP1: row.explicitp1 === "true",
      explicitP2: row.explicitp2 === "true",
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

function getCategory(title) {
  const t = title.toLowerCase();
  if (t.includes("basketball") || t.includes("fußball") || t.includes("fussball") || t.includes("volleyball") || t.includes("tennis") || t.includes("badminton") || t.includes("handball") || t.includes("tischtennis") || t.includes("squash") || t.includes("hockey")) return "Ballsport";
  if (t.includes("tanz") || t.includes("ballett") || t.includes("hip hop") || t.includes("salsa") || t.includes("zumba") || t.includes("bachata") || t.includes("kizomba") || t.includes("swing")) return "Tanzsport";
  if (t.includes("yoga") || t.includes("pilates") || t.includes("meditation") || t.includes("tai chi") || t.includes("qigong") || t.includes("entspannung")) return "Entspannung & Gesundheit";
  if (t.includes("schwimm") || t.includes("tauch") || t.includes("aqua") || t.includes("wasser") || t.includes("ruder") || t.includes("segeln") || t.includes("kite") || t.includes("kanu") || t.includes("surf")) return "Wassersport";
  if (t.includes("fitness") || t.includes("workout") || t.includes("kraft") || t.includes("crossfit") || t.includes("gymnastik") || t.includes("bodyshaping") || t.includes("aerobic") || t.includes("langhantel") || t.includes("trimm") || t.includes("core")) return "Fitness & Kraft";
  if (t.includes("boxen") || t.includes("karate") || t.includes("judo") || t.includes("taekwondo") || t.includes("fechten") || t.includes("kampfsport") || t.includes("arnis") || t.includes("jiu") || t.includes("krav") || t.includes("capoeira")) return "Kampfsport";
  if (t.includes("klettern") || t.includes("bouldern") || t.includes("alpin") || t.includes("parkour")) return "Klettern & Alpin";
  if (t.includes("rad") || t.includes("mountain") || t.includes("skate") || t.includes("inliner") || t.includes("lauf") || t.includes("leichtathletik") || t.includes("triathlon")) return "Outdoor & Ausdauer";
  return "Sonstige";
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
