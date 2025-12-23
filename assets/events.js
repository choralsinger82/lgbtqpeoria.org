(async function () {
  const resultsEl = document.getElementById("results");
  const qEl = document.getElementById("q");
  const monthEl = document.getElementById("month");
  const yearEl = document.getElementById("year");
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

  function parseDateOnly(dateStr) {
    // Expecting "YYYY-MM-DD"
    // Build a local Date at noon to avoid timezone edge cases around midnight.
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

  function matchesFilters(ev, q, monthVal, yearVal) {
    // Month / year filters
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

      // Right-side meta row (we’ll keep it minimal like directory)
      const meta = document.createElement("div");
      meta.className = "listing-meta";

      top.appendChild(title);
      top.appendChild(meta);

      const details = document.createElement("div");
      details.className = "listing-details";

      // Date (separate line)
      if (ev.date) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Date:</strong> ${escapeHtml(formatDate(ev.date))}`;
        details.appendChild(p);
      }

      // Time (separate line)
      if (ev.time) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Time:</strong> ${escapeHtml(ev.time)}`;
        details.appendChild(p);
      }

      // Location (separate line)
      if (ev.location) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Location:</strong> ${escapeHtml(ev.location)}`;
        details.appendChild(p);
      }

      // Website
      if (ev.website) {
        const p = document.createElement("p");
        const url = escapeAttr(ev.website);
        p.innerHTML = `<strong>Website:</strong> <a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.website)}</a>`;
        details.appendChild(p);
      }

      // Tickets (optional)
      if (ev.tickets) {
        const p = document.createElement("p");
        const url = escapeAttr(ev.tickets);
        p.innerHTML = `<strong>Tickets:</strong> <a href="${url}" target="_blank" rel="noopener noreferrer">Purchase / Info</a>`;
        details.appendChild(p);
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

          if (t.endsWith("-owned")) {
            tag.dataset.owner = "true";
          }

          tagWrap.appendChild(tag);
        }

        details.appendChild(tagWrap);
      }

      card.appendChild(top);
      card.appendChild(details);
      resultsEl.appendChild(card);
    }
  }

  let all = [];
  try {
    const res = await fetch("assets/events.json", { cache: "no-store" });
    all = await res.json();
  } catch (e) {
    countEl.textContent = "Could not load events.";
    resultsEl.innerHTML = `<div class="card"><h2>Error</h2><p class="muted">Events could not be loaded.</p></div>`;
    return;
  }

  // Sort by date ascending (soonest first), unknown dates last
  all.sort((a, b) => {
    const da = parseDateOnly(a.date);
    const db = parseDateOnly(b.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });

  // Optional: set default month/year selections to current
  (function setDefaultMonthYear() {
    const now = new Date();
    const currentMonth = String(now.getMonth() + 1); // 1-12
    const currentYear = String(now.getFullYear());

    // If your HTML has those values, set them; otherwise leave as-is.
    if ([...monthEl.options].some(o => o.value === currentMonth)) {
      monthEl.value = currentMonth;
    }
    if ([...yearEl.options].some(o => o.value === currentYear)) {
      yearEl.value = currentYear;
    }
  })();

  function update() {
    const q = normalize(qEl.value);
    const monthVal = monthEl.value; // "all" or "1".."12"
    const yearVal = yearEl.value;   // "all" or "2025" etc

    const filtered = all.filter(ev => matchesFilters(ev, q, monthVal, yearVal));
    countEl.textContent = `${filtered.length} event${filtered.length === 1 ? "" : "s"} shown`;
    render(filtered);
  }

  qEl.addEventListener("input", update);
  monthEl.addEventListener("change", update);
  yearEl.addEventListener("change", update);

  update();
})();
