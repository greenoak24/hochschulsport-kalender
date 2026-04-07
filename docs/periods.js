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
const DAY_EVENT_CARD_WIDTH = 180;
const DAY_EVENT_CARD_GAP = 10;
const DAY_EVENT_LABEL_GUTTER = 54;

const state = {
  currentFakeWeekday: 0, // 0=Mo, 6=So
  periodMode: 1, // 1 oder 2
  viewMode: "week",
  events: [],
  allSports: [],
  selectedSports: new Set(),
  selectedLevels: new Set(),
  levelFilterPrimed: false,
  onlyBookable: false,
  onlySingle: false,
  onlyFree: false,
  periodAktuell: false,
  periodSommer: true,
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
const dayNavGroupEl = document.getElementById("dayNavGroup");
const periodGroupEl = document.getElementById("periodGroup");
const bookableOnlyEl = document.getElementById("bookableOnly");
const singleOnlyEl = document.getElementById("singleOnly");
const freeOnlyEl = document.getElementById("freeOnly");
const levelFilterContainerEl = document.getElementById("levelFilterContainer");
const viewButtons = Array.from(document.querySelectorAll(".view-btn"));
const periodButtons = Array.from(document.querySelectorAll(".period-btn"));

document.getElementById("prevDay")?.addEventListener("click", () => {
  state.currentFakeWeekday--;
  if (state.currentFakeWeekday < 0) state.currentFakeWeekday = 6;
  render();
});

document.getElementById("nextDay")?.addEventListener("click", () => {
  state.currentFakeWeekday++;
  if (state.currentFakeWeekday > 6) state.currentFakeWeekday = 0;
  render();
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextView = button.dataset.view;
    if (!nextView || state.viewMode === nextView) return;
    state.viewMode = nextView;
    render();
  });
});

periodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const p = parseInt(button.dataset.period, 10);
    if (state.periodMode === p) return;
    state.periodMode = p;
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
  state.onlyFree = false;
  bookableOnlyEl.checked = false;
  singleOnlyEl.checked = false;
  freeOnlyEl.checked = false;
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

freeOnlyEl.addEventListener("change", () => {
  state.onlyFree = freeOnlyEl.checked;
  render();
});

document.getElementById("periodAktuell").addEventListener("change", (e) => {
  if (e.target.checked) {
    state.periodAktuell = true;
    state.periodSommer = false;
    render();
  }
});

document.getElementById("periodSommer").addEventListener("change", (e) => {
  if (e.target.checked) {
    state.periodSommer = true;
    state.periodAktuell = false;
    render();
  }
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
  state.semesterBounds = payload.semesterBounds || {};
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
  const isSearchActive = document.activeElement === sportSearchEl;
  const hasSearchText = Boolean(state.sportSearch);

  if (!isSearchActive && !hasSearchText) {
    sportSuggestionBoxEl.classList.remove("visible");
    sportSuggestionBoxEl.innerHTML = "";
    return;
  }

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

  const filteredEvents = filterEvents(state.events);
  const eventsByDate = buildEventsByDate(filteredEvents);

  renderHeader();
  renderWeekdayHeader();
  renderGrid(eventsByDate);

  const selectedIdx = state.viewMode === "week" ? 0 : state.currentFakeWeekday;
  const selectedEvents = eventsByDate.get(selectedIdx) || [];
  renderDetails(selectedEvents);
}

function updateViewButtons() {
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.viewMode);
  });
  
  const getBoundsString = (p) => {
    const pKey = `p${p}`;
    let sems = [];
    if (state.semesterBounds) {
      if (state.periodSommer && state.semesterBounds["Sommersemester"]) {
        sems.push(state.semesterBounds["Sommersemester"][pKey]);
      }
      if (state.periodAktuell && state.semesterBounds["aktueller_zeitraum"]) {
        sems.push(state.semesterBounds["aktueller_zeitraum"][pKey]);
      }
    }
    if (!sems.length) return "";
    
    const fmt = (ymd) => {
      if (!ymd || ymd === 99999999 || ymd === 0) return "";
      const s = String(ymd);
      return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
    };
    
    const bStrings = sems.map(b => `${fmt(b.start)} - ${fmt(b.end)}`);
    return ` (${bStrings.join(" | ")})`;
  };

  periodButtons.forEach((button) => {
    const p = parseInt(button.dataset.period, 10);
    button.classList.toggle("active", p === state.periodMode);
    button.textContent = `${p}. Zeitraum${getBoundsString(p)}`;
  });
}

