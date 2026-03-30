import fs from "node:fs/promises";
import path from "node:path";

const csvUrl = (process.env.SPORT_SHEET_CSV_URL || "").trim();
const csvFile = (process.env.SPORT_SHEET_CSV_FILE || "data/raw/kurse.csv").trim();
const outputFile = (process.env.OUTPUT_FILE || "docs/data/events.json").trim();

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
  const source = await loadSource();
  const rows = parseCsv(source.text);

  const events = rows
    .map((row, index) => rowToEvent(row, index + 1))
    .filter(Boolean);

  const output = {
    generatedAt: new Date().toISOString(),
    source: source.label,
    stats: {
      rows: rows.length,
      events: events.length,
    },
    events,
  };

  const targetPath = path.resolve(outputFile);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(output, null, 2), "utf8");

  console.log(`Events gebaut: ${events.length} aus ${rows.length} Zeilen -> ${outputFile}`);
}

async function loadSource() {
  if (csvUrl) {
    const res = await fetch(csvUrl);
    if (!res.ok) {
      throw new Error(`CSV Download fehlgeschlagen: ${res.status} ${res.statusText}`);
    }

    return {
      label: "google-sheet-csv-url",
      text: await res.text(),
    };
  }

  try {
    const text = await fs.readFile(path.resolve(csvFile), "utf8");
    return {
      label: `local-file:${csvFile}`,
      text,
    };
  } catch {
    console.warn(
      "Keine Datenquelle gefunden. Es wird eine leere events.json erzeugt."
    );
    return {
      label: "none",
      text: "",
    };
  }
}

function rowToEvent(rawRow, index) {
  const row = normalizeRow(rawRow);

  const title = orElse(row.titel, row.sportart, `Kurs ${index}`);
  const id = orElse(row.id, `row-${index}`);
  const start = parseDateTime(orElse(row.startdatetime, row.start));
  const end = parseDateTime(orElse(row.enddatetime, row.ende));

  const recurringEndDate = parseDate(orElse(row.reocurringend, row.recurringend));
  const weekday = extractWeekday(row.wochentag);

  const timeFromStart = start ? formatTime(start) : null;
  const timeFromEnd = end ? formatTime(end) : null;
  const timeRange = parseTimeRange(orElse(row.start, row.zeit));

  const startTime = timeFromStart || timeRange?.start || null;
  const endTime = timeFromEnd || timeRange?.end || null;

  const isSingle = /^ja$/i.test((row.einzeltermin || "").trim());
  const canRecur = Boolean(recurringEndDate && weekday !== null && startTime && endTime && start);

  const base = {
    id: String(id),
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

  if (canRecur && !isSingle) {
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

  if (start) {
    return {
      ...base,
      start: toLocalIso(start),
    };
  }

  return null;
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

function parseTimeRange(value) {
  if (!value) return null;
  const match = value.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
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

function withSeconds(time) {
  return time.length === 5 ? `${time}:00` : time;
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

function parseCsv(text) {
  const rows = [];
  const currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      currentRow.push(currentField);
      rows.push(currentRow.splice(0));
      currentField = "";
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell).trim() !== ""));

  return dataRows.map((cells) => {
    const row = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i] || `col_${i}`] = cells[i] ?? "";
    }
    return row;
  });
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
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
