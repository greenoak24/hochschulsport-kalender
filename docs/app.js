const weekdayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const monthFormatter = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});
const dayHeaderFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});
const detailFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const DAY_START_MINUTES = 7 * 60;
const DAY_END_MINUTES = 23 * 60;

const state = {
  currentDate: stripTime(new Date()),
  selectedDate: toDateKey(new Date()),
  viewMode: "month",
  events: [],
  allSports: [],
  selectedSports: new Set(),
  selectedLevels: new Set(),
  levelFilterPrimed: false,
  onlyBookable: false,
  onlySingle: false,
  sportSearch: "",
};

const monthLabelEl = document.getElementById("monthLabel");
const weekdayRowEl = document.getElementById("weekdayRow");
const calendarGridEl = document.getElementById("calendarGrid");
const detailDateEl = document.getElementById("detailDate");
const detailListEl = document.getElementById("detailList");
const sportSearchEl = document.getElementById("sportSearch");
const sportSuggestionBoxEl = document.getElementById("sportSuggestionBox");
const selectedSportsEl = document.getElementById("selectedSports");
const clearSportFilterEl = document.getElementById("clearSportFilter");
const bookableOnlyEl = document.getElementById("bookableOnly");
const singleOnlyEl = document.getElementById("singleOnly");
const levelFilterContainerEl = document.getElementById("levelFilterContainer");
const viewButtons = Array.from(document.querySelectorAll(".view-btn"));

document.getElementById("prevMonth").addEventListener("click", () => {
  shiftView(-1);
  render();
});

document.getElementById("nextMonth").addEventListener("click", () => {
  shiftView(1);
  render();
});

document.getElementById("today").addEventListener("click", () => {
  const now = stripTime(new Date());
  state.currentDate = now;
  state.selectedDate = toDateKey(now);
  render();
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextView = button.dataset.view;
    if (!nextView || state.viewMode === nextView) return;
    state.viewMode = nextView;
    state.selectedDate = toDateKey(state.currentDate);
    render();
  });
});

sportSearchEl.addEventListener("input", () => {
  state.sportSearch = sportSearchEl.value.trim().toLowerCase();
  renderSportFilterOptions();
});

sportSearchEl.addEventListener("focus", () => {
  renderSportFilterOptions();
});

sportSearchEl.addEventListener("change", () => {
  tryAddSportFromInput();
});

sportSearchEl.addEventListener("blur", () => {
  // Let click events on suggestion buttons fire before hiding.
  setTimeout(() => {
    sportSuggestionBoxEl.classList.remove("visible");
  }, 120);
});

sportSearchEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    tryAddSportFromInput(true);
  }
});

clearSportFilterEl.addEventListener("click", () => {
  state.selectedSports = new Set();
  state.selectedLevels = new Set();
  state.levelFilterPrimed = false;
  state.onlyBookable = false;
  state.onlySingle = false;
  bookableOnlyEl.checked = false;
  singleOnlyEl.checked = false;
  sportSearchEl.value = "";
  state.sportSearch = "";
  render();
});

bookableOnlyEl.addEventListener("change", () => {
  state.onlyBookable = bookableOnlyEl.checked;
  render();
});

singleOnlyEl.addEventListener("change", () => {
  state.onlySingle = singleOnlyEl.checked;
  render();
});

init();

async function init() {
  await loadEvents();
  initializeSports();
  render();
}

async function loadEvents() {
  const url = `./data/events.json?t=${Date.now()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Konnte Daten nicht laden (${response.status})`);
  }

  const payload = await response.json();
  state.events = Array.isArray(payload.events) ? payload.events : [];
}

function initializeSports() {
  state.allSports = Array.from(
    new Set(
      state.events
        .map((event) => getEventMeta(event).baseSport)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "de"));
}