function renderHeader() {
  if (state.viewMode === "week") {
    monthLabelEl.textContent = `Wochenübersicht`;
    if (dayNavGroupEl) dayNavGroupEl.style.display = "none";
  } else {
    monthLabelEl.textContent = `${weekdayNames[state.currentFakeWeekday]}`;
    if (dayNavGroupEl) dayNavGroupEl.style.display = "flex";
  }
}

function renderWeekdayHeader() {
  weekdayRowEl.innerHTML = "";
  if (state.viewMode === "day") {
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = weekdayNames[state.currentFakeWeekday];
    weekdayRowEl.style.gridTemplateColumns = "minmax(0, 1fr)";
    weekdayRowEl.appendChild(el);
  } else {
    weekdayRowEl.style.gridTemplateColumns = "repeat(7, minmax(0, 1fr))";
    weekdayNames.forEach((name) => {
      const el = document.createElement("div");
      el.className = "weekday";
      el.textContent = name;
      weekdayRowEl.appendChild(el);
    });
  }
}

function renderGrid(eventsByDate) {
  renderTimeGrid(eventsByDate);
}

function renderTimeGrid(eventsByDate) {
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

  if (state.viewMode === "day") {
    wrapper.classList.add("day-scroll");
    columns.classList.add("day-scroll-track");
  }

  const daysToRender = state.viewMode === "week" ? [0, 1, 2, 3, 4, 5, 6] : [state.currentFakeWeekday];

  for (const dayIdx of daysToRender) {
    const dayEvents = (eventsByDate.get(dayIdx) || []).slice().sort((a, b) => a.startMinutes - b.startMinutes);

    const column = document.createElement("button");
    column.type = "button";
    column.className = `time-column${state.currentFakeWeekday === dayIdx ? " selected" : ""}`;

    const hasLineLabels = state.viewMode === "day";

    if (hasLineLabels) {
      column.classList.add("with-line-labels");
      appendLineTimeLabels(column);
    }

    column.addEventListener("click", () => {
      if (state.viewMode === "week") {
        state.currentFakeWeekday = dayIdx;
        state.viewMode = "day";
        render();
        return;
      }
    });

    const dayLayout = state.viewMode === "day" ? buildDayEventLayout(dayEvents) : null;
    const dayLaneCount = dayLayout
      ? Math.max(1, dayLayout.reduce((max, item) => Math.max(max, item.columnCount), 1))
      : 1;

    if (state.viewMode === "day") {
      column.classList.add("day-scroll-column");
      const dayColumnWidth = DAY_EVENT_LABEL_GUTTER
        + dayLaneCount * DAY_EVENT_CARD_WIDTH
        + Math.max(0, dayLaneCount - 1) * DAY_EVENT_CARD_GAP
        + 12;
      column.style.minWidth = `${dayColumnWidth}px`;
    }

    dayEvents.forEach((event, index) => {
      const eventEl = createTimedEventElement(
        event,
        dayLayout ? dayLayout[index] : null,
        hasLineLabels,
        {
          fixedWidth: state.viewMode === "day",
          laneWidth: DAY_EVENT_CARD_WIDTH,
          laneGap: DAY_EVENT_CARD_GAP,
          labelGutter: DAY_EVENT_LABEL_GUTTER,
        }
      );
      column.appendChild(eventEl);
    });

    columns.appendChild(column);
  }

  wrapper.append(axis, columns);
  calendarGridEl.appendChild(wrapper);
}

