(async function () {
  const resultsEl = document.getElementById("results");
  const qEl = document.getElementById("q");
  const catEl = document.getElementById("category");
  const countEl = document.getElementById("count");

  // Removed featureEl requirement (Services dropdown no longer exists)
  if (!resultsEl || !qEl || !catEl || !countEl) return;

  function normalize(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  // A slightly more aggressive normalizer for tags so matching is forgiving
  function normalizeTag(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/\/+/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function fromHash() {
    // Supports links like: directory.html#cat=health
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);

    const cat = params.get("cat");
    if (cat && [...catEl.options].some((o) => o.value === cat)) {
      catEl.value = cat;
    }
  }

  function matchesFilters(item, q, cat) {
    if (cat !== "all" && item.category !== cat) return false;

    if (!q) return true;

    const hay = normalize(
      [
        item.name,
        item.short,
        item.description,
        item.address,
        item.category,
        // Keep area searchable even though it’s not a filter:
        item.area,
        (item.tags || []).join(" "),
      ].join(" ")
    );

    return hay.includes(q);
  }

  function badge(text, extraClass = "") {
    const span = document.createElement("span");
    span.className = `pill${extraClass ? " " + extraClass : ""}`;
    span.textContent = text;
    return span;
  }

  // NOTE: Top-right pills are category-only.
  // We intentionally do NOT derive additional pills from tags.

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

      // Category-only pill
      meta.appendChild(badge(labelCategory(item.category)));

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
        p.innerHTML = `<strong>Website:</strong> <a href="${escapeAttr(
          item.website
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          item.website
        )}</a>`;
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

      // Tags (ownership tags styled via data-owner)
      if (item.tags && item.tags.length) {
        const tagWrap = document.createElement("div");
        tagWrap.className = "tag-row";

        for (const t of item.tags) {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = t;

          // Make ownership highlight more forgiving:
          // - supports "queer-owned" style
          // - also supports "Queer-owned" / "Queer Owned" etc
          const tn = normalizeTag(t);
          if (tn.endsWith(" owned")) {
            tag.dataset.owner = "true";
          } else if (t.toString().toLowerCase().endsWith("-owned")) {
            tag.dataset.owner = "true";
          }

          tagWrap.appendChild(tag);
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
      nightlife: "Nightlife",
      events: "Events",
      faith: "Faith & Spiritual",
    };
    return map[cat] || cat;
  }

  function escapeHtml(str) {
    return (str || "")
      .toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(str) {
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

    const filtered = all.filter((item) => matchesFilters(item, q, cat));
    countEl.textContent = `${filtered.length} listing${
      filtered.length === 1 ? "" : "s"
    } shown`;
    render(filtered);
  }

  qEl.addEventListener("input", update);
  catEl.addEventListener("change", update);

  update();
})();
