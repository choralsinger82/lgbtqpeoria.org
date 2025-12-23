(async function () {
  const resultsEl = document.getElementById("results");
  const qEl = document.getElementById("q");
  const monthEl = document.getElementById("month");
  const yearEl = document.getElementById("year");
  const showPastEl = document.getElementById("showPast");
  const countEl = document.getElementById("count");

  if (!resultsEl || !qEl || !monthEl || !yearEl || !countEl) return;

  function normalize(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(str) {
    return (str || "").toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(str) {
    return (str || "").toString().replaceAll('"', "%22");
  }

  // --- Date helpers (date-only, local noon to avoid timezone edge cases) ---
  function parseDateOnly(dateStr) {
    // "YYYY-MM-DD"
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const dt = new Date(y, mo, d, 12, 0, 0, 0);
    return isNaN(dt) ? null : dt;
  }

  function formatDate(dateStr) {
    const dt = parseDateOnly(dateStr);
    if (!dt) return "";
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    return fmt.format(dt);
  }

  function getMonthFromDateStr(dateStr) {
    const dt = parseDateOnly(dateStr);
    return dt ? dt.getMonth() + 1 : null; // 1-12
  }

  function getYearFromDateStr(dateStr) {
    const dt = parseDateOnly(dateStr);
    return dt ? dt.getFullYear() : null;
  }

  // Past check: compares end-of-day local time
  function isPastEvent(dateStr) {
    const dt = parseDateOnly(dateStr);
    if (!dt) return false;
    // End of that day in local time:
    const endOfDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
    return endOfDay.getTime() < Date.now();
  }

  // --- Recurrence expansion ---
  // Supported recurrence:
  // recurrence: {
  //   freq: "weekly" | "monthly_date" | "monthly_nth",
  //   interval: 1, // optional, default 1
  //   // weekly:
  //   byweekday: ["MO","TU","WE","TH","FR","SA","SU"], // required for weekly
  //   // monthly_date:
  //   bymonthday: 15, // day-of-month number
  //   // monthly_nth:
  //   weekday: "TH",  // weekday code
  //   nth: 3,         // 1-5 (5 = last-ish if month has it)
  //   until: "YYYY-MM-DD" // optional end date
  // }
  const weekdayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function clampUntilDate(untilStr) {
    if (!untilStr) return null;
    return parseDateOnly(untilStr);
  }

  function startOfMonth(year, month1to12) {
    return new Date(year, month1to12 - 1, 1, 12, 0, 0, 0);
  }

  function endOfMonth(year, month1to12) {
    return new Date(year, month1to12, 0, 12, 0, 0, 0); // day 0 of next month
  }

  function nthWeekdayOfMonth(year, monthIndex0, weekday0, nth) {
    // nth: 1..5
    const first = new Date(year, monthIndex0, 1, 12, 0, 0, 0);
    const firstDow = first.getDay();
    const offset = (weekday0 - firstDow + 7) % 7;
    const day = 1 + offset + (nth - 1) * 7;
    const dt = new Date(year, monthIndex0, day, 12, 0, 0, 0);
    // Validate still in same month
    return dt.getMonth() === monthIndex0 ? dt : null;
  }

  function expandRecurringEvent(baseEvent, year, monthVal) {
    // monthVal can be "all" or "1..12"
    const rec = baseEvent.recurrence;
    if (!rec || !rec.freq) return [];

    const interval = rec.interval && Number.isFinite(rec.interval) ? rec.interval : 1;
    const until = clampUntilDate(rec.until);
    const occurrences = [];

    // If month is "all", we generate only for the whole selected year (12 months)
    const monthsToGenerate = monthVal === "all"
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : [parseInt(monthVal, 10)];

    for (const m1 of monthsToGenerate) {
      const monthStart = startOfMonth(year, m1);
      const monthEnd = endOfMonth(year, m1);

      // Apply until limit
      const effectiveEnd = until && until.getTime() < monthEnd.getTime() ? until : monthEnd;

      if (rec.freq === "weekly") {
        const by = Array.isArray(rec.byweekday) ? rec.byweekday : [];
        const weekdayNums = by.map(w => weekdayMap[w]).filter(v => typeof v === "number");

        // Start from the first day of the month
        let cursor = new Date(monthStart);
        // Walk day by day
        while (cursor.getTime() <= effectiveEnd.getTime()) {
          const dow = cursor.getDay();
          if (weekdayNums.includes(dow)) {
            // interval support: count weeks from monthStart (rough + simple)
            // If interval > 1, we only include weeks where weekIndex % interval === 0
            const weekIndex = Math.floor((cursor.getTime() - monthStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
            if (weekIndex % interval === 0) {
              const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
              occurrences.push(makeOccurrence(baseEvent, iso));
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      if (rec.freq === "monthly_date") {
        const day = parseInt(rec.bymonthday, 10);
        if (!Number.isFinite(day) || day < 1 || day > 31) continue;

        // interval support: skip months not matching interval based on January index
        const monthIndexInYear = m1 - 1;
        if (monthIndexInYear % interval !== 0) continue;

        const dt = new Date(year, m1 - 1, day, 12, 0, 0, 0);
        if (dt.getMonth() !== (m1 - 1)) continue; // invalid day for that month
        if (until && dt.getTime() > until.getTime()) continue;

        const iso = `${year}-${String(m1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        occurrences.push(makeOccurrence(baseEvent, iso));
      }

      if (rec.freq === "monthly_nth") {
        const weekday0 = weekdayMap[rec.weekday];
        const nth = parseInt(rec.nth, 10);
        if (typeof weekday0 !== "number" || !Number.isFinite(nth) || nth < 1 || nth > 5) continue;

        const monthIndexInYear = m1 - 1;
        if (monthIndexInYear % interval !== 0) continue;

        const dt = nthWeekdayOfMonth(year, m1 - 1, weekday0, nth);
        if (!dt) continue;
        if (until && dt.getTime() > until.getTime()) continue;

        const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        occurrences.push(makeOccurrence(baseEvent, iso));
      }
    }

    return occurrences;
  }

  function makeOccurrence(baseEvent, dateISO) {
    // Clone + override date; allow per-occurrence title tweaks later if needed
    return {
      ...baseEvent,
      date: dateISO,
      _occurrence: true
    };
  }

  // --- Calendar links ---
  // Requires:
  //  - date (YYYY-MM-DD)
  //  - time_start (HH:MM, 24h) optional
  //  - time_end (HH:MM, 24h) optional
  // If time_start missing, we won’t show calendar links.
  function parseTimeHM(hm) {
    // "HH:MM"
    if (!hm) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return { h, mi };
  }

  function toICSDateTimeUTC(dateStr, timeHM) {
    const d = parseDateOnly(dateStr);
    const t = parseTimeHM(timeHM);
    if (!d || !t) return null;
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.mi, 0, 0);
    // Convert to UTC format YYYYMMDDTHHMMSSZ
    const yyyy = local.getUTCFullYear();
    const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(local.getUTCDate()).padStart(2, "0");
    const HH = String(local.getUTCHours()).padStart(2, "0");
    const MM = String(local.getUTCMinutes()).padStart(2, "0");
    const SS = "00";
    return `${yyyy}${mm}${dd}T${HH}${MM}${SS}Z`;
  }

  function buildGoogleCalendarUrl(ev) {
    const title = ev.name || "Event";
    const details = ev.description || "";
    const location = ev.location || "";
    const startUTC = toICSDateTimeUTC(ev.date, ev.time_start);
    if (!startUTC) return "";

    // If no end, default to +60 minutes
    let endUTC = "";
    if (ev.time_end) {
      endUTC = toICSDateTimeUTC(ev.date, ev.time_end);
    } else {
      const d = parseDateOnly(ev.date);
      const t = parseTimeHM(ev.time_start);
      const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.mi, 0, 0);
      local.setMinutes(local.getMinutes() + 60);
      const yyyy = local.getUTCFullYear();
      const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(local.getUTCDate()).padStart(2, "0");
      const HH = String(local.getUTCHours()).padStart(2, "0");
      const MM = String(local.getUTCMinutes()).padStart(2, "0");
      endUTC = `${yyyy}${mm}${dd}T${HH}${MM}00Z`;
    }

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      details: details,
      location: location,
      dates: `${startUTC}/${endUTC}`
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function buildICSContent(ev) {
    const title = (ev.name || "Event").replace(/\r?\n/g, " ");
    const desc = (ev.description || "").replace(/\r?\n/g, "\\n");
    const location = (ev.location || "").replace(/\r?\n/g, " ");
    const url = ev.website || "";

    const dtStart = toICSDateTimeUTC(ev.date, ev.time_start);
    if (!dtStart) return "";

    let dtEnd = "";
    if (ev.time_end) {
      dtEnd = toICSDateTimeUTC(ev.date, ev.time_end);
    } else {
      // default +60 min
      const d = parseDateOnly(ev.date);
      const t = parseTimeHM(ev.time_start);
      const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.mi, 0, 0);
      local.setMinutes(local.getMinutes() + 60);
      const yyyy = local.getUTCFullYear();
      const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(local.getUTCDate()).padStart(2, "0");
      const HH = String(local.getUTCHours()).padStart(2, "0");
      const MM = String(local.getUTCMinutes()).padStart(2, "0");
      dtEnd = `${yyyy}${mm}${dd}T${HH}${MM}00Z`;
    }

    const uid = `${normalize(title).slice(0, 30)}-${ev.date}-${Math.random().toString(16).slice(2)}@lgbtqpeoria.org`;
    const now = new Date();
    const dtStamp =
      `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}T` +
      `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}00Z`;

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//LGBTQ Peoria//Events//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${title}`,
      location ? `LOCATION:${location}` : "",
      desc ? `DESCRIPTION:${desc}` : "",
      url ? `URL:${url}` : "",
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean).join("\r\n");
  }

  function makeICSDownloadLink(ev) {
    const ics = buildICSContent(ev);
    if (!ics) return null;
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    return { url, filename: `event-${(ev.name || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${ev.date}.ics` };
  }

  function matchesFilters(ev, q, monthVal, yearVal, showPast) {
    // Hide past by default
    if (!showPast && ev.date && isPastEvent(ev.date)) return false;

    // Month/year filters
    const m = getMonthFromDateStr(ev.date);
    const y = getYearFromDateStr(ev.date);

    if (yearVal !== "all") {
      if (!y || String(y) !== yearVal) return false;
    }

    if (monthVal !== "all") {
      if (!m || String(m) !== monthVal) return false;
    }

    // Search
    if (!q) return true;

    const hay = normalize([
      ev.name,
      ev.date,
      ev.time,
      ev.location,
      ev.description,
      (ev.tags || []).join(" "),
      ev.website,
      ev.tickets
    ].join(" "));

    return hay.includes(q);
  }

  function render(items) {
    resultsEl.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `
        <h2>No matches</h2>
        <p class="muted">Try a different search term or adjust month/year.</p>
      `;
      resultsEl.appendChild(empty);
      return;
    }

    for (const ev of items) {
      const card = document.createElement("article");
      card.className = "card listing";

      const top = document.createElement("div");
      top.className = "listing-top";

      const title = document.createElement("h2");
      title.className = "listing-title";
      title.textContent = ev.name || "Untitled event";

      const meta = document.createElement("div");
      meta.className = "listing-meta";

      top.appendChild(title);
      top.appendChild(meta);

      const details = document.createElement("div");
      details.className = "listing-details";

      // Date (separate)
      if (ev.date) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Date:</strong> ${escapeHtml(formatDate(ev.date))}`;
        details.appendChild(p);
      }

      // Time (separate)
      if (ev.time) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Time:</strong> ${escapeHtml(ev.time)}`;
        details.appendChild(p);
      }

      // Location (separate)
      if (ev.location) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Location:</strong> ${escapeHtml(ev.location)}`;
        details.appendChild(p);
      }

      // Website
      if (ev.website) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Website:</strong> <a href="${escapeAttr(ev.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.website)}</a>`;
        details.appendChild(p);
      }

      // Tickets
      if (ev.tickets) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Tickets:</strong> <a href="${escapeAttr(ev.tickets)}" target="_blank" rel="noopener noreferrer">Purchase / Info</a>`;
        details.appendChild(p);
      }

      // Add-to-calendar links (only if time_start exists)
      if (ev.time_start) {
        const calRow = document.createElement("p");
        const gcal = buildGoogleCalendarUrl(ev);
        const ics = makeICSDownloadLink(ev);

        const links = [];
        if (gcal) links.push(`<a href="${escapeAttr(gcal)}" target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>`);
        if (ics) links.push(`<a href="${escapeAttr(ics.url)}" download="${escapeAttr(ics.filename)}">Download .ics</a>`);

        if (links.length) {
          calRow.innerHTML = `<strong>Calendar:</strong> ${links.join(" • ")}`;
          details.appendChild(calRow);
        }
      }

      // Description
      if (ev.description) {
        const desc = document.createElement("p");
        desc.className = "muted";
        desc.textContent = ev.description;
        details.appendChild(desc);
      }

      // Tags
      if (ev.tags && ev.tags.length) {
        const tagWrap = document.createElement("div");
        tagWrap.className = "tag-row";

        for (const t of ev.tags) {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = t;

          if (t.endsWith("-owned")) tag.dataset.owner = "true";

          tagWrap.appendChild(tag);
        }

        details.appendChild(tagWrap);
      }

      card.appendChild(top);
      card.appendChild(details);
      resultsEl.appendChild(card);
    }
  }

  let raw = [];
  try {
    const res = await fetch("assets/events.json", { cache: "no-store" });
    raw = await res.json();
  } catch (e) {
    countEl.textContent = "Could not load events.";
    resultsEl.innerHTML = `<div class="card"><h2>Error</h2><p class="muted">Events could not be loaded.</p></div>`;
    return;
  }

  // Expand recurrence into occurrences for the selected year/month
  function buildExpandedList(yearVal, monthVal) {
    const expanded = [];

    for (const ev of raw) {
      // Base one-time event
      if (ev.date) expanded.push(ev);

      // Expand recurring events ONLY when a year is selected
      // If year is "all", we’ll still expand for the current year to avoid dumping huge lists.
      const yearToUse = yearVal === "all" ? String(new Date().getFullYear()) : yearVal;
      const y = parseInt(yearToUse, 10);

      if (ev.recurrence && y) {
        expanded.push(...expandRecurringEvent(ev, y, monthVal));
      }
    }

    // Sort by date (soonest first)
    expanded.sort((a, b) => {
      const da = parseDateOnly(a.date);
      const db = parseDateOnly(b.date);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });

    return expanded;
  }

  // Default month/year to current if options exist
  (function setDefaultMonthYear() {
    const now = new Date();
    const currentMonth = String(now.getMonth() + 1); // 1-12
    const currentYear = String(now.getFullYear());

    if ([...monthEl.options].some(o => o.value === currentMonth)) monthEl.value = currentMonth;
    if ([...yearEl.options].some(o => o.value === currentYear)) yearEl.value = currentYear;
  })();

  // Default: hide past
  if (showPastEl) showPastEl.checked = false;

  function update() {
    const q = normalize(qEl.value);
    const monthVal = monthEl.value; // "all" or "1".."12"
    const yearVal = yearEl.value;   // "all" or "2025" etc
    const showPast = showPastEl ? !!showPastEl.checked : false;

    const all = buildExpandedList(yearVal, monthVal);

    const filtered = all.filter(ev => matchesFilters(ev, q, monthVal, yearVal, showPast));
    countEl.textContent = `${filtered.length} event${filtered.length === 1 ? "" : "s"} shown`;
    render(filtered);
  }

  qEl.addEventListener("input", update);
  monthEl.addEventListener("change", update);
  yearEl.addEventListener("change", update);
  if (showPastEl) showPastEl.addEventListener("change", update);

  update();
})();