function renderSportFilterOptions() {
  const visibleSports = !state.sportSearch
    ? state.allSports.slice()
    : state.allSports
      .map((sport) => ({ sport, score: fuzzyScore(sport, state.sportSearch) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.sport.localeCompare(b.sport, "de");
      })
      .map((entry) => entry.sport);

  sportSuggestionBoxEl.innerHTML = "";

  const items = visibleSports
    .filter((sport) => !state.selectedSports.has(sport))
    .slice(0, 60);

  if (!items.length) {
    sportSuggestionBoxEl.classList.remove("visible");
    return;
  }

  items.forEach((sport) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "suggestion-item";
    item.textContent = sport;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      state.selectedSports.add(sport);
      state.selectedLevels = new Set();
      state.levelFilterPrimed = false;
      sportSearchEl.value = "";
      state.sportSearch = "";
      render();
    });
    sportSuggestionBoxEl.appendChild(item);
  });

  sportSuggestionBoxEl.classList.add("visible");
}

function tryAddSportFromInput(useFirstMatch = false) {
  const inputValue = normalizeSpace(sportSearchEl.value);
  if (!inputValue) return;

  let match = state.allSports.find((sport) => sport.toLowerCase() === inputValue.toLowerCase());

  if (!match && useFirstMatch) {
    match = state.allSports.find((sport) => sport.toLowerCase().includes(inputValue.toLowerCase()));
  }

  if (!match) return;

  state.selectedSports.add(match);
  state.selectedLevels = new Set();
  state.levelFilterPrimed = false;
  sportSearchEl.value = "";
  state.sportSearch = "";
  render();
}

function renderSelectedSports() {
  selectedSportsEl.innerHTML = "";

  Array.from(state.selectedSports)
    .sort((a, b) => a.localeCompare(b, "de"))
    .forEach((sport) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sport-chip";
      chip.textContent = sport;
      chip.addEventListener("click", () => {
        state.selectedSports.delete(sport);
        state.selectedLevels = new Set();
        state.levelFilterPrimed = false;
        render();
      });
      selectedSportsEl.appendChild(chip);
    });
}

function renderLevelFilter() {
  levelFilterContainerEl.innerHTML = "";

  if (!state.selectedSports.size) {
    levelFilterContainerEl.classList.remove("visible");
    return;
  }

  const levels = getAvailableLevelsForSelection();
  if (!levels.length) {
    levelFilterContainerEl.classList.remove("visible");
    return;
  }

  levelFilterContainerEl.classList.add("visible");

  const label = document.createElement("span");
  label.className = "level-label";
  label.textContent = "Level ausblenden:";
  levelFilterContainerEl.appendChild(label);

  levels.forEach((level) => {
    const chip = document.createElement("button");
    chip.type = "button";
    const isActive = !state.levelFilterPrimed || state.selectedLevels.has(level);
    chip.className = `level-chip${isActive ? "" : " off"}`;
    chip.textContent = level;
    chip.addEventListener("click", () => {
      if (!state.levelFilterPrimed) {
        state.levelFilterPrimed = true;
        state.selectedLevels = new Set([level]);
      } else {
        if (state.selectedLevels.has(level)) {
          state.selectedLevels.delete(level);
        } else {
          state.selectedLevels.add(level);
        }

        if (state.selectedLevels.size === 0) {
          state.levelFilterPrimed = false;
        }
      }
      render();
    });
    levelFilterContainerEl.appendChild(chip);
  });
}

function getAvailableLevelsForSelection() {
  const levels = new Set();

  state.events.forEach((event) => {
    const meta = getEventMeta(event);
    if (!state.selectedSports.has(meta.baseSport)) return;
    if (!meta.level) return;
    levels.add(meta.level);
  });

  return Array.from(levels).sort((a, b) => a.localeCompare(b, "de"));
}