function createTimedEventElement(event, layout = null, hasLineLabels = false, options = {}) {
  const eventEl = document.createElement("div");
  eventEl.className = `time-event ${event.isSingle ? "single" : "recurring"}`;

  const start = Math.max(DAY_START_MINUTES, event.startMinutes ?? DAY_START_MINUTES);
  const end = Math.min(DAY_END_MINUTES, event.endMinutes ?? start + 60);
  const safeEnd = Math.max(start + 20, end);
  const range = DAY_END_MINUTES - DAY_START_MINUTES;
  const top = ((start - DAY_START_MINUTES) / range) * 100;
  const height = ((safeEnd - start) / range) * 100;
  const leftInset = hasLineLabels ? (options.labelGutter ?? DAY_EVENT_LABEL_GUTTER) : 6;
  const widthInset = hasLineLabels ? 58 : 10;

  eventEl.style.top = `${top}%`;
  eventEl.style.height = `${height}%`;
  eventEl.style.left = `${leftInset}px`;
  eventEl.style.right = "6px";

  if (options.fixedWidth) {
    const laneWidth = options.laneWidth ?? DAY_EVENT_CARD_WIDTH;
    const laneGap = options.laneGap ?? DAY_EVENT_CARD_GAP;
    const laneIndex = layout ? layout.columnIndex : 0;
    const leftPx = leftInset + laneIndex * (laneWidth + laneGap);

    eventEl.style.left = `${leftPx}px`;
    eventEl.style.width = `${laneWidth}px`;
    eventEl.style.right = "auto";
    eventEl.style.zIndex = String(10 + laneIndex);
  } else if (layout && layout.columnCount > 1) {
    const widthPerColumn = 100 / layout.columnCount;
    const leftPercent = layout.columnIndex * widthPerColumn;

    eventEl.style.left = `calc(${leftPercent}% + ${leftInset}px)`;
    eventEl.style.width = `calc(${widthPerColumn}% - ${widthInset}px)`;
    eventEl.style.right = "auto";
    eventEl.style.zIndex = String(10 + layout.columnIndex);
  }

  const title = document.createElement("div");
  title.className = "time-event-title";
  title.textContent = event.title;

  const sport = document.createElement("div");
  sport.className = "time-event-sport";
  sport.textContent = event.sport || "";

  eventEl.append(title);
  if (event.sport) eventEl.appendChild(sport);

  return eventEl;
}

function appendLineTimeLabels(column) {
  const range = DAY_END_MINUTES - DAY_START_MINUTES;

  for (let hour = DAY_START_MINUTES / 60; hour <= DAY_END_MINUTES / 60; hour++) {
    const marker = document.createElement("span");
    marker.className = "time-line-label";
    marker.textContent = `${pad(hour)}:00`;
    marker.style.top = `${((hour * 60 - DAY_START_MINUTES) / range) * 100}%`;
    column.appendChild(marker);
  }
}

function buildDayEventLayout(events) {
  if (!events.length) return [];

  const assignments = events.map((event, originalIndex) => {
    const start = Math.max(DAY_START_MINUTES, event.startMinutes ?? DAY_START_MINUTES);
    const end = Math.min(DAY_END_MINUTES, event.endMinutes ?? start + 60);
    const safeEnd = Math.max(start + 20, end);

    return {
      originalIndex,
      start,
      end: safeEnd,
      columnIndex: 0,
      columnCount: 1,
    };
  });

  const sorted = assignments.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });

  const activeColumnsEnd = [];
  sorted.forEach((item) => {
    let assignedColumn = activeColumnsEnd.findIndex((columnEnd) => columnEnd <= item.start);
    if (assignedColumn === -1) {
      assignedColumn = activeColumnsEnd.length;
      activeColumnsEnd.push(item.end);
    } else {
      activeColumnsEnd[assignedColumn] = item.end;
    }

    item.columnIndex = assignedColumn;
  });

  let groupStart = 0;
  let groupEnd = sorted[0].end;

  for (let i = 1; i <= sorted.length; i++) {
    const item = sorted[i];
    const startsNewGroup = !item || item.start >= groupEnd;

    if (!startsNewGroup) {
      groupEnd = Math.max(groupEnd, item.end);
      continue;
    }

    const group = sorted.slice(groupStart, i);
    const columnCount = group.reduce((max, entry) => Math.max(max, entry.columnIndex + 1), 1);
    group.forEach((entry) => {
      entry.columnCount = columnCount;
    });

    if (item) {
      groupStart = i;
      groupEnd = item.end;
    }
  }

  const layout = new Array(events.length);
  sorted.forEach((entry) => {
    layout[entry.originalIndex] = {
      columnIndex: entry.columnIndex,
      columnCount: entry.columnCount,
    };
  });

  return layout;
}

