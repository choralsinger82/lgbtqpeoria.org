(async function () {
  const resultsEl = document.getElementById("results");
  const qEl = document.getElementById("q");
  const catEl = document.getElementById("category");
  const areaEl = document.getElementById("area");
  const countEl = document.getElementById("count");

  if (!resultsEl || !qEl || !catEl || !areaEl || !countEl) return;

  function normalize(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function fromHash() {
    // Supports links like directory.html#cat=health
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const cat = params.get("cat");
    if (cat && [...catEl.options].some(o => o.value === cat)) {
      catEl.value = cat;
    }
  }

  function matchesFilters(item, q, cat, area) {
    if (cat !== "all" && item.category !== cat) return false;
    if (area !== "all" && item.area !== area) return false;

    if (!q) return true;

    const hay = normalize([
      item.name,
      item.short,
      item.description,
      item.address,
      item.category,
      item.area,
      (item.tags || []).join(" ")
    ].join(" "));

    return hay.includes(q);
  }

  function badge(text) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = text;
    return span;
  }

  function render(items) {
    resultsEl.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `
        <h2>No matches</h2>
        <p class="muted">Try a different search term or reset filters.</p>
      `;
      resultsEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "card listing";

      const top = document.createElement("div");
      top.className = "listing-top";

      const title = document.createElement("h2");
      title.className = "listing-title";
      title.textContent = item.name;

      const meta = document.createElement("div");
      meta.className = "listing-meta";
      meta.appendChild(badge(labelCategory(item.category)));
      meta.appendChild(badge(labelArea(item.area)));

      top.appendChild(title);
      top.appendChild(meta);

      const short = document.createElement("p");
      short.className = "listing-short";
      short.textContent = item.short || "";

      const details = document.createElement("div");
      details.className = "listing-details";

      if (item.address) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Location:</strong> ${escapeHtml(item.address)}`;
        details.appendChild(p);
      }

      if (item.website) {
        const p = document.createElement("p");
        p.innerHTML = `<strong>Website:</strong> <a href="${escapeAttr(item.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.website)}</a>`;
        details.appendChild(p);
      }

      const desc = document.createElement("p");
      desc.className = "muted";
      desc.textContent = item.description || "";
      details.appendChild(desc);

      if (item.notes) {
        const notes = document.createElement("p");
        notes.className = "small";
        notes.innerHTML = `<strong>Notes:</strong> ${escapeHtml(item.notes)}`;
        details.appendChild(notes);
      }

      if (item.tags && item.tags.length) {
        const tagWrap = document.createElement("div");
        tagWrap.className = "tag-row";
        for (const t of item.tags) {
          const a = document.createElement("span");
          a.className = "tag";
          a.textContent = t;
          tagWrap.appendChild(a);
        }
        details.appendChild(tagWrap);
      }

      card.appendChild(top);
      card.appendChild(short);
      card.appendChild(details);

      resultsEl.appendChild(card);
    }
  }

  function labelCategory(cat) {
    const map = {
      community: "Community",
      support: "Support",
      health: "Health",
      legal: "Legal",
      businesses: "Businesses",
      events: "Events",
      faith: "Faith & Spiritual"
    };
    return map[cat] || cat;
  }

  function labelArea(area) {
    const map = {
      peoria: "Peoria",
      "central-il": "Central Illinois",
      virtual: "Virtual"
    };
    return map[area] || area;
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
    // Minimal for href attributes
    return (str || "").toString().replaceAll('"', "%22");
  }

  let all = [];
  try {
    const res = await fetch("assets/listings.json", { cache: "no-store" });
    all = await res.json();
  } catch (e) {
    countEl.textContent = "Could not load listings.";
    resultsEl.innerHTML = `<div class="card"><h2>Error</h2><p class="muted">Listings could not be loaded.</p></div>`;
    return;
  }

  fromHash();

  function update() {
    const q = normalize(qEl.value);
    const cat = catEl.value;
    const area = areaEl.value;

    const filtered = all.filter(item => matchesFilters(item, q, cat, area));
    countEl.textContent = `${filtered.length} listing${filtered.length === 1 ? "" : "s"} shown`;
    render(filtered);
  }

  qEl.addEventListener("input", update);
  catEl.addEventListener("change", update);
  areaEl.addEventListener("change", update);

  update();
})();