function render() {
  updateViewButtons();
  renderSportFilterOptions();
  renderSelectedSports();
  renderLevelFilter();

  const viewRange = getViewRange();
  const filteredEvents = filterEvents(state.events);
  const eventsByDate = buildEventsByDate(filteredEvents, viewRange.start, viewRange.end);

  renderHeader(viewRange);
  renderWeekdayHeader(viewRange);
  renderGrid(viewRange, eventsByDate);

  const selectedEvents = eventsByDate.get(state.selectedDate) || [];
  renderDetails(selectedEvents);
}

function updateViewButtons() {
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.viewMode);
  });
}

function getViewRange() {
  if (state.viewMode === "week") {
    const start = startOfWeek(state.currentDate);
    const end = addDays(start, 6);
    return { start, end, cellCount: 7, isMonthMode: false };
  }

  if (state.viewMode === "day") {
    const start = stripTime(state.currentDate);
    return { start, end: start, cellCount: 1, isMonthMode: false };
  }

  const monthStart = startOfMonth(state.currentDate);
  const start = startOfCalendarGrid(monthStart);
  const end = addDays(start, 41);
  return { start, end, cellCount: 42, isMonthMode: true };
}

function renderHeader(viewRange) {
  if (state.viewMode === "month") {
    monthLabelEl.textContent = capitalize(monthFormatter.format(state.currentDate));
    return;
  }

  if (state.viewMode === "week") {
    const weekNo = getIsoWeek(viewRange.start);
    const endLabel = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(viewRange.end);
    monthLabelEl.textContent = `KW ${weekNo} | ${formatDate(viewRange.start)}-${endLabel}`;
    return;
  }

  monthLabelEl.textContent = capitalize(detailFormatter.format(state.currentDate));
}

function renderWeekdayHeader(viewRange) {
  weekdayRowEl.innerHTML = "";

  if (state.viewMode === "day") {
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = capitalize(dayHeaderFormatter.format(viewRange.start));
    weekdayRowEl.style.gridTemplateColumns = "minmax(0, 1fr)";
    weekdayRowEl.appendChild(el);
    return;
  }

  weekdayRowEl.style.gridTemplateColumns = "repeat(7, minmax(0, 1fr))";
  for (let i = 0; i < 7; i++) {
    const date = addDays(viewRange.start, i);
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = capitalize(dayHeaderFormatter.format(date));
    weekdayRowEl.appendChild(el);
  }
}

function renderGrid(viewRange, eventsByDate) {
  if (state.viewMode === "week" || state.viewMode === "day") {
    renderTimeGrid(viewRange, eventsByDate);
    return;
  }

  calendarGridEl.innerHTML = "";
  calendarGridEl.classList.remove("week", "day");
  calendarGridEl.classList.add("month");

  for (let i = 0; i < viewRange.cellCount; i++) {
    const date = addDays(viewRange.start, i);
    const key = toDateKey(date);
    const dayEvents = eventsByDate.get(key) || [];
    const isCurrentMonth = date.getMonth() === state.currentDate.getMonth();

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `day-cell${viewRange.isMonthMode && !isCurrentMonth ? " outside" : ""}${state.selectedDate === key ? " selected" : ""}`;

    const number = document.createElement("div");
    number.className = "day-number";
    number.textContent = state.viewMode === "day"
      ? capitalize(detailFormatter.format(date))
      : String(date.getDate());
    cell.appendChild(number);

    const maxVisible = state.viewMode === "day" ? 20 : state.viewMode === "week" ? 5 : 3;
    dayEvents.slice(0, maxVisible).forEach((event) => {
      const chip = document.createElement("div");
      chip.className = `event-chip ${event.isSingle ? "single" : "recurring"}`;
      chip.textContent = `${event.timeLabel} ${event.title}`.trim();
      cell.appendChild(chip);
    });

    if (dayEvents.length > maxVisible) {
      const more = document.createElement("div");
      more.className = "event-chip";
      more.textContent = `+${dayEvents.length - maxVisible} weitere`;
      cell.appendChild(more);
    }

    cell.addEventListener("click", () => {
      state.selectedDate = key;
      state.currentDate = date;
      render();
    });

    calendarGridEl.appendChild(cell);
  }
}