function renderDetails(events) {
  const selectedIdx = state.viewMode === "week" ? 0 : state.currentFakeWeekday;
  detailDateEl.textContent = state.viewMode === "week" ? "Alle Wochentage" : weekdayNames[selectedIdx];
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
      const courseId = event.courseId ? `ID: ${event.courseId}` : "";
      meta.textContent = [typeLabel, sport, level, location, status, courseId].filter(Boolean).join(" | ");

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
    const isFree = (event.extendedProps?.price || "").toLowerCase().includes("entgeltfrei");

    if (state.selectedSports.size && !state.selectedSports.has(meta.baseSport)) {
      return false;
    }

    if (state.selectedSports.size && state.levelFilterPrimed && meta.level && !state.selectedLevels.has(meta.level)) {
      return false;
    }

    if (state.onlySingle && !isSingle) {
      return false;
    }

    if (state.onlyFree && !isFree) {
      return false;
    }

    if (state.onlyBookable && !isBookable) {
      return false;
    }

    if (!state.periodSommer && meta.semester === "Sommersemester") {
      return false;
    }

    if (!state.periodAktuell && meta.semester === "aktueller_zeitraum") {
      return false;
    }

    const { period1, period2 } = event.extendedProps || {};
    if (state.periodMode === 1 && !period1) return false;
    if (state.periodMode === 2 && !period2) return false;

    return true;
  });
}

function buildEventsByDate(events) {
  const map = new Map();
  const seenKeys = new Set();

  const pushEvent = (dayIdx, event) => {
    const key = `${dayIdx}-${event.sport}-${event.level || ""}-${event.startMinutes}-${event.endMinutes}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    
    if (!map.has(dayIdx)) map.set(dayIdx, []);
    map.get(dayIdx).push(event);
  };

  for (const event of events) {
    const meta = getEventMeta(event);
    const isSingle = deriveIsSingle(event);

    const pushToFakeDay = (jsWeekday, startMin, endMin, timeLabel) => {
      // jsWeekday: 0=Sun, 1=Mon ... 6=Sat -> dayIdx: 0=Mo, 6=So
      let dayIdx = jsWeekday === 0 ? 6 : jsWeekday - 1; 
      pushEvent(dayIdx, {
        title: event.title || "Kurs",
        sport: meta.baseSport,
        level: meta.level,
        isSingle,
        startMinutes: startMin,
        endMinutes: endMin,
        timeLabel,
        location: event.extendedProps?.location,
        bookingStatus: event.extendedProps?.bookingStatus,
        url: event.url,
        courseId: event.extendedProps?.courseId,
      });
    };

    if (Array.isArray(event.daysOfWeek) && event.daysOfWeek.length) {
      event.daysOfWeek.forEach(wd => {
        pushToFakeDay(wd, parseTimeToMinutes(event.startTime), parseTimeToMinutes(event.endTime), timeLabelFromParts(event.startTime, event.endTime));
      });
      continue;
    }

    if (event.start) {
      const startDate = new Date(event.start);
      if (Number.isNaN(startDate.getTime())) continue;
      const wd = startDate.getDay();
      const sm = startDate.getHours() * 60 + startDate.getMinutes();
      const em = event.end ? new Date(event.end).getHours() * 60 + new Date(event.end).getMinutes() : sm + 60;
      pushToFakeDay(wd, sm, em, timeLabelFromDateStrings(event.start, event.end));
    }
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
  if (/ausgebucht|warteliste|belegt|geschlossen|ended/.test(value)) return false;
  if (/buchbar|buchen|anmeldung|freigeschalt|offen|ab \d{2}\.\d{2}/.test(value)) return true;
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
