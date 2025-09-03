// content.js — Full-Time widget → enriched CSV with preview modal / copy or download
(() => {
  "use strict";

  // ---------- text/helpers ----------
  const clean = (s) =>
    (s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const isDateHeader = (text) => {
    const t = clean(text);
    // e.g. "Sat 20 Sep 2025 10:30"
    return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\s+\d{1,2}:\d{2}\b/.test(t);
  };

  const isXvX = (text) => /^\s*X\s*v\s*X\s*$/i.test(clean(text));
  const isSepToken = (text) => {
    const t = clean(text);
    return t === "X" || /^v\.?$/i.test(t) || /^vs\.?$/i.test(t) || t === "-" || t === "–" || t === "—" || t === "|";
  };

  // footer like "League | Table"
  const isFooterRow = (texts, tr) => {
    const lower = texts.map((t) => t.toLowerCase());
    const onlyFooterTokens = lower.every((t) => t === "league" || t === "table" || t === "|");
    if (onlyFooterTokens && lower.includes("league") && lower.includes("table")) return true;
    const joined = clean(texts.join(" ")).toLowerCase();
    if (joined === "league | table") return true;
    const links = Array.from(tr.querySelectorAll("a"));
    if (links.length && links.every((a) => /^(league|\|?|table)$/i.test(clean(a.textContent)))) return true;
    return false;
  };

  const monthNum = (mon) => {
    const m = mon.toLowerCase().slice(0, 3);
    return { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }[m] || 1;
  };
  const pad2 = (n) => String(n).padStart(2, "0");

  // "Sat 20 Sep 2025 10:30" -> {dateStr:'YYYY-MM-DD', timeStr:'HH:MM'}
  function parseHeaderDate(text) {
    const t = clean(text);
    const m = t.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const d = parseInt(m[1], 10);
    const mon = monthNum(m[2]);
    const y = parseInt(m[3], 10);
    const h = parseInt(m[4], 10);
    const mi = parseInt(m[5], 10);
    return { dateStr: `${y}-${pad2(mon)}-${pad2(d)}`, timeStr: `${pad2(h)}:${pad2(mi)}` };
  }

  function addMinutes(hhmm, minutes) {
    const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
    const dt = new Date();
    dt.setHours(h, m, 0, 0);
    dt.setMinutes(dt.getMinutes() + minutes);
    return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
  }

  function toCSV(rows) {
    const esc = (v) => {
      const s = clean(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return rows.map((r) => r.map(esc).join(",")).join("\n");
  }

  // ---------- scrape → [header, home, away, location] ----------
  // Updated for public Full Time site: parses pipe-separated rows
  function extractBasicMatchesFromPublicPage() {
    // New logic: extract from table rows
    const rows = [];
    const table = document.querySelector('.fixtures-table table');
    if (!table) return rows;
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const pad2 = (n) => String(n).padStart(2, "0");
    for (const tr of table.querySelectorAll('tbody tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 8) continue;
      // Date/Time
      const dateCell = tds[1];
      const spans = dateCell.querySelectorAll('span');
      let dateStr = '', timeStr = '';
      if (spans.length >= 2) {
        dateStr = clean(spans[0].textContent);
        timeStr = clean(spans[1].textContent);
      } else {
        const parts = clean(dateCell.textContent).split(' ');
        dateStr = parts[0] || '';
        timeStr = parts[1] || '';
      }
      // Compose header as original date string for compatibility
      let header = '';
      let dtObj = null;
      const m = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2})/);
      if (m && timeStr.match(/\d{2}:\d{2}/)) {
        dtObj = new Date(`20${m[3]}-${m[2]}-${m[1]}T${timeStr}:00`);
      }
      if (dtObj && !isNaN(dtObj.getTime())) {
        header = `${days[dtObj.getDay()]} ${pad2(dtObj.getDate())} ${months[dtObj.getMonth()]} ${dtObj.getFullYear()} ${pad2(dtObj.getHours())}:${pad2(dtObj.getMinutes())}`;
      } else {
        header = `${dateStr} ${timeStr}`.trim();
      }
      // Home and away
      const home = clean(tds[2].textContent);
      const away = clean(tds[6].textContent);
      const venue = clean(tds[7].textContent);
      if (header && home && away) {
        rows.push([header, home, away, venue]);
      }
    }
    return rows;
  }

  // ---------- prompts ----------
  function promptNumber(msg, defVal) {
    const raw = window.prompt(msg, String(defVal));
    if (raw === null) return null;
    const n = parseInt(clean(raw), 10);
    return Number.isFinite(n) ? n : defVal;
  }

  function promptVisibility(defVal = "private") {
    const raw = window.prompt("Visibility? Type 'private' or 'public'", defVal);
    if (raw === null) return null;
    const v = clean(raw).toLowerCase();
    return v === "public" ? "public" : "private";
  }

  function promptBool(msg, defTrueFalse = "FALSE") {
    const raw = window.prompt(msg, defTrueFalse);
    if (raw === null) return null;
    const t = clean(raw).toLowerCase();
    const truthy = ["true", "t", "yes", "y", "1"];
    return truthy.includes(t) ? "TRUE" : "FALSE";
  }

  // ---------- derive my team & build rows ----------
  function inferMyTeam(basicMatches) {
    const counts = new Map();
    for (const [, home, away] of basicMatches) {
      counts.set(home, (counts.get(home) || 0) + 1);
      counts.set(away, (counts.get(away) || 0) + 1);
    }
    const total = basicMatches.length;
    const candidates = [...counts.entries()].filter(([, c]) => c === total).map(([name]) => name);

    if (candidates.length === 1) return candidates[0];

    const guess = window.prompt(
      `I couldn't uniquely infer your team.\n\nTeams seen:\n- ${[...counts.keys()].join("\n- ")}\n\nType your team exactly as shown:`
    );
    return clean(guess || "");
  }

  function buildFinalRows(basicMatches, params) {
    const {
      durationMinutes,
      titlePrefix,
      visibility,
      meetBefore,
      addAdmins,
      addUsers
    } = params;

    const myTeam = inferMyTeam(basicMatches);

    const header = [
      "date",
      "kickoff_time",
      "end_time",
      "duration",
      "home",
      "away",
      "home_away",
      "opponent",
      "title",
      "type",
      "notes",
      "visibility",
      "meet_before",
      "add_admins",
      "add_users",
      "location"
    ];
    const out = [header];

    for (const [headerText, home, away, location] of basicMatches) {
      const parsed = parseHeaderDate(headerText);
      if (!parsed) continue;

      const { dateStr, timeStr } = parsed;
      const endTime = addMinutes(timeStr, durationMinutes);

      const homeAway = home === myTeam ? "HOME" : (away === myTeam ? "AWAY" : "");
      const opponent = homeAway === "HOME" ? away : (homeAway === "AWAY" ? home : "");
      const title = `${titlePrefix}${opponent}`;
      const type = "game";
      const notes = "";

      out.push([
        dateStr,
        timeStr,
        endTime,
        String(durationMinutes),
        home,
        away,
        homeAway,
        opponent,
        title,
        type,
        notes,
        visibility,
        String(meetBefore),
        addAdmins,
        addUsers,
        location
      ]);
    }
    return out;
  }

  // ---------- bigger preview modal ----------
  function showCsvModal(filename, csv) {
    // Remove any existing modal to avoid stacking
    const existing = document.querySelector(".__ftcsv_modal_overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "__ftcsv_modal_overlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      z-index: 2147483647; display: flex; align-items: center; justify-content: center;
      padding: 2vh;
    `;

    const modal = document.createElement("div");
    modal.className = "__ftcsv_modal";
    modal.style.cssText = `
      background: #fff; color: #111; width: min(96vw, 1200px);
      max-height: 92vh; overflow: hidden;
      border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      display:flex; flex-direction:column;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 14px 18px; border-bottom: 1px solid #eee;
      display:flex; align-items:center; justify-content:space-between;
      font: 600 17px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial;
    `;
    header.innerHTML = `<span>CSV Preview</span><span style="font: 12px/1.2 system-ui;color:#666;">${filename}</span>`;

    const ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.value = csv;
    ta.wrap = "off";             // keep one CSV row per line
    ta.spellcheck = false;
    ta.style.cssText = `
      flex: 1; padding: 14px 18px; border: none; outline: none;
      resize: both; overflow: auto; width: 100%;
      font: 13px/1.35 ui-monospace,SFMono-Regular,Consolas,Monaco,monospace;
      white-space: pre; background:#fff;
      min-height: 40vh;
      height: 70vh;   /* default visible height ~15+ rows */
    `;

    const footer = document.createElement("div");
    footer.style.cssText = `
      padding: 12px 18px; border-top: 1px solid #eee;
      display:flex; gap:10px; justify-content:flex-end;
    `;

    const btn = (label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = `
        padding: 9px 14px; border: 1px solid #bbb; background:#f7f7f7; cursor:pointer;
        border-radius: 8px; font: 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial;
      `;
      return b;
    };

    const copyBtn = btn("Copy CSV");
    const dlBtn = btn("Download CSV");
    const closeBtn = btn("Close");

    copyBtn.addEventListener("click", async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(csv);
        } else {
          ta.focus(); ta.select(); document.execCommand("copy");
        }
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy CSV"), 1200);
      } catch {
        alert("Copy failed. You can select all and copy manually.");
      }
    });

    dlBtn.addEventListener("click", () => {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    });

    const close = () => overlay.remove();
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
}

})();