function renderTimeGrid(viewRange, eventsByDate) {
  calendarGridEl.innerHTML = "";
  calendarGridEl.classList.remove("month", "week", "day");
  calendarGridEl.classList.add(state.viewMode);

  const wrapper = document.createElement("div");
  wrapper.className = "time-grid-wrapper";

  const axis = document.createElement("div");
  axis.className = "time-axis";

  for (let hour = DAY_START_MINUTES / 60; hour <= DAY_END_MINUTES / 60; hour++) {
    const label = document.createElement("div");
    label.className = "time-axis-label";
    label.textContent = `${pad(hour)}:00`;
    axis.appendChild(label);
  }

  const columns = document.createElement("div");
  columns.className = `time-columns ${state.viewMode}`;

  for (let i = 0; i < viewRange.cellCount; i++) {
    const date = addDays(viewRange.start, i);
    const key = toDateKey(date);
    const dayEvents = (eventsByDate.get(key) || []).slice().sort((a, b) => a.startMinutes - b.startMinutes);

    const column = document.createElement("button");
    column.type = "button";
    column.className = `time-column${state.selectedDate === key ? " selected" : ""}`;
    column.addEventListener("click", () => {
      state.selectedDate = key;
      state.currentDate = date;
      render();
    });

    dayEvents.forEach((event) => {
      const eventEl = createTimedEventElement(event);
      column.appendChild(eventEl);
    });

    columns.appendChild(column);
  }

  wrapper.append(axis, columns);
  calendarGridEl.appendChild(wrapper);
}

function createTimedEventElement(event) {
  const eventEl = document.createElement("div");
  eventEl.className = `time-event ${event.isSingle ? "single" : "recurring"}`;

  const start = Math.max(DAY_START_MINUTES, event.startMinutes ?? DAY_START_MINUTES);
  const end = Math.min(DAY_END_MINUTES, event.endMinutes ?? start + 60);
  const safeEnd = Math.max(start + 20, end);
  const range = DAY_END_MINUTES - DAY_START_MINUTES;
  const top = ((start - DAY_START_MINUTES) / range) * 100;
  const height = ((safeEnd - start) / range) * 100;

  eventEl.style.top = `${top}%`;
  eventEl.style.height = `${height}%`;

  const time = document.createElement("div");
  time.className = "time-event-time";
  time.textContent = event.timeLabel || "Zeit offen";

  const title = document.createElement("div");
  title.className = "time-event-title";
  title.textContent = event.title;

  const sport = document.createElement("div");
  sport.className = "time-event-sport";
  sport.textContent = event.sport || "";

  eventEl.append(time, title);
  if (event.sport) eventEl.appendChild(sport);

  return eventEl;
}

function renderDetails(events) {
  const selectedDate = fromDateKey(state.selectedDate);
  detailDateEl.textContent = capitalize(detailFormatter.format(selectedDate));
  detailListEl.innerHTML = "";

  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "detail-item";
    empty.textContent = "Keine Termine an diesem Tag.";
    detailListEl.appendChild(empty);
    return;
  }

  events
    .slice()
    .sort((a, b) => a.timeLabel.localeCompare(b.timeLabel, "de"))
    .forEach((event) => {
      const li = document.createElement("li");
      li.className = `detail-item ${event.isSingle ? "single" : "recurring"}`;

      const time = document.createElement("div");
      time.className = "detail-time";
      time.textContent = event.timeLabel || "Uhrzeit offen";

      const title = document.createElement("div");
      title.className = "detail-title";
      title.textContent = event.title;

      const meta = document.createElement("div");
      meta.className = "detail-meta";
      const typeLabel = event.isSingle ? "Typ: Einzeltermin" : "Typ: Serie";
      const sport = event.sport ? `Sport: ${event.sport}` : "";
      const level = event.level ? `Level: ${event.level}` : "";
      const location = event.location ? `Ort: ${event.location}` : "";
      const status = event.bookingStatus ? `Buchung: ${event.bookingStatus}` : "";
      meta.textContent = [typeLabel, sport, level, location, status].filter(Boolean).join(" | ");

      li.append(time, title, meta);

      if (event.url) {
        const link = document.createElement("a");
        link.href = event.url;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.textContent = "Zum Kurs";
        link.style.display = "inline-block";
        link.style.marginTop = "6px";
        li.appendChild(link);
      }

      detailListEl.appendChild(li);
    });
}

