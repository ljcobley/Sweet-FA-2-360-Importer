(() => {
  // Popout table of match dates (icon button)
  const showDatesTableIcon = document.getElementById('showDatesTableIcon');
  if (showDatesTableIcon) {
    showDatesTableIcon.addEventListener('click', () => {
      const csv = document.getElementById('csv')?.value || '';
      if (!csv.trim()) {
        alert('No CSV data available. Please generate CSV first.');
        return;
      }
      // Parse CSV and build table rows
      const rows = csv.split('\n').map(r => {
        // Handle quoted CSV values
        const arr = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < r.length; ++i) {
          const c = r[i];
          if (c === '"') inQuotes = !inQuotes;
          else if (c === ',' && !inQuotes) { arr.push(cur); cur = ''; }
          else cur += c;
        }
        arr.push(cur);
        return arr;
      });
      if (rows.length < 2) {
        alert('No match data found.');
        return;
      }
      // Get my team name from the display card if available
      let myTeamName = '';
      const myTeamDisplay = document.getElementById('myTeamDisplay');
      if (myTeamDisplay && myTeamDisplay.textContent) {
        const match = myTeamDisplay.textContent.match(/Identified My Team: (.+)/);
        if (match) myTeamName = match[1];
      }
      // Build table with all columns
      const header = rows[0];
      let caption = 'All Match Data';
      if (myTeamName) caption += ` (${myTeamName})`;
      let tableHtml = `<html><head><title>${caption}</title><style>body{font-family:sans-serif;background:#f4f6fa;margin:24px;}table{border-collapse:collapse;width:100%;max-width:900px;margin:auto;}th,td{border:1px solid #b0bec5;padding:8px 12px;text-align:left;}th{background:#e3f2fd;}tr:nth-child(even){background:#f7f9fc;}caption{font-size:20px;font-weight:700;margin-bottom:16px;color:#1976d2;}</style></head><body><table><caption>${caption}</caption><thead><tr>`;
      for (const col of header) tableHtml += `<th>${col}</th>`;
      tableHtml += `</tr></thead><tbody>`;
      for (let i = 1; i < rows.length; ++i) {
        const r = rows[i];
        tableHtml += '<tr>' + r.map(val => `<td>${val}</td>`).join('') + '</tr>';
      }
      tableHtml += '</tbody></table></body></html>';
      const win = window.open('', 'MatchDatesTable', 'width=1000,height=700');
      if (win) {
        win.document.write(tableHtml);
        win.document.close();
      }
    });
  }
  // Helpers
  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.add('active');
  const hide = (el) => el.classList.remove('active');

  // Storage keys
  const STORAGE_KEYS = {
    lastCsv: 'ffi_last_csv',
    lastView: 'ffi_last_view',         // 'export' | 'import'
    afterPushFlag: 'ffi_after_push'    // boolean: was Push just used?
  };

  async function saveToStorage(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }
  async function loadFromStorage(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})));
  }

  const screenExport = $('screen-export');
  const screenImport = $('screen-import');
  const statusExport = $('status-export');

  // Tab switcher logic
  const tabExport = document.getElementById('tabExport');
  const tabImport = document.getElementById('tabImport');
  function activateTab(tab) {
    if (tab === 'export') {
      tabExport.classList.add('active');
      tabImport.classList.remove('active');
      show(screenExport); hide(screenImport);
      saveToStorage({ [STORAGE_KEYS.lastView]: 'export' });
    } else {
      tabImport.classList.add('active');
      tabExport.classList.remove('active');
      show(screenImport); hide(screenExport);
      saveToStorage({ [STORAGE_KEYS.lastView]: 'import' });
    }
  }
  tabExport?.addEventListener('click', () => activateTab('export'));
  tabImport?.addEventListener('click', () => activateTab('import'));
  $('goToImportHint')?.addEventListener('click', () => activateTab('import'));
  $('goToExportHint')?.addEventListener('click', () => activateTab('export'));

  // Try to find a 360Player tab
  async function find360Tab() {
    const tabs = await chrome.tabs.query({ url: ['*://app.360player.com/*'] });
    // Prefer the active one if multiple
    return tabs.find(t => t.active) || tabs[0] || null;
  }

  // Decide which screen to show, but also restore any saved CSV to the Import textarea
  async function decideDefaultScreenAndRestore() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';

    const isFT = /(^|:\/\/)([^\/]*\.)?fulltime\.thefa\.com/i.test(url);
    const is360 = /(^|:\/\/)app\.360player\.com/i.test(url);

    const stored = await loadFromStorage([STORAGE_KEYS.lastCsv, STORAGE_KEYS.lastView, STORAGE_KEYS.afterPushFlag]);
    const lastCsv = stored[STORAGE_KEYS.lastCsv];
    const lastView = stored[STORAGE_KEYS.lastView];
    const afterPush = stored[STORAGE_KEYS.afterPushFlag];

    // If we have a CSV in storage, prefill the Import textarea
    if (lastCsv && $('csv-import')) {
      $('csv-import').value = lastCsv.csv || lastCsv; // handle old shape
    }

    // Prioritize: if afterPush flag set, go to Import view
    if (afterPush) {
      activateTab('import');
      await saveToStorage({ [STORAGE_KEYS.afterPushFlag]: false, [STORAGE_KEYS.lastView]: 'import' });
      return;
    }

    // Otherwise decide based on active tab or user's last view
    if (isFT && !is360) {
      activateTab('export');
      await saveToStorage({ [STORAGE_KEYS.lastView]: 'export' });
    } else if (is360 && !isFT) {
      activateTab('import');
      await saveToStorage({ [STORAGE_KEYS.lastView]: 'import' });
    } else if (lastView === 'import') {
      activateTab('import');
    } else if (lastView === 'export') {
      activateTab('export');
    } else {
      // If unsure, show both so user sees everything
      show(screenExport);
      show(screenImport);
    }
  }

  // ============== EXPORT (Full-Time) ==============
  const elDuration   = $('duration');
  const elMeetBefore = $('meetBefore');
  const elTitlePref  = $('titlePrefix');
  const elVisibility = $('visibility');
  const elAddAdmins  = $('addAdmins');
  const elAddPlayers = $('addPlayers');              // RENAMED
  const elMyTeam     = $('myTeam');

    // Toggle export options visibility
    const showExportOptionsBtn = document.getElementById('showExportOptions');
    const hideExportOptionsBtn = document.getElementById('hideExportOptions');
    const exportOptionsContainer = document.getElementById('exportOptionsContainer');

    if (showExportOptionsBtn && exportOptionsContainer && hideExportOptionsBtn) {
      showExportOptionsBtn.addEventListener('click', () => {
        exportOptionsContainer.classList.remove('hidden');
        showExportOptionsBtn.classList.add('hidden');
        hideExportOptionsBtn.classList.remove('hidden');
      });
      hideExportOptionsBtn.addEventListener('click', () => {
        exportOptionsContainer.classList.add('hidden');
        showExportOptionsBtn.classList.remove('hidden');
        hideExportOptionsBtn.classList.add('hidden');
      });
    }
  const elGen   = $('generate');
  const elCsvBox= $('csvBox');
  const elCsv   = $('csv');
  const elCopy  = $('copy');
  const elDown  = $('download');
  const elPush  = $('pushToImport');

  const setStatusExport = (t) => { if (statusExport) statusExport.textContent = t || ''; };

  // function that runs IN PAGE to scrape Full-Time widgets
  function scrapeFullTimeInPage() {
    const clean = (s) => (s ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
    const isDateHeader = (text) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\s+\d{1,2}:\d{2}\b/.test(clean(text));
    const isXvX = (text) => /^\s*X\s*v\s*X\s*$/i.test(clean(text));
    const isSepToken = (text) => {
      const t = clean(text);
      return t === "X" || /^v\.?$/i.test(t) || /^vs\.?$/i.test(t) || t === "-" || t === "–" || t === "—" || t === "|";
    };
    const isFooterRow = (texts, tr) => {
      const lower = texts.map((t) => t.toLowerCase());
      const onlyFooter = lower.every((t) => t === "league" || t === "table" || t === "|");
      if (onlyFooter && lower.includes("league") && lower.includes("table")) return true;
      const joined = clean(texts.join(" ")).toLowerCase();
      if (joined === "league | table") return true;
      const links = Array.from(tr.querySelectorAll("a"));
      if (links.length && links.every((a) => /^(league|\|?|table)$/i.test(clean(a.textContent)))) return true;
      return false;
    };

    function extractFromContainer(container) {
      const trs = Array.from(container.querySelectorAll("tr"));
      const rows = [];
      let currentHeader = "";
      let expectingMatch = false;

      for (let i = 0; i < trs.length; i++) {
        const tr = trs[i];
        const cells = Array.from(tr.querySelectorAll("th, td"));
        if (!cells.length) continue;

        const texts = cells.map((c) => clean(c.innerText)).filter(Boolean);

        if ((cells.length === 1 && isDateHeader(texts[0])) || isDateHeader(texts.join(" "))) {
          currentHeader = texts.join(" ");
          expectingMatch = true;
          continue;
        }
        if (!expectingMatch) continue;
        if (isFooterRow(texts, tr)) { expectingMatch = false; continue; }

        const data = texts.filter((t) => !isXvX(t) && !isSepToken(t));

        if (data.length >= 2) {
          const home = data[0] || "";
          const away = data[1] || "";
          let location = data.length > 2 ? data.slice(2).join(" ") : "";

          if (!location && i + 1 < trs.length) {
            const nextCells = Array.from(trs[i + 1].querySelectorAll("th, td"));
            const nextTexts = nextCells.map((c) => clean(c.innerText)).filter(Boolean);
            if (nextCells.length === 1 && nextTexts.length === 1 && !isDateHeader(nextTexts[0]) && !isFooterRow(nextTexts, trs[i + 1])) {
              location = nextTexts[0];
              i += 1;
            }
          }
          if (currentHeader && home && away) rows.push([currentHeader, home, away, location]);
          expectingMatch = false;
        } else {
          expectingMatch = false;
        }
      }
      return rows;
    }

    const containers = Array.from(document.querySelectorAll('div[id^="lrep"]'));
    const all = [];
    for (const c of containers) all.push(...extractFromContainer(c));
    return all; // array of [headerText, home, away, location]
  }

  const monthNum = (mon) => ({jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}[mon.toLowerCase().slice(0,3)] || 1);
  const pad2 = (n) => String(n).padStart(2, "0");
  function parseHeaderDate(text) {
    const t = (text ?? "").trim();
    const m = t.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const d = +m[1], mon = monthNum(m[2]), y = +m[3], h = +m[4], mi = +m[5];
    return { dateStr: `${y}-${pad2(mon)}-${pad2(d)}`, timeStr: `${pad2(h)}:${pad2(mi)}` };
  }
  function addMinutes(hhmm, minutes) {
    const [h, m] = hhmm.split(":").map(Number);
    const dt = new Date(); dt.setHours(h, m, 0, 0); dt.setMinutes(dt.getMinutes() + minutes);
    return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
  }
  function toCSV(rows) {
    const esc = (v) => {
      const s = String(v ?? "").replace(/\u00A0/g, " ").trim();
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    return rows.map(r => r.map(esc).join(",")).join("\n");
  }
  function inferMyTeam(basicMatches, supplied) {
    const clean = (s) => (s ?? "").replace(/\s+/g," ").trim();
    if (supplied && clean(supplied)) return clean(supplied);
    const counts = new Map();
    for (const [, home, away] of basicMatches) { counts.set(home,(counts.get(home)||0)+1); counts.set(away,(counts.get(away)||0)+1); }
    const total = basicMatches.length;
    const candidates = [...counts.entries()].filter(([, c]) => c === total).map(([n]) => n);
    if (candidates.length === 1) return candidates[0];
    const answer = prompt(`I couldn't uniquely infer your team.\nTeams:\n- ${[...counts.keys()].join("\n- ")}\n\nType your team exactly as shown:`) || '';
    return clean(answer);
  }

  // NOTE: header now includes start_time and add_players
  function buildFinalRows(basicMatches, params) {
    const { durationMinutes, titlePrefix, visibility, meetBefore, addAdmins, addPlayers, myTeamSupplied } = params;
    const myTeam = inferMyTeam(basicMatches, myTeamSupplied);
    const header = [
      "date","start_time","kickoff_time","end_time","duration",
      "home","away","home_away","opponent",
      "title","type","notes","visibility","meet_before","add_admins","add_players","location"
    ];
    const out = [header];
    for (const [hdr, home, away, location] of basicMatches) {
      const parsed = parseHeaderDate(hdr); if (!parsed) continue;
      const { dateStr, timeStr } = parsed;
      const endTime = addMinutes(timeStr, durationMinutes);
      const homeAway = home === myTeam ? "HOME" : (away === myTeam ? "AWAY" : "");
      const opponent = homeAway === "HOME" ? away : (homeAway === "AWAY" ? home : "");
      const title = `${titlePrefix}${opponent}`;
      const type = "game"; const notes = "";
      out.push([
        dateStr,
        timeStr,                 // start_time
        timeStr,                 // kickoff_time
        endTime,
        String(durationMinutes),
        home, away, homeAway, opponent,
        title, type, notes, visibility, String(meetBefore),
        addAdmins, addPlayers,  // renamed column
        location
      ]);
    }
    return out;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    return tab;
  }
  async function runScrape(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeFullTimeInPage
    });
    return results && results[0] ? results[0].result : [];
  }
  function downloadCsv(filename, csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true }, () => URL.revokeObjectURL(url));
  }

  // Show identified my team below Generate CSV
  let myTeamDisplay = document.getElementById('myTeamDisplay');
  if (!myTeamDisplay) {
    myTeamDisplay = document.createElement('div');
    myTeamDisplay.id = 'myTeamDisplay';
    myTeamDisplay.className = 'my-team-card';
    myTeamDisplay.style.display = 'none';
    const genBtn = document.getElementById('generate');
    if (genBtn && genBtn.parentNode) {
      genBtn.parentNode.insertBefore(myTeamDisplay, genBtn.nextSibling);
    }
  }

  $('generate')?.addEventListener('click', async () => {
    try {
      $('generate').disabled = true;
      setStatusExport("Scraping the current tab…");

      const tab = await getActiveTab();
      if (!tab || !tab.id) throw new Error("No active tab found.");
      if (/^chrome:|^chrome-extension:|^chromewebstore:/.test(tab.url || "")) {
        throw new Error("This page cannot be accessed by extensions. Open the Full-Time page in a normal tab.");
      }

      const basic = await runScrape(tab.id);
      if (!basic || !basic.length) {
        setStatusExport("No Full-Time widget data found on this page.");
        $('generate').disabled = false;
        myTeamDisplay.textContent = '';
        return;
      }

      setStatusExport("Building CSV…");
      const duration = Math.max(1, parseInt(($('duration')?.value || "60"), 10));
      const meetBefore = Math.max(0, parseInt(($('meetBefore')?.value || "30"), 10));

      // Get my team value
      const myTeamValue = inferMyTeam(basic, $('myTeam')?.value || "");

      const rows = buildFinalRows(basic, {
        durationMinutes: duration,
        titlePrefix: $('titlePrefix')?.value || "",
        visibility: $('visibility')?.value || "private",
        meetBefore,
        addAdmins: $('addAdmins')?.value || "FALSE",
        addPlayers: $('addPlayers')?.value || "FALSE",
        myTeamSupplied: $('myTeam')?.value || ""
      });

      const csv = toCSV(rows);
      $('csv').value = csv;
      const csvBox = document.getElementById('csvBox');
      if (csv && csvBox) {
        csvBox.classList.remove('hidden');
        const showDatesTableIcon = document.getElementById('showDatesTableIcon');
        if (showDatesTableIcon) showDatesTableIcon.style.display = '';
      }
      setStatusExport(`Parsed ${rows.length - 1} matches.`);

      // Display my team
      if (myTeamValue) {
        myTeamDisplay.innerHTML = `<span class="icon">⚽</span> <span>Identified My Team: <span style='color:#0d47a1;'>${myTeamValue}</span></span>`;
        myTeamDisplay.style.display = 'flex';
      } else {
        myTeamDisplay.style.display = 'none';
        myTeamDisplay.textContent = '';
      }

      // Persist latest CSV so it survives popup closes
      await saveToStorage({ [STORAGE_KEYS.lastCsv]: { csv, ts: Date.now() } });

      setTimeout(() => { $('csv').focus(); $('csv').select(); }, 50);
    } catch (err) {
      console.error(err);
      setStatusExport(err.message || "Error while generating CSV.");
      myTeamDisplay.textContent = '';
    } finally {
      $('generate').disabled = false;
    }
  });

  $('copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('csv').value);
      $('copy').textContent = "Copied!";
      setTimeout(() => $('copy').textContent = "Copy CSV", 1200);
    } catch {
      $('csv').focus(); $('csv').select();
      alert("Copy failed. Press Ctrl/Cmd+C to copy.");
    }
  });
  $('download')?.addEventListener('click', () => downloadCsv('fulltime-matches.csv', $('csv').value));

  // Push CSV directly into Import tab — now persistent & tab-switch proof
  $('pushToImport')?.addEventListener('click', async () => {
    const csv = ($('csv')?.value || '').trim();
    if (!csv) { alert('No CSV to push yet. Click "Generate CSV" first.'); return; }

    // 1) Persist CSV + intent in storage so it survives popup close
    await saveToStorage({
      [STORAGE_KEYS.lastCsv]: { csv, ts: Date.now() },
      [STORAGE_KEYS.lastView]: 'import',
      [STORAGE_KEYS.afterPushFlag]: true
    });

    // 2) Prefill current popup's import textarea immediately (for the case user doesn't switch away)
    if ($('csv-import')) $('csv-import').value = csv;

    // 3) Switch the popup UI to Import now
    show(screenImport); hide(screenExport);

    // 4) (Optional nicety) If a 360Player tab exists, activate it for the user
    try {
      const t = await find360Tab();
      if (t?.id) await chrome.tabs.update(t.id, { active: true });
    } catch { /* ignore */ }
  });

  // ============== IMPORT (360Player) ==============
