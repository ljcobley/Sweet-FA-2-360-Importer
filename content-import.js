// ===== Singleton guard (avoid double injection / global clashes) =====
if (window.__bulk_injected) {
  console.log('[Bulk Import] already injected');
  throw new Error('DUP'); // stop this copy
}
window.__bulk_injected = true;

// --- Confirm injection ---
console.log("[Bulk Import] content.js injected");

// ====== HARD OVERRIDE: set your group prefix here ======
const MANUAL_GROUP_PREFIX = "/organization/30050/group/50101"; // <- your exact path

let IMPORT_OPTIONS = { mode: "full", validateOnly: false, dedupe: true }; // 'full' | 'type' | 'highlight'

// ===== Job persistence (survives navigation via sessionStorage) =====
const JOB_KEY = "__bulk_job_v1";
const GROUP_PREFIX_KEY = "__bulk_group_prefix_v1"; // remember /organization/.../group/...

/** currentJob shape:
 * {
 *   rows: [...],
 *   options: {...},
 *   index: 0,
 *   resumeAfterNav: bool,
 *   nextIso?: string
 * }
 */
let currentJob = null;

function saveJob(job) { try { sessionStorage.setItem(JOB_KEY, JSON.stringify(job)); } catch {} }
function loadJob() { try { const raw = sessionStorage.getItem(JOB_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function clearJob() { try { sessionStorage.removeItem(JOB_KEY); } catch {} }

function setStoredPrefix(prefix) { try { if (prefix) sessionStorage.setItem(GROUP_PREFIX_KEY, prefix); } catch {} }
function getStoredPrefix() { try { return sessionStorage.getItem(GROUP_PREFIX_KEY) || null; } catch { return null; } }

// ===== Small utils =====
function setImportOptions(opts = {}) { IMPORT_OPTIONS = { ...IMPORT_OPTIONS, ...opts }; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(getter, { timeout = 10000, interval = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = typeof getter === 'function' ? getter() : document.querySelector(getter);
      if (v) return v;
    } catch {}
    await sleep(interval);
  }
  return null;
}
function q(scope, sel) { return (scope || document).querySelector(sel); }
function qa(scope, sel) { return [...(scope || document).querySelectorAll(sel)]; }
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function toUnixSeconds(date) { return Math.floor(date.getTime() / 1000); }
function startOfDayLocal(y, m, d) { return new Date(y, m-1, d, 0, 0, 0, 0); }

// Convert CSV date → ISO (handles YYYY-MM-DD and DD/MM/YYYY)
function toIsoDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mIso) { const [_, y, mo, d] = mIso; return `${y.padStart(4,'0')}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  const mUk = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mUk) { const [_, d, mo, y] = mUk; return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  const dt = new Date(s);
  if (!isNaN(dt)) { const y = dt.getFullYear(), mo = String(dt.getMonth()+1).padStart(2,'0'), d = String(dt.getDate()).padStart(2,'0'); return `${y}-${mo}-${d}`; }
  console.warn('[Bulk Import] Could not parse date:', val);
  return null;
}

// ===== UI helpers =====
function showBanner(text) {
  let el = document.getElementById('__bulk_banner');
  if (!el) {
    el = document.createElement('div');
    el.id = '__bulk_banner';
    Object.assign(el.style, {
      position: 'fixed', left: '50%', top: '10px', transform: 'translateX(-50%)',
      padding: '8px 12px', background: '#ffe082', color: '#000',
      border: '1px solid #caa84c', borderRadius: '8px', zIndex: 999999, fontFamily: 'system-ui'
    });
    document.body.appendChild(el);
  }
  el.textContent = text;
  setTimeout(() => el.remove(), 2500);
}

const HILITE_CSS = `.__bulk_hilite { outline: 2px dashed #1976d2; outline-offset: 2px; }`;
(function () { const s = document.createElement('style'); s.textContent = HILITE_CSS; document.documentElement.appendChild(s); })();
function mark(el) { if (el) el.classList.add('__bulk_hilite'); }
function clickHard(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const cx = Math.floor(r.left + r.width/2);
  const cy = Math.floor(r.top + r.height/2);
  for (const type of ['pointerdown','mousedown','mouseup','click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
  }
}

// ===== Popup status heartbeat =====
function updateStatus(obj) {
  try { window.__bulkLastRun = { ...(window.__bulkLastRun||{}), ...obj, at: Date.now() }; } catch {}
}

// ===== Progress dialog (overlay) =====
let __bulkProgress = { el: null, total: 0, done: 0, startedAt: 0 };

function openProgressDialog(total) {
  __bulkProgress.total = Number(total) || 0;
  __bulkProgress.done = 0;
  __bulkProgress.startedAt = Date.now();

  if (__bulkProgress.el) __bulkProgress.el.remove();

  const wrap = document.createElement('div');
  wrap.id = '__bulk_progress';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-live', 'polite');
  Object.assign(wrap.style, {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    width: '320px',
    padding: '14px 16px',
    background: 'rgba(28,28,30,0.92)',
    color: '#fff',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    zIndex: 1000000,
    cursor: 'pointer'
  });

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-weight:600;">Team Import</div>
      <div id="__bulk_progress_close" title="Dismiss" style="opacity:.8;font-size:12px;">✕</div>
    </div>
    <div id="__bulk_progress_text" style="font-size:14px; opacity:0.95; margin-bottom:8px;">
      Preparing…
    </div>
    <div style="height:8px; background:#3a3a3c; border-radius:999px; overflow:hidden;">
      <div id="__bulk_progress_bar" style="height:100%; width:0%; background:#4CAF50; transition:width .2s ease;"></div>
    </div>
  `;

  // Click-to-dismiss anywhere
  wrap.addEventListener('click', () => { __bulkProgress.el?.remove(); __bulkProgress.el = null; });

  document.body.appendChild(wrap);
  __bulkProgress.el = wrap;
}

function updateProgressDialog(done, total, extraMsg) {
  __bulkProgress.done = Math.max(0, Number(done) || 0);
  __bulkProgress.total = Math.max(__bulkProgress.total, Number(total) || 0);

  const textEl = document.getElementById('__bulk_progress_text');
  const barEl  = document.getElementById('__bulk_progress_bar');
  if (!textEl || !barEl) return;

  const t = __bulkProgress.total || 0;
  const d = clamp(__bulkProgress.done, 0, t || 1);
  const pct = t ? Math.round((d / t) * 100) : 0;

  textEl.textContent = `Added ${d} of ${t} events${extraMsg ? ` — ${extraMsg}` : ''}`;
  barEl.style.width = `${pct}%`;
}

function closeProgressDialog(finalMsg = 'Done.') {
  const textEl = document.getElementById('__bulk_progress_text');
  if (textEl) textEl.textContent = finalMsg;
  setTimeout(() => { __bulkProgress.el?.remove(); __bulkProgress.el = null; }, 1600);
}

// ===== Selectors =====
const SELECTORS = {
  // calendar
  monthGrid: '[role="grid"], [role="table"]',
  monthHeader: '[role="heading"], [aria-live], h1, h2, h3',
  monthPrev: 'button[aria-label*="Prev" i], button[aria-label*="Previous" i], [data-testid*="prev"]',
  monthNext: 'button[aria-label*="Next" i], [data-testid*="next"]',

  // create
  newEventBtn: 'button[data-testid="calendar.create_new_button"]',
  gameMenuAnchor: 'a[data-testid="context_menu.item"]',
  gameMenuDot: 'a[data-testid="context_menu.item"] [eventtype="match"]',

  // dialog / form
  dialog: '[role="dialog"], .modal, [data-testid*="dialog"]',

  // Fields
  fields: {
    title: 'input[data-testid="events.form.title"], input[name="title"], input[placeholder="Event title"]',
    location: 'input[data-testid="events.form.location"], input[name="location"], input[placeholder="Location"]',
    notes: 'textarea, [contenteditable="true"][role="textbox"]',
    meetBefore: 'input[name="meetBeforeMinutes"][type="number"]'
  },
  game: {
    opponent: 'input[data-testid="events.form.match.opponent"], input[name="opponentName"]',
    kickoff: 'input[data-testid="events.form.match.kickoff"][type="time"], input[name="time"][type="time"]',
    duration: 'input[name="duration"][type="number"]',
    homeText: 'Home',
    awayText: 'Away'
  },

  saveText: 'Save',
  successToast: '[role="status"], .toast',
  confirmFinishBtn: 'button[data-testid="dialog.confirm"]'
};

// ===== Visibility dropdown (native <select>) =====
function normalizeVisibility(val) {
  if (!val) return null;
  const v = String(val).trim().toLowerCase();
  if (['public','everyone','all','team','visible to everyone','open'].some(s => v.includes(s))) return 'public';
  if (['private','participants','only participants','invite','hidden'].some(s => v.includes(s))) return 'private';
  if (v === 'public' || v === 'private') return v;
  return null;
}
function findLabelByText(scope, text) {
  const labs = qa(scope, 'label');
  return labs.find(l => l.textContent.trim().startsWith(text));
}
function findSelectNearLabel(scope, labelText) {
  const label = findLabelByText(scope, labelText) || findLabelByText(scope, labelText + ':');
  if (label) {
    const htmlFor = label.getAttribute('for');
    if (htmlFor) {
      const byFor = (scope || document).getElementById(htmlFor);
      if (byFor && byFor.tagName === 'SELECT') return byFor;
    }
    const container = label.closest('[class],[role],div,section,fieldset') || label.parentElement;
    const inContainer = container?.querySelector('select');
    if (inContainer) return inContainer;
    const next = label.nextElementSibling?.querySelector?.('select');
    if (next) return next;
  }
  const aria = (scope || document).querySelector(`select[aria-label="${CSS.escape(labelText)}"]`);
  return aria || null;
}
async function setSelectByLabel(scope, labelText, desiredValueOrText) {
  const select = findSelectNearLabel(scope, labelText);
  if (!select) { console.warn('[Bulk Import] Visibility <select> not found'); return false; }
  mark(select);
  if (IMPORT_OPTIONS.mode === 'highlight') return true;

  const normalized = normalizeVisibility(desiredValueOrText);
  if (normalized && [...select.options].some(o => o.value === normalized)) {
    select.value = normalized;
  } else {
    const want = String(desiredValueOrText).toLowerCase().trim();
    const byExact = [...select.options].find(o => o.text.toLowerCase().trim() === want);
    const byContains = byExact || [...select.options].find(o => o.text.toLowerCase().includes(want));
    if (byContains) select.value = byContains.value;
    else { console.warn('[Bulk Import] Could not match visibility option for:', desiredValueOrText); return false; }
  }
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(50);
  return true;
}

// ===== Visibility & grid heuristics =====
function isVisible(el) {
  if (!el || el.nodeType !== 1) return false;
  const st = getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 10 && r.height > 10 && r.bottom > 0 && r.right > 0;
}
function getHeuristicMonthGrids() {
  const all = [...document.querySelectorAll('div, section, main, article, [role], [class]')];
  const scored = [];
  for (const g of all) {
    if (!isVisible(g)) continue;
    const cells = g.querySelectorAll('button,[role="gridcell"],[role="button"],div,span');
    let dayCount = 0;
    for (const c of cells) {
      const t = (c.textContent || '').trim();
      if (/^\d{1,2}$/.test(t)) {
        const n = Number(t);
        if (n >= 1 && n <= 31) dayCount++;
      }
    }
    if (dayCount >= 20) scored.push({ grid: g, dayCount });
  }
  scored.sort((a,b) => b.dayCount - a.dayCount);
  return scored.map(x => x.grid);
}
function getVisibleMonthGrids() {
  const roleBased = [...document.querySelectorAll(SELECTORS.monthGrid)].filter(isVisible);
  const heuristics = getHeuristicMonthGrids();
  const set = new Set(roleBased);
  heuristics.forEach(g => set.add(g));
  return [...set];
}

// ===== Month header helpers =====
function monthYearToComparable(text) {
  const m = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (!m) return null;
  const mon = m[1].slice(0,3);
  const y = Number(m[2]);
  const mi = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
               .indexOf(mon[0].toUpperCase()+mon.slice(1,3).toLowerCase()) + 1;
  return { y, m: mi };
}
function currentMonthComparable() {
  const grids = getVisibleMonthGrids();
  for (const g of grids) {
    const container = g.closest('[class]') || document;
    const header = container.querySelector(SELECTORS.monthHeader);
    const txt = (header?.textContent || '').trim();
    const cmp = monthYearToComparable(txt);
    if (cmp) return cmp;
  }
  const any = document.body.innerText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/);
  if (any) return monthYearToComparable(any[0]);
  return null;
}
async function clickMonthNavTowards(target, maxSteps = 24) {
  const cur = currentMonthComparable();
  if (!cur) return;
  const dir = (target.y > cur.y || (target.y === cur.y && target.m > cur.m)) ? +1 : -1;
  const btn = dir > 0
    ? (q(document, SELECTORS.monthNext) || document.querySelector('button[aria-label*="Next" i]'))
    : (q(document, SELECTORS.monthPrev) || document.querySelector('button[aria-label*="Prev" i], button[aria-label*="Previous" i]'));
  if (!btn) return;
  const steps = clamp(Math.abs((target.y - cur.y) * 12 + (target.m - cur.m)), 1, maxSteps);
  for (let i=0;i<steps;i++) { if (IMPORT_OPTIONS.mode !== 'highlight') btn.click(); await sleep(80); }
}

// ===== Find & click day =====
function findDayCellInMonthGrid(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const label = `${MONTHS[m-1]} ${d}, ${y}`;
  const dayText = String(d);

  const grids = getVisibleMonthGrids();
  for (const grid of grids) {
    let el = grid.querySelector?.(`[aria-label*="${label}"]`);
    if (el) return el.closest('[role="gridcell"],[role="button"],button') || el;

    el = grid.querySelector?.(`[data-date="${iso}"], [data-day="${iso}"], [data-value="${iso}"]`);
    if (el) return el;

    const candidates = [...(grid.querySelectorAll?.('button,[role="gridcell"],[role="button"],div,span') || [])]
      .filter(c => (c.textContent || '').trim() === dayText);
    const good = candidates.find(c => {
      const disabled = c.getAttribute?.('aria-disabled') === 'true';
      const cls = (c.className || '').toLowerCase();
      const isOutside = /outside|other-month/.test(cls);
      return !disabled && isVisible(c) && !isOutside;
    }) || candidates[0];
    if (good) return good;
  }
  return null;
}

// ===== Group prefix discovery =====
function derivePrefixFromPath(pathname) {
  if (MANUAL_GROUP_PREFIX) return MANUAL_GROUP_PREFIX.replace(/\/$/, '');
  const calIdx = pathname.indexOf('/calendar/');
  if (calIdx !== -1) return pathname.slice(0, calIdx).replace(/\/$/, '');
  const m = pathname.match(/^(\/organization\/\d+\/group\/\d+)/);
  if (m) return m[1];
  const mOrg = pathname.match(/^(\/organization\/\d+)/);
  if (mOrg) return mOrg[1];
  return null;
}
function discoverPrefixFromAnchors() {
  if (MANUAL_GROUP_PREFIX) return MANUAL_GROUP_PREFIX.replace(/\/$/, '');
  const a = [...document.querySelectorAll('a[href*="/calendar/month"]')];
  for (const el of a) {
    const href = el.getAttribute('href') || '';
    try {
      const u = new URL(href, location.origin);
      const p = derivePrefixFromPath(u.pathname);
      if (p) return p;
    } catch {}
  }
  return null;
}
function refreshStoredPrefixFromLocation() {
  const p = derivePrefixFromPath(location.pathname);
  if (p) { setStoredPrefix(p); return p; }
  return null;
}

// ===== Month URL builder (force /calendar/month with preserved/overridden group prefix) =====
function buildMonthUrlForDate(targetIso) {
  const prefix = (MANUAL_GROUP_PREFIX || getStoredPrefix() || refreshStoredPrefixFromLocation() || discoverPrefixFromAnchors() || "/").replace(/\/$/, '');
  const [y, m, d] = targetIso.split('-').map(Number);
  const ts = toUnixSeconds(startOfDayLocal(y, m, d));

  const url = new URL(location.origin);
  url.pathname = `${prefix}/calendar/month`.replace(/\/{2,}/g, '/');
  url.searchParams.set('timestamp', String(ts));
  return url.toString();
}
function isOnMonthView() { return /\/calendar\/month/.test(location.pathname); }

// ===== ENFORCER: keep forcing month view until it sticks =====
function startMonthEnforcer(iso, durationMs = 4000, intervalMs = 250) {
  const target = buildMonthUrlForDate(iso);
  const t0 = Date.now();
  const id = setInterval(() => {
    if (isOnMonthView() && location.href.startsWith(target.split('?')[0])) { clearInterval(id); return; }
    if (Date.now() - t0 > durationMs) { clearInterval(id); return; }
    if (IMPORT_OPTIONS.mode !== 'highlight') { location.assign(target); }
  }, intervalMs);
}

// ===== Ensure month visible (may navigate) =====
async function ensureMonthVisibleForDate(iso) {
  const monthUrl = buildMonthUrlForDate(iso);
  if (monthUrl && monthUrl !== location.href) {
    if (currentJob) { currentJob.resumeAfterNav = true; currentJob.nextIso = iso; saveJob(currentJob); }
    if (IMPORT_OPTIONS.mode !== 'highlight') location.assign(monthUrl);
    startMonthEnforcer(iso);
    updateStatus({ navigating: true, target: monthUrl });
    updateProgressDialog(currentJob?.index || 0, (currentJob?.rows||[]).length, 'Navigating…');
    return "NAVIGATING";
  }
  const ready = await waitFor(() =>
    getVisibleMonthGrids()[0] || q(document, SELECTORS.newEventBtn),
    { timeout: 12000, interval: 120 }
  );
  return !!ready;
}

// ===== go to date in month view =====
async function goToCalendarDate(iso) {
  if (!iso) return false;
  const vis = await ensureMonthVisibleForDate(iso);
  if (vis === "NAVIGATING") return "NAVIGATING";
  if (!vis) { console.warn('[Bulk Import] Month grid not found on page.'); return false; }

  const [y, m] = iso.split('-').map(Number);
  const target = { y, m };
  const cur = currentMonthComparable();
  if (cur && (cur.y !== y || cur.m !== m)) {
    await clickMonthNavTowards(target, 4);
    await sleep(150);
  }

  let cell = findDayCellInMonthGrid(iso);
  if (!cell) {
    for (let i=0;i<6 && !cell;i++) {
      const next = q(document, SELECTORS.monthNext) || document.querySelector('button[aria-label*="Next" i]');
      if (!next) break;
      if (IMPORT_OPTIONS.mode !== 'highlight') next.click();
      await sleep(140);
      cell = findDayCellInMonthGrid(iso);
    }
    for (let i=0;i<12 && !cell;i++) {
      const prev = q(document, SELECTORS.monthPrev) || document.querySelector('button[aria-label*="Prev" i], button[aria-label*="Previous" i]');
      if (!prev) break;
      if (IMPORT_OPTIONS.mode !== 'highlight') prev.click();
      await sleep(140);
      cell = findDayCellInMonthGrid(iso);
    }
  }

  if (!cell) { console.warn('[Bulk Import] Could not find day cell for', iso); return false; }
  mark(cell);
  if (IMPORT_OPTIONS.mode !== 'highlight') clickHard(cell);
  await sleep(180);
  return true;
}

// ===== wait for any of several selectors =====
async function waitAndGet(scope, selectorOrArray, timeout = 12000) {
  const selectors = Array.isArray(selectorOrArray) ? selectorOrArray : [selectorOrArray];
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const node = (scope || document).querySelector(sel);
      if (node) return node;
    }
    await sleep(120);
  }
  return null;
}

// ===== generic fill helpers =====
function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}
async function fillAnyText(scope, elOrSel, text) {
  const el = typeof elOrSel === 'string' ? (scope || document).querySelector(elOrSel) : elOrSel;
  if (!el) { console.warn(`Missing field (any text): ${elOrSel}`); return; }
  mark(el);
  if (IMPORT_OPTIONS.mode === 'highlight') return;

  if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
    const sel = window.getSelection();
    const range = document.createRange();
    el.focus();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text ?? '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.focus();
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setNativeValue(el, text ?? '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }
}
async function fillInput(scope, selOrEl, value, maxTries = 3) {
  const el = typeof selOrEl === 'string' ? q(scope, selOrEl) : selOrEl;
  if (!el) { console.warn(`Missing field: ${selOrEl}`); return false; }
  mark(el);
  if (IMPORT_OPTIONS.mode === 'highlight') return;
  for (let i = 0; i < maxTries; ++i) {
    el.focus();
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setNativeValue(el, value ?? '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    await sleep(120);
  if (el.value === value) return true;
    await sleep(200);
  }
  console.warn(`Field value not reliably set after retries: ${selOrEl}`);
  return false;
}

// ===== Type like a human (for Opponent) =====
async function typeLikeUser(el, text) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return;

  el.focus();
  // clear
  el.select?.();
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: '' }));
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));

  // type char by char
  for (const ch of String(text)) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    el.value += ch;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    el.dispatchEvent(new KeyboardEvent('keyup',   { key: ch, bubbles: true }));
    await new Promise(r => setTimeout(r, 5));
  }

  // commit
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

// ===== Save / Finish helpers =====
function isClickableNode(el) {
  if (!el) return false;
  const st = getComputedStyle(el);
  const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
  return !disabled && st.display !== 'none' && st.visibility !== 'hidden';
}
async function clickSaveIfPresent(scope) {
  const textMatch = (t) => /^(save|create|publish|next|add|done|continue)$/i.test(t.trim());
  const findCandidates = () => {
    const nodes = qa(scope, 'button, [role="button"], [type="submit"], [data-testid]');
    return nodes.filter(n => {
      const txt = (n.textContent || n.getAttribute('aria-label') || '').trim();
      return txt && textMatch(txt);
    });
  };
  let cand = findCandidates().find(isClickableNode);
  const attrCandidates = qa(scope, 'button[data-testid*="save" i], [data-testid*="save" i], button[type="submit"]');
  cand = cand || attrCandidates.find(isClickableNode);
  if (!cand) return false;
  mark(cand);
  if (IMPORT_OPTIONS.mode === 'highlight') return true;
  (cand.closest('button,[role="button"]') || cand).scrollIntoView({block:'center'});
  await sleep(80);
  clickHard(cand.closest('button,[role="button"]') || cand);
  await sleep(300);
  return true;
}
async function clickFinishIfPresent(scope) {
  let btn = (scope || document).querySelector(SELECTORS.confirmFinishBtn);
  if (!btn) {
    btn = [...(scope || document).querySelectorAll('button, [role="button"]')]
      .find(b => (b.textContent || '').trim().toLowerCase() === 'finish');
  }
  if (!btn) return false;
  mark(btn);
  if (IMPORT_OPTIONS.mode === 'highlight') return true;
  clickHard(btn);
  await sleep(200);
  return true;
}

// ===== Robust Home/Away selection (fieldset + label + radio) =====
function normalizeHomeAway(val) {
  if (!val) return null;
  const s = String(val).trim().toLowerCase();
  if (s.startsWith('h')) return 'home';
  if (s.startsWith('a')) return 'away';
  if (s.includes('home')) return 'home';
  if (s.includes('away')) return 'away';
  return null;
}
function setRadioChecked(input) {
  try {
    input.checked = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {}
}
function setHomeAway(scope, val) {
  const want = normalizeHomeAway(val);
  if (!want) return false;
  const root = scope || document;

  // Find a fieldset that clearly contains both Home and Away labels
  const fieldsets = [...root.querySelectorAll('fieldset')];
  const fs = fieldsets.find(f => {
    const labels = [...f.querySelectorAll('label')].map(l => (l.textContent || '').trim().toLowerCase());
    return labels.includes('home') && labels.includes('away');
  });
  if (!fs) { console.warn('[Bulk Import] Home/Away fieldset not found'); return false; }

  // Each option wrapper contains: input[type=radio] + icon(svg) + label
  const items = [...fs.querySelectorAll('input[type="radio"]')].map(inp => {
    const wrap = inp.closest('[class]') || inp.parentElement || fs;
    const labelEl = wrap.querySelector('label');
    const icon = wrap.querySelector('svg')?.closest('div,span,button,[role="button"],[role="radio"]');
    const text = (labelEl?.textContent || '').trim().toLowerCase();
    return { wrap, input: inp, labelEl, icon, text };
  }).filter(x => x.labelEl);

  if (!items.length) { console.warn('[Bulk Import] Home/Away radios found, but labels missing'); return false; }

  const target = items.find(it => it.text === want) || items.find(it => it.text.includes(want));
  if (!target) { console.warn('[Bulk Import] Could not match Home/Away option:', want); return false; }

  // Visual hint
  mark(target.wrap); if (target.icon) mark(target.icon); if (target.labelEl) mark(target.labelEl);
  if (IMPORT_OPTIONS.mode === 'highlight') return true;

  // 1) Click the radio input (if visible)
  try {
    const r = target.input.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      target.input.click();
      setRadioChecked(target.input);
      return true;
    }
  } catch {}

  // 2) Click the icon (dot) next to the label
  if (target.icon) {
    clickHard(target.icon);
    setRadioChecked(target.input);
    return true;
  }

  // 3) Click the label text wrapper
  if (target.labelEl) {
    target.labelEl.click();
    setRadioChecked(target.input);
    return true;
  }

  // 4) Programmatic final resort
  setRadioChecked(target.input);
  return true;
}

// ===== open form (after day is selected) =====
async function openNewEventAndGetScope() {
  const oldUrl = location.href;
  q(document, SELECTORS.newEventBtn)?.click();
  refreshStoredPrefixFromLocation();

  const gameDot = await waitFor(() => q(document, SELECTORS.gameMenuDot), { timeout: 3000 });
  if (gameDot) {
    (gameDot.closest(SELECTORS.gameMenuAnchor) || gameDot).click();
    console.log('[Bulk Import] Clicked Game via eventtype="match".');
  } else {
    const items = qa(document, 'a[data-testid="context_menu.item"], [role="menuitem"], a, button');
    const item = items.find(el => /^(game|match)$/i.test((el.textContent || '').trim())) ||
                 items.find(el => /game|match/i.test((el.textContent || '').trim()));
    if (item) { if (IMPORT_OPTIONS.mode !== 'highlight') item.click(); console.log('[Bulk Import] Clicked Game/Match by text.'); }
    else { console.warn('[Bulk Import] Create menu: could not find Game/Match item.'); }
  }

  const navChanged = await waitFor(() => location.href !== oldUrl, { timeout: 6000 });
  if (navChanged) console.log('[Bulk Import] URL changed → full-page form likely.');

  const dialog = await waitFor(() => q(document, SELECTORS.dialog), { timeout: 1500 });
  if (dialog) { console.log('[Bulk Import] Dialog detected; scoping to dialog.'); return dialog; }

  const scopeReady = await waitFor(() =>
      q(document, SELECTORS.fields.title) ||
      q(document, SELECTORS.fields.location) ||
      q(document, 'input[type="time"]'),
    { timeout: 12000 }
  );
  if (scopeReady) { console.log('[Bulk Import] Full-page form detected; using document scope.'); return document; }

  console.warn('[Bulk Import] Form did not appear; using document scope anyway.');
  return document;
}

// ===== Opponent helpers (find & commit) =====
function findOpponentInput(scope) {
  const root = scope || document;
  // prefer explicit selectors, visible only
  let el = [...root.querySelectorAll(
    'input[data-testid="events.form.match.opponent"], input[name="opponentName"]'
  )].find(n => n.offsetWidth > 0 && n.offsetHeight > 0);
  if (el) return el;

  // fallback by fieldset/label
  const fs = [...root.querySelectorAll('fieldset')]
    .find(f => /opponent/i.test((f.textContent || '')));
  if (fs) {
    el = [...fs.querySelectorAll('input')].find(n => n.offsetWidth > 0 && n.offsetHeight > 0) || null;
    if (el) return el;
  }
  const lab = [...root.querySelectorAll('label')]
    .find(l => /opponent/i.test((l.textContent || '').trim()));
  if (lab) {
    const cont = lab.closest('fieldset,[class],section,div') || lab.parentElement;
    el = cont?.querySelector('input') || null;
  }
  return el || null;
}
async function commitOpponent(scope, value) {
  if (!value) return false;
  const el = findOpponentInput(scope);
  if (!el) { console.warn('Opponent input not found for commit'); return false; }
  mark(el);
  if (IMPORT_OPTIONS.mode === 'highlight') return true;
  await typeLikeUser(el, value);
  await sleep(120); // give React a beat to capture state
  return true;
}

// ===== field filling =====
async function fillCommonFields(scope, row) {
  if (row.title) {
    const titleEl = await waitAndGet(scope, [
      SELECTORS.fields.title,
      'input[placeholder="Event title"]',
      '[contenteditable="true"][role="textbox"]'
    ], 12000);
    if (titleEl) await fillAnyText(scope, titleEl, row.title);
    else console.warn('Missing field (title) after wait.');
  }

  if (row.location) {
    const locEl = await waitAndGet(scope, [
      SELECTORS.fields.location,
      'input[placeholder="Location"]'
    ], 12000);
    if (locEl) await fillAnyText(scope, locEl, row.location);
    else console.warn('Missing field (location) after wait.');
  }

  if (row.notes) {
    const notesEl = await waitAndGet(scope, [
      SELECTORS.fields.notes,
      'textarea',
      '[contenteditable="true"][role="textbox"]'
    ], 8000);
    if (notesEl) await fillAnyText(scope, notesEl, row.notes);
    else console.warn('Missing field (notes) after wait.');
  }

  const timeInputs = qa(scope, 'input[type="time"]');
  if (row.start_time && timeInputs[0]) await fillInput(scope, timeInputs[0], row.start_time, 3);
  if (row.end_time   && timeInputs[1]) await fillInput(scope, timeInputs[1],   row.end_time, 3);

  if (row.meet_before != null && row.meet_before !== '') {
    const meetEl = await waitAndGet(scope, 'input[name="meetBeforeMinutes"][type="number"]', 6000);
  if (meetEl) await fillInput(scope, meetEl, String(row.meet_before), 3);
    else console.warn('Missing field (meetBefore) after wait.');
  }

  if (row.visibility) {
    const ok = await setSelectByLabel(scope, 'Visibility', row.visibility);
    if (!ok) console.warn('Visibility select not found yet; maybe mounts later.');
  }
}

// Simple checkbox/radio label toggles (used for add_admins / add_players)
function toggleByLabel(scope, text, desired = true) {
  // Map label text to checkbox name
  const nameMap = {
    'Add new admins/staff as organizers to this event': 'autoInviteAdminAndStaff',
    'Add new players as participants to this event': 'autoInviteUsers'
  };
  const name = nameMap[text];
  if (name) {
    const input = (scope || document).querySelector(`input[type="checkbox"][name="${name}"]`);
    if (input) {
      mark(input);
      if (IMPORT_OPTIONS.mode !== 'highlight') {
        if (input.checked !== desired) {
          input.click();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return true;
    }
  }
  // Fallback: original logic
  const lab = findLabelByText(scope, text);
  if (lab) {
    const htmlFor = lab.getAttribute('for');
    let input = htmlFor ? (scope || document).getElementById(htmlFor) : null;
    if (!input) {
      input = lab.querySelector('input[type="checkbox"]') ||
              lab.parentElement?.querySelector('input[type="checkbox"]');
    }
    if (input) {
      mark(input);
      if (IMPORT_OPTIONS.mode !== 'highlight') {
        if (input.checked !== desired) {
          input.click();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return true;
    }
    if (IMPORT_OPTIONS.mode !== 'highlight') lab.click();
    return true;
  }
  return false;
}

async function fillGameFields(scope, row) {
  // 1) Home/Away FIRST (radio flip can re-render)
  if (row.home_away) {
    await sleep(50);
    const ok = setHomeAway(scope, row.home_away);
    if (!ok) console.warn('Home/Away not set – selector fallback failed.');
    await sleep(150);
  }

  // 2) Opponent
  if (row.opponent) {
    await commitOpponent(scope, row.opponent);
    await sleep(120); // Give React a beat to capture state
  }

  // 3) Kickoff time
  if (row.kickoff_time) {
    const trySetKickoff = async (container, value, maxTries = 3) => {
      for (let i = 0; i < maxTries; ++i) {
        const koEl = await waitAndGet(container, [
          SELECTORS.game.kickoff,
          'input[name="time"][type="time"]'
        ], 8000);
        if (koEl) {
          await fillInput(container, koEl, value);
          await sleep(120);
          // Verify value
          if (koEl.value === value) return true;
        }
        await sleep(200);
      }
      console.warn('Kickoff time not reliably set after retries.');
      return false;
    };
    await trySetKickoff(scope, row.kickoff_time, 3);
  }

  // 4) Duration (AFTER opponent and kickoff)
  if (row.duration) {
    const durEl = await waitAndGet(scope, 'input[name="duration"][type="number"]', 8000);
  if (durEl) await fillInput(scope, durEl, String(row.duration), 3);
    else console.warn('Missing field (duration) after wait.');
    await sleep(120);
  }

  // 5) Admin/player toggles
  if (row.add_admins != null) {
    toggleByLabel(scope, 'Add new admins/staff as organizers to this event',
      String(row.add_admins).toLowerCase() === 'true');
  }
  if (row.add_players != null) {
    toggleByLabel(scope, 'Add new players as participants to this event',
      String(row.add_players).toLowerCase() === 'true');
  }
}

// ===== main per-row flow =====
async function createOne(row) {
  // 1) Select date in month grid (this may navigate)
  let iso = null;
  if (row.date) iso = toIsoDate(row.date);
  if (iso) {
    const res = await goToCalendarDate(iso);
    if (res === "NAVIGATING") return "NAVIGATING";
    if (!res) console.warn('[Bulk Import] Proceeding without pre-selecting day; form may default to today.');
  } else {
    console.warn('[Bulk Import] No/invalid "date" in CSV; using portal default.');
  }

  // 2) Open Game form
  const scope = await openNewEventAndGetScope();
  await sleep(250);

  // 3) Default title if missing
  if (!row.title) row.title = (row.opponent ? `Match vs ${row.opponent}` : (row.type || 'Game'));

  // 4) Fill fields
  await fillCommonFields(scope, row);
  await fillGameFields(scope, row);

  // 4b) Final Opponent commit just before saving (some UIs re-render on focus/scroll)
  if (row.opponent) {
    await commitOpponent(scope, row.opponent);
  }

  // 4c) Final Kickoff time commit just before saving (some UIs re-render on focus/scroll)
  if (row.kickoff_time) {
    const trySetKickoff = async (container, value, maxTries = 3) => {
      for (let i = 0; i < maxTries; ++i) {
        const koEl = await waitAndGet(container, [
          SELECTORS.game.kickoff,
          'input[name="time"][type="time"]'
        ], 3000);
        if (koEl) {
          await fillInput(container, koEl, value);
          await sleep(120);
          if (koEl.value === value) return true;
        }
        await sleep(200);
      }
      console.warn('Kickoff time not reliably set after retries.');
      return false;
    };
    await trySetKickoff(scope, row.kickoff_time, 3);
  }

  // 4d) Final Duration commit just before saving
  if (row.duration) {
    const durEl = await waitAndGet(scope, 'input[name="duration"][type="number"]', 3000);
  if (durEl) await fillInput(scope, durEl, String(row.duration), 3);
  }

  // 5) Save + Finish confirm
  if (IMPORT_OPTIONS.mode !== 'full') {
    showBanner(IMPORT_OPTIONS.mode === 'type' ? "Type-only: Save skipped" : "Highlight-only: Save skipped");
    return true;
  }

  const clickedSave = await clickSaveIfPresent(scope);
  if (!clickedSave) console.warn('[Bulk Import] Save button not found/clickable; attempting Finish (if any).');

  // If the form stays visible for a moment, re-commit kickoff time and duration only
  if (row.kickoff_time) {
    const trySetKickoff = async (container, value, maxTries = 3) => {
      for (let i = 0; i < maxTries; ++i) {
        const koEl = await waitAndGet(container, [
          SELECTORS.game.kickoff,
          'input[name="time"][type="time"]'
        ], 3000);
        if (koEl) {
          await fillInput(container, koEl, value);
          await sleep(120);
          if (koEl.value === value) return true;
        }
        await sleep(200);
      }
      console.warn('Kickoff time not reliably set after retries.');
      return false;
    };
    await trySetKickoff(scope, row.kickoff_time, 3);
  }
  if (row.duration) {
    const durEl = await waitAndGet(scope, 'input[name="duration"][type="number"]', 3000);
    if (durEl) await fillInput(scope, durEl, String(row.duration));
  }

  await sleep(600);

  const clickedFinish = await clickFinishIfPresent(document);
  if (clickedFinish) {
    // Last chance kickoff time and duration commit
    if (row.kickoff_time) {
      const trySetKickoff = async (container, value, maxTries = 3) => {
        for (let i = 0; i < maxTries; ++i) {
          const koEl = await waitAndGet(container, [
            SELECTORS.game.kickoff,
            'input[name="time"][type="time"]'
          ], 3000);
          if (koEl) {
            await fillInput(container, koEl, value);
            await sleep(120);
            if (koEl.value === value) return true;
          }
          await sleep(200);
        }
        console.warn('Kickoff time not reliably set after retries.');
        return false;
      };
      await trySetKickoff(document, row.kickoff_time, 3);
    }
    if (row.duration) {
      const durEl = await waitAndGet(document, 'input[name="duration"][type="number"]', 3000);
    if (durEl) await fillInput(document, durEl, String(row.duration), 3);
    }
    await sleep(600);
  }

  // Progress bump
  try {
    if (currentJob) {
      updateProgressDialog((currentJob.index ?? 0) + 1, (currentJob.rows || []).length, 'Saved');
      updateStatus({ saved: true, indexDone: (currentJob.index ?? 0) + 1, total: (currentJob.rows||[]).length, navigating: false });
    }
  } catch {}

  // Nudge back to month view for the same day
  const oldHref = location.href;
  await sleep(250);
  await waitFor(() => location.href !== oldHref, { timeout: 1500 });
  if (iso) startMonthEnforcer(iso);
  return true;
}

// ===== validate =====
function validateSelectors() {
  const report = [
    { field: 'Month grid visible (heuristic or role)', ok: !!getVisibleMonthGrids()[0] },
    { field: 'New event button', ok: !!q(document, SELECTORS.newEventBtn) },
    { field: 'Game menu (eventtype="match")', ok: !!q(document, SELECTORS.gameMenuDot) },
  ];
  console.table(report);
  showBanner("Validation complete (see console)");
}

// ===== simple CSV fallback =====
function simpleCsvParse(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length);
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i], nx = line[i+1];
      if (ch === '"' && inQ && nx === '"') { cur += '"'; i++; continue; }
      if (ch === '"' ) { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { out.push(cur); cur=''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = (vals[i] ?? '').trim());
    return row;
  });
}

// ===== Job runner =====
async function runJobFromCurrentIndex() {
  if (!currentJob) return;
  setImportOptions(currentJob.options || {});
  const rows = currentJob.rows || [];

  for (; currentJob.index < rows.length; currentJob.index++) {
    saveJob(currentJob);

    updateStatus({ started: true, index: currentJob.index, total: rows.length, navigating: false, error: null });
    updateProgressDialog(currentJob.index, rows.length, 'Working…');

    const row = rows[currentJob.index];
    const res = await createOne(row);

    if (res === "NAVIGATING") {
      console.log('[Bulk Import] Navigating… will resume at index', currentJob.index);
      return;
    }

    // If more rows, hop back to month for next row’s date (or reuse this row’s date)
    const hasMore = currentJob.index < rows.length - 1;
    if (hasMore) {
      const nextRow = rows[currentJob.index + 1] || {};
      const targetIso = toIsoDate(nextRow.date || row.date || new Date().toISOString().slice(0,10));

      currentJob.index += 1;
      currentJob.resumeAfterNav = true;
      currentJob.nextIso = targetIso;
      saveJob(currentJob);

      if (IMPORT_OPTIONS.mode !== 'highlight') {
        const monthUrl = buildMonthUrlForDate(targetIso);
        updateStatus({ navigating: true, target: monthUrl });
        updateProgressDialog(currentJob.index, rows.length, 'Navigating…');
        location.assign(monthUrl);
        startMonthEnforcer(targetIso);
      }
      return;
    }
  }

  console.log('[Bulk Import] All rows done.');
  showBanner('Done.');
  closeProgressDialog(`All events added: ${(rows || []).length}/${(rows || []).length}`);
  updateStatus({ finished: true, navigating: false });
  clearJob();
  window.__bulkLastRun = { finished: true, at: Date.now() };
  // Send explicit message to popup to trigger UI update
  try {
    chrome.runtime.sendMessage({ type: 'TEAM_BULK_FINISHED', payload: { finished: true, total: (rows || []).length } });
  } catch (e) { console.warn('Could not send TEAM_BULK_FINISHED message:', e); }
}

// ===== Resume after navigation =====
(function bootstrapResume() {
  const pending = loadJob();
  if (pending && pending.resumeAfterNav) {
    console.log('[Bulk Import] Resuming job after navigation…');
    currentJob = pending;
    saveJob(currentJob);

    if (MANUAL_GROUP_PREFIX) setStoredPrefix(MANUAL_GROUP_PREFIX.replace(/\/$/, ''));
    else refreshStoredPrefixFromLocation() || setStoredPrefix(discoverPrefixFromAnchors() || getStoredPrefix());

    const iso = toIsoDate(currentJob.nextIso) ||
                toIsoDate(currentJob.rows?.[currentJob.index]?.date) ||
                new Date().toISOString().slice(0,10);

    updateStatus({ resumed: true, navigating: false });

    if (!isOnMonthView()) {
      const monthUrl = buildMonthUrlForDate(iso);
      if (IMPORT_OPTIONS.mode !== 'highlight') {
        location.replace(monthUrl);
        startMonthEnforcer(iso);
        updateStatus({ navigating: true, target: monthUrl });
        updateProgressDialog(currentJob.index || 0, (currentJob.rows||[]).length || 0, 'Navigating…');
        return;
      }
    }

    currentJob.resumeAfterNav = false;
    delete currentJob.nextIso;
    saveJob(currentJob);
    runJobFromCurrentIndex();
  }
})();

// ===== Message handlers (start + status) =====
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "TEAM_BULK_IMPORT") return false;
  try { sendResponse({ ok: true, started: true }); } catch {}

  queueMicrotask(async () => {
    try {
      const rows = (window.Papa && Papa.parse)
        ? Papa.parse(msg.payload.csv, { header: true, skipEmptyLines: true }).data
        : simpleCsvParse(msg.payload.csv);

      const normalized = (rows || []).map(r => { if (r.date) r.date = toIsoDate(r.date); return r; });

      const mode = (msg?.payload?.options?.mode) || IMPORT_OPTIONS.mode || 'full';
      currentJob = { rows: normalized, options: { ...msg?.payload?.options, mode }, index: 0, resumeAfterNav: false };
      saveJob(currentJob);

      if (MANUAL_GROUP_PREFIX) setStoredPrefix(MANUAL_GROUP_PREFIX.replace(/\/$/, ''));
      else refreshStoredPrefixFromLocation() || setStoredPrefix(discoverPrefixFromAnchors() || getStoredPrefix());

      showBanner(
        mode === 'highlight' ? 'Mode: Highlight only' :
        mode === 'type'      ? 'Mode: Type only (no save)' :
                               'Mode: Full run (type + save)'
      );
      setImportOptions({ mode });

      const total = (currentJob.rows || []).length || 0;
      openProgressDialog(total);
      updateProgressDialog(0, total, 'Starting…');

      if (currentJob.options.validateOnly) {
        validateSelectors();
        closeProgressDialog('Validation complete');
        clearJob();
        window.__bulkLastRun = { finished: true, at: Date.now() };
        return;
      }

      await runJobFromCurrentIndex();
    } catch (err) {
      console.error('[Bulk Import] Fatal:', err);
      updateStatus({ finished: true, error: String(err), navigating: false });
      closeProgressDialog('Failed — check the page');
      showBanner('Failed.');
      clearJob();
    }
  });

  return false;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'TEAM_BULK_STATUS') {
    try { sendResponse(window.__bulkLastRun || { finished: false }); } catch {}
    return false;
  }
  return false;
});