function filterEvents(events) {
  return events.filter((event) => {
    const meta = getEventMeta(event);
    const isSingle = deriveIsSingle(event);
    const isBookable = isBookableStatus(event.extendedProps?.bookingStatus);

    if (state.selectedSports.size && !state.selectedSports.has(meta.baseSport)) {
      return false;
    }

    if (state.selectedSports.size && state.levelFilterPrimed && meta.level && !state.selectedLevels.has(meta.level)) {
      return false;
    }

    if (state.onlySingle && !isSingle) {
      return false;
    }

    if (state.onlyBookable && !isBookable) {
      return false;
    }

    return true;
  });
}

function buildEventsByDate(events, viewStart, viewEnd) {
  const map = new Map();

  const pushEvent = (dateKey, event) => {
    if (!map.has(dateKey)) map.set(dateKey, []);
    map.get(dateKey).push(event);
  };

  for (const event of events) {
    const meta = getEventMeta(event);
    const isSingle = deriveIsSingle(event);

    if (Array.isArray(event.daysOfWeek) && event.daysOfWeek.length) {
      const startRecur = event.startRecur ? fromDateKey(event.startRecur) : viewStart;
      const endRecurExclusive = event.endRecur ? fromDateKey(event.endRecur) : addDays(viewEnd, 1);

      let cursor = new Date(Math.max(startRecur.getTime(), viewStart.getTime()));
      while (cursor <= viewEnd && cursor < endRecurExclusive) {
        const jsWeekday = cursor.getDay();
        const normalizedWeekday = jsWeekday === 0 ? 0 : jsWeekday;
        if (event.daysOfWeek.includes(normalizedWeekday)) {
          pushEvent(toDateKey(cursor), {
            title: event.title || "Kurs",
            sport: meta.baseSport,
            level: meta.level,
            isSingle,
            startMinutes: parseTimeToMinutes(event.startTime),
            endMinutes: parseTimeToMinutes(event.endTime),
            timeLabel: timeLabelFromParts(event.startTime, event.endTime),
            location: event.extendedProps?.location,
            bookingStatus: event.extendedProps?.bookingStatus,
            url: event.url,
          });
        }
        cursor = addDays(cursor, 1);
      }
      continue;
    }

    if (!event.start) continue;
    const startDate = new Date(event.start);
    if (Number.isNaN(startDate.getTime())) continue;

    const key = toDateKey(startDate);
    const inView = startDate >= viewStart && startDate <= viewEnd;
    if (!inView) continue;

    pushEvent(key, {
      title: event.title || "Kurs",
      sport: meta.baseSport,
      level: meta.level,
      isSingle,
      startMinutes: startDate.getHours() * 60 + startDate.getMinutes(),
      endMinutes: event.end
        ? new Date(event.end).getHours() * 60 + new Date(event.end).getMinutes()
        : startDate.getHours() * 60 + startDate.getMinutes() + 60,
      timeLabel: timeLabelFromDateStrings(event.start, event.end),
      location: event.extendedProps?.location,
      bookingStatus: event.extendedProps?.bookingStatus,
      url: event.url,
    });
  }

  return map;
}