// Display team name from 360Player calendar page
async function display360PlayerTeamName() {
  // Only run if import tab is active and 360Player tab is open
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\/app\.360player\.com\//.test(tab.url)) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Find the strong element with the team name
        const el = document.querySelector('strong.HU89T05lxSvu6hqh3zEq');
        return el ? el.textContent : '';
      }
    });
    const teamName = result?.result || '';
    let teamNameDisplay = document.getElementById('teamNameDisplay');
    if (!teamNameDisplay) {
      teamNameDisplay = document.createElement('div');
      teamNameDisplay.id = 'teamNameDisplay';
      teamNameDisplay.className = 'my-team-card';
      teamNameDisplay.style.marginBottom = '18px';
      const importSection = document.getElementById('screen-import');
      if (importSection) importSection.insertBefore(teamNameDisplay, importSection.firstChild);
    }
    teamNameDisplay.innerHTML = teamName ? `<span class="icon">📅</span> <span>Selected Calendar Team: <span style='color:#0d47a1;'>${teamName}</span></span>` : '';
    teamNameDisplay.style.display = teamName ? 'flex' : 'none';
  } catch (e) {
    // Fail silently
  }
}

// Run when import tab is activated
tabImport?.addEventListener('click', () => {
  setTimeout(display360PlayerTeamName, 300);
});
  const statusDot = document.querySelector('#status .dot');
  const statusText = document.querySelector('#status .text');
  function setStatus(state, text) {
    if (statusDot) statusDot.className = 'dot ' + state;
    if (statusText) statusText.textContent = text;
  }

  // Debugging Tools wiring
  const dbgOverrideMode = $('dbgOverrideMode');
  const dbgModeOptions  = $('dbgModeOptions');
  if (dbgOverrideMode && dbgModeOptions) {
    dbgOverrideMode.addEventListener('change', () => {
      dbgModeOptions.classList.toggle('hidden', !dbgOverrideMode.checked);
    });
  }

  function getMode() {
    // Default to FULL RUN unless explicitly overridden in Debugging Tools
    if (!dbgOverrideMode?.checked) return 'full';
    const r = document.querySelector('input[name="dbgMode"]:checked');
    return r ? r.value : 'full';
  }

  $('run')?.addEventListener('click', async () => {
    setStatus('working', 'Sending to page…');

    const csv = (($('csv-import')?.value) || '').trim();
    if (!csv) { setStatus('error', 'Please paste CSV first (or push from Export tab).'); return; }

    // Persist what user is about to run, so a reopen still has it
    await saveToStorage({
      [STORAGE_KEYS.lastCsv]: { csv, ts: Date.now() },
      [STORAGE_KEYS.lastView]: 'import'
    });

    const options = {
      mode: getMode(),
      validateOnly: $('validateOnly')?.checked || false,
      dedupe: $('dedupe')?.checked !== false // default true
    };

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { setStatus('error', 'No active tab found.'); return; }

    // Send start message
    const startResp = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'TEAM_BULK_IMPORT', payload: { csv, options } }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { ok: false });
      });
    });

    if (!startResp?.ok) {
      setStatus('error', startResp?.error || 'Could not start — is the 360Player tab open?');
      return;
    }
    setStatus('working', 'Started. Watching progress…');

    // Poll status
    const result = await new Promise((resolve) => {
      const started = Date.now();
      const maxMs = 120000, intervalMs = 1500;
      const timer = setInterval(() => {
        if (Date.now() - started > maxMs) {
          clearInterval(timer);
          resolve({ finished: false, timeout: true });
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'TEAM_BULK_STATUS' }, (status) => {
          if (chrome.runtime.lastError) return; // ignore during navigation
          if (status?.finished) { clearInterval(timer); resolve(status); }
        });
      }, intervalMs);
    });

    if (result.timeout) { setStatus('warn', 'Timed out waiting. Check the page.'); return; }
    if (result.error) { setStatus('error', 'Failed: ' + result.error); return; }
    setStatus('ok', 'Done.');
  });

  // Init
  decideDefaultScreenAndRestore();
  // Also display team name if import tab is shown on load
  setTimeout(() => {
    if (screenImport && screenImport.classList.contains('active')) {
      display360PlayerTeamName();
    }
  }, 350);
})();
