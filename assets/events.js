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

  function isPastEvent(dateStr) {
    const dt = parseDateOnly(dateStr);
    if (!dt) return false;
    const endOfDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
    return endOfDay.getTime() < Date.now();
  }

  // --- Recurrence expansion ---
  // Supported recurrence (your existing schema):
  // recurrence: {
  //   freq: "weekly" | "monthly_date" | "monthly_nth",
  //   interval: 1, // optional, default 1
  //   // weekly:
  //   byweekday: ["MO","TU","WE","TH","FR","SA","SU"],
  //   // monthly_date:
  //   bymonthday: 15,
  //   // monthly_nth:
  //   weekday: "TH",
  //   nth: 3,
  //   until: "YYYY-MM-DD"
  // }
  //
  // Anchor (recommended for correct interval behavior across months):
  // - event.start_date: "YYYY-MM-DD" (first occurrence)
  const weekdayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function clampUntilDate(untilStr) {
    if (!untilStr) return null;
    return parseDateOnly(untilStr);
  }

  function startOfMonth(year, month1to12) {
    return new Date(year, month1to12 - 1, 1, 12, 0, 0, 0);
  }

  function endOfMonth(year, month1to12) {
    return new Date(year, month1to12, 0, 12, 0, 0, 0);
  }

  function nthWeekdayOfMonth(year, monthIndex0, weekday0, nth) {
    const first = new Date(year, monthIndex0, 1, 12, 0, 0, 0);
    const firstDow = first.getDay();
    const offset = (weekday0 - firstDow + 7) % 7;
    const day = 1 + offset + (nth - 1) * 7;
    const dt = new Date(year, monthIndex0, day, 12, 0, 0, 0);
    return dt.getMonth() === monthIndex0 ? dt : null;
  }

  function monthsBetween(a, b) {
    // a, b are Date at noon
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }

  function weeksBetween(a, b) {
    // both noon, rough whole-week difference
    const ms = b.getTime() - a.getTime();
    return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
  }

  function expandRecurringEvent(baseEvent, year, monthVal) {
    const rec = baseEvent.recurrence;
    if (!rec || !rec.freq) return [];

    const interval = rec.interval && Number.isFinite(rec.interval) ? rec.interval : 1;
    const until = clampUntilDate(rec.until);

    // Anchor for interval correctness:
    const anchorStr = baseEvent.start_date || baseEvent.date || "";
    const anchor = parseDateOnly(anchorStr);

    const occurrences = [];
    const monthsToGenerate = monthVal === "all"
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : [parseInt(monthVal, 10)];

    for (const m1 of monthsToGenerate) {
      const monthStart = startOfMonth(year, m1);
      const monthEnd = endOfMonth(year, m1);
      const effectiveEnd = until && until.getTime() < monthEnd.getTime() ? until : monthEnd;

      if (rec.freq === "weekly") {
        const by = Array.isArray(rec.byweekday) ? rec.byweekday : [];
        const weekdayNums = by.map(w => weekdayMap[w]).filter(v => typeof v === "number");

        let cursor = new Date(monthStart);
        while (cursor.getTime() <= effectiveEnd.getTime()) {
          const dow = cursor.getDay();
          if (weekdayNums.includes(dow)) {
            // Interval anchored to anchor date (if provided), otherwise monthStart fallback
            const anchorForWeeks = anchor || monthStart;
            const w = weeksBetween(anchorForWeeks, cursor);
            if (w >= 0 && (w % interval === 0)) {
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

        const dt = new Date(year, m1 - 1, day, 12, 0, 0, 0);
        if (dt.getMonth() !== (m1 - 1)) continue;
        if (until && dt.getTime() > until.getTime()) continue;

        // Interval anchored to anchor date (if provided), otherwise January fallback
        if (anchor) {
          const diff = monthsBetween(anchor, dt);
          if (diff < 0 || diff % interval !== 0) continue;
        } else {
          const monthIndexInYear = m1 - 1;
          if (monthIndexInYear % interval !== 0) continue;
        }

        const iso = `${year}-${String(m1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        occurrences.push(makeOccurrence(baseEvent, iso));
      }

      if (rec.freq === "monthly_nth") {
        const weekday0 = weekdayMap[rec.weekday];
        const nth = parseInt(rec.nth, 10);
        if (typeof weekday0 !== "number" || !Number.isFinite(nth) || nth < 1 || nth > 5) continue;

        const dt = nthWeekdayOfMonth(year, m1 - 1, weekday0, nth);
        if (!dt) continue;
        if (until && dt.getTime() > until.getTime()) continue;

        // Interval anchored to anchor date (if provided)
        if (anchor) {
          const diff = monthsBetween(anchor, dt);
          if (diff < 0 || diff % interval !== 0) continue;
        } else {
          const monthIndexInYear = m1 - 1;
          if (monthIndexInYear % interval !== 0) continue;
        }

        const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        occurrences.push(makeOccurrence(baseEvent, iso));
      }
    }

    return occurrences;
  }

  function makeOccurrence(baseEvent, dateISO) {
    return {
      ...baseEvent,
      date: dateISO,
      _occurrence: true
    };
  }

  // --- Calendar links ---
  function parseTimeHM(hm) {
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
      details,
      location,
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
    return {
      url,
      filename: `event-${(ev.name || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${ev.date}.ics`
    };
  }

  function matchesFilters(ev, q, monthVal, yearVal, showPast) {
    if (!showPast && ev.date && isPastEvent(ev.date)) return false;

    const m = getMonthFromDateStr(ev.date);
    const y = getYearFromDateStr(ev.date);

    if (yearVal !== "all") {
      if (!y || String(y) !== yearVal) return false;
    }

    if (monthVal !== "all") {
      if (!m || String(m) !== monthVal) return false;
    }

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

      if (ev.date) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Date:</strong> ${escapeHtml(formatDate(ev.date))}`;
        details.appendChild(p);
      }

      if (ev.time) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Time:</strong> ${escapeHtml(ev.time)}`;
        details.appendChild(p);
      }

      if (ev.location) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Location:</strong> ${escapeHtml(ev.location)}`;
        details.appendChild(p);
      }

      if (ev.website) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Website:</strong> <a href="${escapeAttr(ev.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.website)}</a>`;
        details.appendChild(p);
      }

      if (ev.tickets) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Tickets:</strong> <a href="${escapeAttr(ev.tickets)}" target="_blank" rel="noopener noreferrer">Purchase / Info</a>`;
        details.appendChild(p);
      }

      // Calendar links
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

      if (ev.description) {
        const desc = document.createElement("p");
        desc.className = "muted";
        desc.textContent = ev.description;
        details.appendChild(desc);
      }

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

  // --- Auto-populate YEAR dropdown based on data ---
  (function populateYearOptions() {
    const nowY = new Date().getFullYear();
    let minY = nowY;
    let maxY = nowY;

    for (const ev of raw) {
      const d = parseDateOnly(ev.date);
      if (d) {
        minY = Math.min(minY, d.getFullYear());
        maxY = Math.max(maxY, d.getFullYear());
      }

      const anchor = parseDateOnly(ev.start_date || "");
      if (anchor) {
        minY = Math.min(minY, anchor.getFullYear());
        maxY = Math.max(maxY, anchor.getFullYear());
      }

      const until = clampUntilDate(ev.recurrence && ev.recurrence.until);
      if (until) {
        minY = Math.min(minY, until.getFullYear());
        maxY = Math.max(maxY, until.getFullYear());
      }
    }

    // Keep within a sane band (prevents weird typos from exploding the dropdown)
    minY = Math.max(minY, nowY - 1);
    maxY = Math.min(maxY, nowY + 5);

    const existingAll = [...yearEl.options].some(o => o.value === "all");
    yearEl.innerHTML = "";
    if (!existingAll) {
      const opt = document.createElement("option");
      opt.value = "all";
      opt.textContent = "All";
      yearEl.appendChild(opt);
    } else {
      const opt = document.createElement("option");
      opt.value = "all";
      opt.textContent = "All";
      yearEl.appendChild(opt);
    }

    for (let y = minY; y <= maxY; y++) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      yearEl.appendChild(opt);
    }
  })();

  function buildExpandedList(yearVal, monthVal) {
    const expanded = [];
    const yearToUse = yearVal === "all" ? String(new Date().getFullYear()) : yearVal;
    const y = parseInt(yearToUse, 10);

    for (const ev of raw) {
      if (ev.date) expanded.push(ev);
      if (ev.recurrence && y) {
        expanded.push(...expandRecurringEvent(ev, y, monthVal));
      }
    }

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
    const currentMonth = String(now.getMonth() + 1);
    const currentYear = String(now.getFullYear());

    if ([...monthEl.options].some(o => o.value === currentMonth)) monthEl.value = currentMonth;
    if ([...yearEl.options].some(o => o.value === currentYear)) yearEl.value = currentYear;
  })();

  // Default: hide past
  if (showPastEl) showPastEl.checked = false;

  function update() {
    const q = normalize(qEl.value);
    const monthVal = monthEl.value;
    const yearVal = yearEl.value;
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