function getEventMeta(event) {
  const rawSport = cleanSport(event.extendedProps?.sport) || cleanSport(event.title) || "Sport";
  const level = extractLevel(rawSport) || extractLevel(event.title) || null;
  const baseSport = stripLevel(rawSport);

  return {
    baseSport: baseSport || rawSport,
    level,
  };
}

function deriveIsSingle(event) {
  const title = String(event.title || "");
  const sourceTitle = String(event.extendedProps?.sourceTitle || "");
  const sport = String(event.extendedProps?.sport || "");
  const combined = `${title} ${sourceTitle} ${sport}`.toLowerCase();

  if (/einzeltermin|einzelbuchung|einzelterminbuchung|ein termin|single ?date/.test(combined)) {
    return true;
  }

  if (!Array.isArray(event.daysOfWeek) || !event.daysOfWeek.length) {
    return true;
  }

  return false;
}

function isBookableStatus(status) {
  const value = String(status || "").toLowerCase().trim();
  if (!value) return false;
  if (/ausgebucht|warteliste|belegt|geschlossen|ended|geschlossen/.test(value)) return false;
  if (/buchbar|buchen|anmeldung/.test(value)) return true;
  return false;
}

function extractLevel(text) {
  const value = String(text || "");
  const match = value.match(/\blevel\s*\d+(?:\s*-\s*\d+)?(?:\s*online)?\b/i);
  return match ? normalizeSpace(match[0]) : null;
}

function stripLevel(text) {
  return normalizeSpace(
    String(text || "")
      .replace(/\blevel\s*\d+(?:\s*-\s*\d+)?(?:\s*online)?\b/gi, "")
      .replace(/\(\s*\)/g, "")
  );
}

function normalizeSpace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function fuzzyScore(candidate, query) {
  const text = String(candidate || "").toLowerCase();
  const q = String(query || "").toLowerCase();
  if (!q) return 1;

  let ti = 0;
  let qi = 0;
  let score = 0;
  let consecutive = 0;

  while (ti < text.length && qi < q.length) {
    if (text[ti] === q[qi]) {
      qi += 1;
      consecutive += 1;
      score += 2 + consecutive;
    } else {
      consecutive = 0;
    }
    ti += 1;
  }

  if (qi < q.length) return 0;

  if (text.startsWith(q)) score += 12;
  if (text.includes(q)) score += 6;
  score += Math.max(0, 8 - (text.length - q.length) * 0.08);
  return score;
}

function shiftView(direction) {
  if (state.viewMode === "month") {
    state.currentDate = addMonths(state.currentDate, direction);
    state.selectedDate = toDateKey(state.currentDate);
    return;
  }

  if (state.viewMode === "week") {
    state.currentDate = addDays(state.currentDate, direction * 7);
    state.selectedDate = toDateKey(state.currentDate);
    return;
  }

  state.currentDate = addDays(state.currentDate, direction);
  state.selectedDate = toDateKey(state.currentDate);
}

function cleanSport(sport) {
  const value = normalizeSpace(sport);
  return value || null;
}

function timeLabelFromDateStrings(start, end) {
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return "";

  const startTime = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
  if (!end) return startTime;

  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return startTime;
  return `${startTime}-${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
}

function timeLabelFromParts(startTime, endTime) {
  if (startTime && endTime) return `${startTime.slice(0, 5)}-${endTime.slice(0, 5)}`;
  if (startTime) return startTime.slice(0, 5);
  return "";
}

function parseTimeToMinutes(time) {
  if (!time) return null;
  const normalized = String(time).slice(0, 5);
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date) {
  const d = stripTime(date);
  const offset = (d.getDay() + 6) % 7;
  return addDays(d, -offset);
}

function startOfCalendarGrid(monthDate) {
  const first = startOfMonth(monthDate);
  const day = first.getDay();
  const mondayBasedOffset = (day + 6) % 7;
  return addDays(first, -mondayBasedOffset);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return stripTime(next);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getIsoWeek(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function formatDate(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
