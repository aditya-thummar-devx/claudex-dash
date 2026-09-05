// One fetch, five panels, no framework. Each panel renders native HTML when its parser recognised
// claudex's output, and the raw CLI text otherwise — so a claudex update degrades the page to
// plain text rather than showing numbers we can no longer trust.

import { arrange, SORTS } from "./sort.js";
import { mineTarget } from "./mine.js";
import { consumingTarget } from "./consuming.js";
import { autoswitchTarget } from "./autoswitch.js";
import { TREE, childKind, namesFor, findNode, cliFor } from "./playground.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Every message and error goes here — none of them occupy layout space, so a switch result or a
// parse warning cannot shove the cards it sits above. The container is a popover, which puts it in
// the top layer: a plain fixed div would be buried under the detail <dialog>'s backdrop. A <button>
// per toast, not a <div>, so dismissing is keyboard-reachable without a hand-rolled key handler.
//
// `key` is for messages that repeat: one per panel on every refresh. A keyed toast replaces its
// predecessor instead of stacking a fifth identical copy. Unkeyed toasts (the switch result) are
// left alone by everything, which is what lets the success message outlive the load() it triggers.
const toasts = $("toasts");
const dropToast = (key) => toasts.querySelector(`[data-key="${key}"]`)?.remove();

// ---------- boot gate ----------
// Holds the page until the first successful load. Without it, a machine where claudex is missing or
// logged out paints four empty panels and stacks four error toasts, which reads as a broken
// dashboard rather than as "install claudex". See index.html for why it is non-modal.
const gate = $("gate");
const gateBody = (html) => (gate.querySelector(".body").innerHTML = html);

// claudex's own words, verbatim: they explain a missing binary or an expired token far better than
// anything written here, and at this point they are the only thing on screen.
function gateFail(text) {
  $("age").textContent = "failed";
  gateBody(`<pre class="raw">${esc(text)}</pre><p class="gate-a"><button>Retry</button></p>`);
  const b = gate.querySelector("button");
  // Swapping the body back also deletes this button, which is what stops a second click landing
  // while the first request is still in flight — load() has no re-entrancy guard of its own.
  b.onclick = () => {
    gateBody(`<p class="note">reading claudex…</p>`);
    load(true);
  };
  b.focus(); // focus is on the dialog itself; move it so the change is announced and reachable
}

function toast(text, bad = false, key = "") {
  if (key) dropToast(key);
  const el = document.createElement("button");
  el.className = `toast${bad ? " bad" : ""}`;
  el.dataset.key = key;
  el.textContent = text;
  el.title = "dismiss";
  el.onclick = () => el.remove();
  // The top layer is ordered by insertion, so a container shown before showModal() sits UNDER the
  // dialog. Re-entering it on every toast is what keeps a message visible over an open dialog.
  if (toasts.matches(":popover-open")) toasts.hidePopover();
  toasts.showPopover();
  toasts.append(el); // after showing: a live region must be rendered when it mutates to announce
  // Errors stay until dismissed — claudex's own error text is long and worth reading.
  if (!bad) setTimeout(() => el.remove(), 4000);
}

// Thresholds match the CLI's own legend: █ <50%  █ <80%  █ ≥80%
const level = (pct) => (pct >= 80 ? "danger" : pct >= 50 ? "warn" : "");

// A null pct means claudex had no reading ("—"), which is NOT the same as 0% — render it as
// unknown so an account with unknown usage never looks idle.
//
// `plain` drops the level() colour. The warn/danger thresholds mean rate-limit headroom, and the
// driver bars in a member breakdown are share-of-traffic — painting a 92% share red would assert
// something false. `label` and `g.at` are spliced in as HTML, so callers esc() them.
function gauge(label, g, plain = false) {
  if (!g || g.pct === null) {
    return `<div class="gauge"><span class="lbl">${label}</span>
      <span class="nodata">no reading</span><span></span><span></span></div>`;
  }
  return `<div class="gauge">
    <span class="lbl">${label}</span>
    <span class="bar ${plain ? "" : level(g.pct)}"><i style="width:${g.pct}%"></i></span>
    <span class="pct">${g.pct}%</span>
    <span class="at">${esc(g.at ?? "")}</span>
  </div>`;
}

// "no data" stays inline: it stands in for panel content rather than commenting on it, and a toast
// would leave a blank panel behind. The parse failure is the opposite — the raw text below IS the
// content, so the warning about it goes to a toast keyed on the panel. dropToast runs on every
// path, so a panel that starts parsing again clears its own stale warning.
function render(id, p, html) {
  const box = $(id).querySelector(".body");
  dropToast(id);
  if (!p) return (box.innerHTML = `<p class="fallback">no data</p>`);
  if (!p.ok) {
    toast(`${id}: ${p.error || "unrecognised output"} — showing raw claudex output`, true, id);
    box.innerHTML = `<pre class="raw">${esc(p.raw.trim() || "(empty)")}</pre>`;
    return;
  }
  box.innerHTML = html(p.data);
}

// One card shape serves both Usage and Pool members — they differ only in whether the dot is lit,
// and whether there is a net badge.
//
// `sel` and `on` are separate flags on purpose: `sel` tints the whole card (selection), `on` lights
// the dot. On Usage both come from `active`, but on Pool the dot is `sharing` — serving the pool,
// not "you are here" — so collapsing them would show the wrong card as selected.
//
// Takes already-escaped HTML fragments, not raw text: `badge` is markup. Callers must esc() the
// claudex-derived values themselves — those are account and coworker names coming out of a CLI we
// do not control.
//
// `actions` goes below the gauges, not in the header: .card-h .net already takes the header's slack
// via margin-left:auto, so a button up there would be shoved against the badge.
// A panel can render zero rows without anything being wrong: the 5x filter simply matched
// nothing. Reuses render()'s no-data class so the two empty states look the same.
const EMPTY = `<p class="fallback">no rows match the current filter</p>`;

const card = ({ on, sel, name, meta, badge = "", gauges, actions = "" }) =>
  `<article class="card${sel ? " sel" : ""}">
    <header class="card-h">
      <span class="dot ${on ? "on" : "off"}">●</span>
      <span class="name">${name}</span>
      <span class="plan">${meta}</span>
      ${badge}
    </header>
    <div class="gauges">${gauges}</div>
    ${actions}
  </article>`;

const usageHtml = (rows) =>
  !rows.length
    ? EMPTY
    : `<div class="cards">${rows
    .map((r) =>
      card({
        on: r.active,
        sel: r.active,
        name: esc(r.account),
        meta: esc(r.tier),
        gauges: gauge("session", r.session) + gauge("week", r.week),
        // Nothing to do on the account you are already on — no account to switch to, and removing
        // your own active profile is one you'd want to switch off of first — so both buttons are
        // skipped there. card() defaults actions to "", so this leaves no empty .card-actions behind.
        // push-left (same class poolHtml's accessBtn uses) puts Remove on the left with auto-margin
        // space to Switch, and data-kind="remove" gets the same destructive red as Deny/Stop/Off in
        // the scifi theme — Remove reads as the same kind of action, not a one-off style.
        actions: r.active
          ? ""
          : `<div class="card-actions">
               <button class="push-left" data-kind="remove" data-name="${esc(r.account)}" title="${esc(cliFor("remove", r.account))}">Remove</button>
               <button data-kind="switch" data-name="${esc(r.account)}" title="${esc(cliFor("switch", r.account))}">Switch</button>
             </div>`,
      })
    )
    .join("")}</div>`;

// Allow/Deny used to be its own Access tab, keyed off a separate `claudex access` list
// (AccessPerson) rather than pool members. Same dotted-name namespace, different command,
// never cross-validated for correctness (see src/parse.ts) — so this map is a display-only
// lookup. The write still posts m.name to /api/access, which the server validates against
// the access list's own names, so a stale/missing match here can't cause a wrong write; it
// only decides whether a button is drawn at all.
const accessByName = () => {
  const m = new Map();
  for (const p of last?.access?.data ?? []) m.set(p.name, p.allowed);
  return m;
};

const poolHtml = (members) => {
  if (!members.length) return EMPTY;
  const access = accessByName();
  return `<div class="cards">${members
    .map((m) => {
      // One button per row, never two, same rule accessHtml used to follow: whichever action
      // would change state. No entry in the access list (access.has false) means nothing to
      // show — a button whose command can't run is worse than no button.
      const allowed = access.get(m.name);
      const accessBtn =
        allowed === undefined
          ? ""
          : allowed
          ? `<button class="push-left" data-kind="deny" data-name="${esc(m.name)}" title="${esc(cliFor("deny", m.name))}">Deny</button>`
          : `<button class="push-left" data-kind="allow" data-name="${esc(m.name)}" title="${esc(cliFor("allow", m.name))}">Allow</button>`;
      return card({
        on: m.sharing,
        sel: m.marked,
        name: esc(m.name),
        meta: esc(m.plan),
        badge:
          m.netM === null
            ? ""
            : `<span class="net ${m.netM >= 0 ? "pos" : "neg"}">${m.netM >= 0 ? "+" : ""}${m.netM}M</span>`,
        gauges: gauge("session", m.session) + gauge("week", m.week),
        // Only the Switch goes on the ▶ member — View Details still applies to everyone. `marked`
        // is claudex's ▶, whose exact meaning parse.ts:165 records as undocumented, so treating it
        // as "already serving you" is an inference. A safe one: the worst a wrong guess does is
        // hide a button whose command (`pool use` on the current member) is a no-op.
        // push-left (left) gets margin-right:auto in CSS, which shoves Switch/View Details to the
        // right — a space-between layout without a wrapper div, and one that collapses back to a
        // plain right-aligned row when accessBtn is "" (nothing to push against). Usage's Remove
        // button reuses the same class for the same reason.
        actions: `<div class="card-actions">
             ${accessBtn}
             ${m.marked ? "" : `<button data-kind="pool" data-name="${esc(m.name)}" title="${esc(cliFor("pool", m.name))}">Switch</button>`}
             <button class="detail" data-name="${esc(m.name)}">View Details</button>
           </div>`,
      });
    })
    .join("")}</div>`;
};

const statusHtml = (d) => `
  <div class="pills">
    <span class="pill ${d.status.consuming.on ? "on" : ""}">consuming ${d.status.consuming.on ? "on" : "off"}</span>
    <span class="pill ${d.status.sharing.on ? "on" : ""}">sharing ${d.status.sharing.on ? "on" : "off"}</span>
    <span class="pill">${esc(d.doctor.summary)}</span>
  </div>
  <div class="checks">
    ${d.doctor.checks
      .map(
        (c) => `<div><span class="${c.ok ? "" : "bad"}">${c.ok ? "✓" : "✗"}</span>
        <span>${esc(c.label)}</span><span class="d">${esc(c.detail)}</span></div>`
      )
      .join("")}
  </div>
  <p class="note">${esc(d.status.sharing.detail)}</p>`;

// The `pool member` breakdown, rendered into the dialog. Counts are the strings claudex printed —
// it rounded them already, so there is nothing here to reformat.
const flowRow = (f) => `<tr>
  <td class="lbl">${esc(f.label)}</td>
  <td>${esc(f.in)}</td><td>${esc(f.out)}</td>
  <td>${esc(f.cacheRead)}</td><td>${esc(f.cacheWrite)}</td><td>${esc(f.req)}</td>
  <td class="d">${esc(f.note)}</td>
</tr>`;

// The window's own bar IS headroom, so it keeps the colour thresholds; the driver bars below it are
// shares of that traffic, so they go plain. `note` is claudex's own line and is only shown when
// there are no drivers — otherwise it is just the "who drove your traffic:" heading.
const windowHtml = (w) => `<div class="window">
  ${gauge(esc(w.label), { pct: w.pct, at: w.resets ? `resets ${esc(w.resets)}` : "" })}
  ${
    w.drivers.length
      ? `<div class="drivers">${w.drivers
          .map((v) =>
            gauge(esc(v.name) + (v.you ? ` <span class="d">(you)</span>` : ""), { pct: v.pct, at: esc(v.tokens) }, true)
          )
          .join("")}</div>`
      : `<p class="note">${esc(w.note ?? "")}</p>`
  }
</div>`;

const memberHtml = (d) => `
  <table class="flows">
    <tr><th></th><th>in</th><th>out</th><th>cache r</th><th>cache w</th><th>req</th><th></th></tr>
    ${d.flows.map(flowRow).join("")}
  </table>
  <p class="net-line">
    <span class="lbl">net give/take</span>
    ${
      d.netM === null
        ? `<span class="nodata">no reading</span>`
        : `<span class="net ${d.netM >= 0 ? "pos" : "neg"}">${d.netM >= 0 ? "+" : ""}${d.netM}M</span>
           <span class="d">${esc(d.netDir ?? "")}</span>`
    }
  </p>
  <h3>usage split${d.splitNote ? ` <span class="d">· ${esc(d.splitNote)}</span>` : ""}</h3>
  ${d.windows.map(windowHtml).join("")}
  ${d.footnote ? `<p class="note">${esc(d.footnote)}</p>` : ""}`;

// Sorting is purely a view concern — /api/all hands back whatever order claudex printed and the
// panels re-render from the stashed payload, so a menu change never re-runs the CLI. Only the two
// row panels take the controls; status is passed through untouched.
const opts = () => ({ sort: $("sort").value, only5x: $("only5x").checked });
const HTML = {
  usage: (rows) => usageHtml(arrange(rows, opts())),
  pool: (members) => poolHtml(arrange(members, opts())),
  status: statusHtml,
};
const PANELS = Object.keys(HTML);
// Every tab, including Playground — which isn't backed by /api/all at all, so it stays out of
// PANELS (paint()/render()/flag()/setCount()/load() all iterate PANELS on purpose). ALL_TABS is the
// full nav order instead — Playground sits before Health, matching the markup — and is only used by
// the parts of the tab machinery that don't care what's behind a tab: show/hide, hash routing, and
// arrow-key navigation.
const ALL_TABS = ["usage", "pool", "playground", "status"];

// Tabs hide three of four panels, so a panel that fell back to raw text would otherwise be
// invisible. This puts that on the tab itself.
function flag(name, bad) {
  const tab = $(`tab-${name}`);
  const existing = tab.querySelector(".flag");
  if (bad && !existing) {
    tab.insertAdjacentHTML("beforeend", `<span class="flag" title="showing raw claudex output">\u26a0</span>`);
  } else if (!bad && existing) {
    existing.remove();
  }
}

// Panels differ in shape: usage/pool are bare arrays. Health is absent on purpose — its tab has no
// .count span, so setCount() no-ops there.
// The count is of what the panel actually shows: with the 5x filter on, "Pool (10)" above three
// cards would be a lie about the list under it.
const COUNT = {
  usage: (d) => arrange(d, opts()).length,
  pool: (d) => arrange(d, opts()).length,
};

// null means "no count": either the panel fell back to raw text, or it never had one. A panel we
// could not parse gets the ⚠ from flag() and no number — inventing a 0 there would assert a
// reading claudex never gave us.
function setCount(name, n) {
  const el = $(`tab-${name}`).querySelector(".count");
  if (el) el.textContent = n === null ? "" : ` (${n})`;
}

// The last /api/all payload, kept so a sort or filter change re-renders from memory. load() owns
// fetching; paint() owns turning whatever we last received into HTML.
let last = null;

function paint() {
  if (!last) return;
  for (const name of PANELS) {
    render(name, last[name], HTML[name]);
    flag(name, !last[name]?.ok);
    setCount(name, last[name]?.ok ? COUNT[name]?.(last[name].data) ?? null : null);
  }
  updateMine();
  updateConsuming();
  updateAutoswitch();
  // Playground's dynamic branches (Switch/Remove/Pool use/Pool member/Allow/Deny) read names live
  // off `last` at render time, so a fresh capture needs them redrawn — cheap, no network of its own.
  renderPgTree();
}

async function load(fresh) {
  const btn = $("refresh");
  btn.disabled = true;
  details.clear(); // numbers behind View Details must not outlive the gauges they sat next to
  $("age").textContent = "loading…";
  try {
    const r = await fetch(`/api/all${fresh ? "?fresh=1" : ""}`);
    const d = await r.json();

    // A missing claudex never reaches the catch below: capture() swallows spawn and timeout
    // failures into { raw: "", error } and the route still answers 200 with four ok:false panels.
    // So the gate's failure test lives here, and the catch only ever sees a dead server.
    //
    // `gate.open &&` is load-bearing rather than defensive. Once the gate has closed, an all-stale
    // refresh is ALSO every-panel-not-ok — capture() serves the stale raw with error "stale: …" —
    // and those cards must stay on screen. On the first load the cache is empty, so stale is
    // impossible and this can only be a real failure.
    //
    // Returning instead of rendering matters: four raw-text panels behind the gate would queue four
    // `bad` toasts, which never self-dismiss and are inert while the gate holds — unclickable
    // messages stacked over a gate that is never going to open.
    if (gate.open && PANELS.every((p) => !d[p]?.ok)) {
      const p = PANELS.map((k) => d[k]).find((x) => x?.raw?.trim() || x?.error);
      return gateFail([p?.error, p?.raw?.trim()].filter(Boolean).join("\n\n") || "no output");
    }

    last = d;
    paint();
    // PANELS, not Object.values(d): the payload also carries `me`, which is not a panel and is
    // null whenever CLAUDEX_ME is unset. Anything added beside the panels would break this too.
    const age = Math.max(...PANELS.map((k) => d[k]?.age ?? 0));
    $("age").textContent = age === 0 ? "just now" : `cached ${age}s ago`;
    dropToast("load");
    // First success only. A later total failure keeps the last-known cards with an error toast,
    // which is the same bargain src/claudex-dash.ts already strikes by serving stale rather than
    // nothing: an old number beats a blank page, as long as we say it is old.
    if (gate.open) {
      gate.close();
      $("hdr").removeAttribute("inert");
      $("tabbar").removeAttribute("inert");
      $("app").removeAttribute("inert");
      checkForUpdates(true); // fire-and-forget; this block runs exactly once, ever
    }
  } catch (e) {
    // The header slot only marks the state — it is styled like "cached 12s ago" and would bury the
    // reason. That goes to the toast, unless the gate is still up: a toast over it is painted but
    // inert, because top-layer participation controls painting, not interactivity.
    $("age").textContent = "failed";
    if (gate.open) gateFail(e.message);
    else toast(e.message, true, "load");
  } finally {
    btn.disabled = false;
  }
}

// ---------- tabs ----------
// Every panel arrives in one /api/all, so switching tabs is pure show/hide — never a refetch.
function show(name) {
  for (const p of ALL_TABS) {
    $(p).hidden = p !== name;
    $(`tab-${p}`).setAttribute("aria-selected", String(p === name));
  }
  // Health and Playground aren't lists at all, so the controls would order nothing on either.
  $("ctl").hidden = name !== "usage" && name !== "pool";
  updateMine(); // the tab decides which of the two commands "switch to mine" would run
}

// A stale or hand-typed hash must open Pool, not hide every panel.
const fromHash = () => {
  const h = decodeURIComponent(location.hash.slice(1));
  return ALL_TABS.includes(h) ? h : "pool";
};

// Every tab change goes through the hash, so clicks and browser back/forward share one code path.
const go = (name) => (location.hash = name);

for (const p of ALL_TABS) {
  const tab = $(`tab-${p}`);
  tab.addEventListener("click", () => go(p));
  // Roles and aria-selected without keyboard nav is a half-built tablist.
  tab.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = ALL_TABS[(ALL_TABS.indexOf(p) + step + ALL_TABS.length) % ALL_TABS.length];
    go(next);
    $(`tab-${next}`).focus();
  });
}
// ---------- pool member detail ----------
// `claudex pool member <name>` is one CLI run per person, so it is fetched only when asked for, not
// folded into /api/all. Delegated to the panel because render() replaces every card via innerHTML
// on each load(), which would drop per-button listeners.
const dlg = $("detail");
const rawBtn = $("detail-raw");
const refreshBtn = $("detail-refresh");
const details = new Map(); // name -> panel; cleared by load() so a refresh cannot pair a cached
let shown = null; //          breakdown with freshly pulled gauges. `shown` is what the toggle reads.
let openName = null; // which member the dialog is showing — the footer Refresh button's target

// One panel, two views. When the parser failed they are the same text, so the toggle is hidden
// rather than offering a switch that changes nothing.
//
// Keyed "member" because the raw toggle calls this again on the same payload — without the key a
// failed parse would stack a fresh toast on every press.
function fillDetail(p) {
  const raw = rawBtn.getAttribute("aria-pressed") === "true";
  rawBtn.hidden = !p.ok;
  if (!p.ok) toast(`${p.error || "unrecognised output"} — showing raw claudex output`, true, "member");
  dlg.querySelector(".body").innerHTML =
    p.ok && !raw ? memberHtml(p.data) : `<pre class="raw">${esc(p.raw.trim() || "(empty)")}</pre>`;
}

// Fetch (or reuse) one member's breakdown and paint the dialog from it. Both the open click and the
// footer's Refresh come through here; `fresh` is the only difference between them, and it bypasses
// BOTH caches — the details Map above, and the 60s capture cache behind /api/pool/member.
//
// Refreshing one member cannot refresh their Pool card: the gauges there come from `pool members`,
// which is one command for the whole list. So this deliberately leaves the cards alone, and the
// dialog ends up newer than the card behind it.
async function showMember(name, fresh) {
  // Also covers the open path, so Refresh cannot fire while the first fetch is still in flight —
  // the same one-button guard #refresh gives load().
  refreshBtn.disabled = true;
  refreshBtn.textContent = "refreshing…";
  try {
    if (fresh || !details.has(name)) {
      const r = await fetch(`/api/pool/member?name=${encodeURIComponent(name)}${fresh ? "&fresh=1" : ""}`);
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || `HTTP ${r.status}`);
      // Overwrites on the fresh path, so closing and reopening shows the refreshed numbers rather
      // than reverting to the ones Refresh was pressed to get rid of.
      details.set(name, p);
    }
    shown = details.get(name);
    const d = shown.ok ? shown.data : null;
    $("detail-name").textContent = (d?.marked ? "▶ " : "") + name;
    dlg.querySelector(".plan").textContent = d
      ? `${d.plan} · ${d.sharing ? "sharing" : "not sharing"} · ${d.state}`
      : "";
    fillDetail(shown);
  } catch (err) {
    // A failed REFRESH keeps what is already on screen: those numbers are stale, not wrong, and
    // closing would take away the breakdown someone was reading. A failed OPEN has nothing to keep,
    // so it still closes rather than leave an empty modal in the way of the toast explaining why.
    if (!fresh) {
      shown = null;
      dlg.close();
    }
    toast(err.message, true);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻ Refresh";
  }
}

$("pool").addEventListener("click", (e) => {
  const btn = e.target.closest("button.detail");
  if (!btn) return;
  openName = btn.dataset.name;

  // Open first, fill second: the request can take a second, and a button that does nothing until
  // then reads as broken.
  $("detail-name").textContent = openName;
  dlg.querySelector(".plan").textContent = "";
  rawBtn.setAttribute("aria-pressed", "false");
  rawBtn.textContent = "show raw";
  rawBtn.hidden = true;
  dlg.querySelector(".body").innerHTML = `<p class="note">loading…</p>`;
  dlg.showModal();

  showMember(openName, false);
});

// Direct listener, not delegated: this button is markup in index.html, so unlike the cards it
// outlives every innerHTML pass — same as #refresh and #mine.
refreshBtn.addEventListener("click", () => openName && showMember(openName, true));

rawBtn.addEventListener("click", () => {
  const raw = rawBtn.getAttribute("aria-pressed") !== "true";
  rawBtn.setAttribute("aria-pressed", String(raw));
  rawBtn.textContent = raw ? "show parsed" : "show raw";
  if (shown) fillDetail(shown);
});

// A click whose target is the dialog element itself landed on the backdrop — everything inside is a
// child. Esc, the ✕, and returning focus to the button are all native.
dlg.addEventListener("click", (e) => {
  if (e.target === dlg) dlg.close();
});

// ---------- switch ----------
// ---------- confirm ----------
// Every write asks first. See index.html for how Enter, Esc and the two buttons all work with no
// key handler; `close` is the one event all four exits funnel through, so one listener reads them all.
const cdlg = $("confirm");
const ask = (title, body, go) =>
  new Promise((resolve) => {
    $("confirm-title").textContent = title;
    $("confirm-body").textContent = body;
    $("confirm-go").textContent = go;
    // Esc closes WITHOUT touching returnValue, so a "go" left over from the previous confirm would
    // still be sitting there and the next Esc would read as a confirmation. Engines do clear it in
    // showModal(); this does not lean on that, because the failure mode is "Esc borrows a
    // coworker's quota".
    cdlg.returnValue = "";
    // once: a repeat ask must not stack listeners and resolve a stale promise.
    cdlg.addEventListener("close", () => resolve(cdlg.returnValue === "go"), { once: true });
    cdlg.showModal();
  });

// `switch` moves this machine between your OWN saved accounts. `pool use` points your traffic at a
// coworker's token — it spends their limit and lands in their breakdown as "borrowed". `access
// allow` / `access deny` point the other way: they change what a coworker may do to YOUR account.
// Different blast radius, so different words and a different button label; the three that involve
// another person name them on purpose, because the cost of a mis-click is paid by someone who is
// not at this keyboard.
const ASK = {
  switch: (n) => [
    "Switch account?",
    `Logs this machine into “${n}”. Claude Code sessions started after this use that account.`,
    "Switch",
  ],
  // Worded harder than everything else in this table on purpose: every other entry here is
  // reversible from this same page — this one is not. There is no undo from this page, and none
  // from the terminal either short of logging into that account again from scratch.
  remove: (n) => [
    `Remove ${n}?`,
    `Permanently deletes the “${n}” profile and its saved token. This cannot be undone from this page — you would need to log into ${n} again from scratch to get it back.`,
    "Remove",
  ],
  pool: (n) => [
    `Use ${n}’s quota?`,
    `Routes your Claude traffic through ${n}’s token instead of your own. Your usage counts against their limit and shows up as “borrowed” in their pool breakdown.`,
    "Borrow quota",
  ],
  // The direction reverses here: these two spend nothing of yours right now, they decide what
  // someone else may spend later. So the wording is about the grant, not about traffic.
  allow: (n) => [
    `Allow ${n}?`,
    `Lets ${n} borrow your account through the pool. Their Claude usage will then count against YOUR rate limit.`,
    "Allow",
  ],
  // Named as a cut-off rather than a setting, because that is what it is to the person on the other
  // end: claudex gives no warning and there is no grace period.
  deny: (n) => [
    `Block ${n}?`,
    `Stops ${n} borrowing your account. If they are running on your token right now, that ends.`,
    "Block",
  ],
  // `start`/`stop` are the odd ones out: no coworker's name anywhere in them. They flip whether
  // THIS account is currently borrowing from the shared pool via token-swap, reversible any time by
  // pressing the other one — closer in shape to a settings checkbox than to the four above. Kept
  // behind the same confirm dialog anyway, because the pool being borrowed from is still shared
  // capacity, not a resource this account owns outright.
  start: () => [
    "Start pool?",
    "Turns on token-swap: this account's Claude traffic routes through the shared pool token instead of its own. Reversible any time with Stop pool.",
    "Start",
  ],
  stop: () => [
    "Stop pool?",
    "Turns token-swap off. This account's traffic goes back to using its own token.",
    "Stop",
  ],
  // Same shape as start/stop: no coworker's name, a setting on this account only, reversible any
  // time by pressing the other one.
  on: () => [
    "Enable autoswitch?",
    "Claudex will automatically switch your active account when usage gets high, using whatever threshold/strategy is currently configured. Runs unattended — no dashboard confirmation per switch. Reversible any time with Disable autoswitch.",
    "Enable",
  ],
  off: () => [
    "Disable autoswitch?",
    "Turns off automatic account switching. You'll switch accounts yourself when usage gets high.",
    "Disable",
  ],
  // No coworker's name either — the parameter carries the target commit SHA instead, since that's
  // the one thing worth showing before pulling it.
  update: (sha) => [
    "Update available",
    `commit ${sha} is available. This pulls the latest code and restarts the server — it comes back up on its own.`,
    "Update now",
  ],
};

// Where each kind posts to, what it sends, and what to say when it lands. Split from ASK so that
// map's note about blast radius stays readable, and kept as a table because the four rows differ in
// exactly these three values and nothing else. Any new write is a row here plus a row in ASK.
const FIRE = {
  switch: (n) => ["/api/switch", { name: n }, `switched to ${n}`],
  remove: (n) => ["/api/remove", { name: n }, `${n} removed`],
  pool: (n) => ["/api/pool/use", { name: n }, `switched to ${n}`],
  allow: (n) => ["/api/access", { name: n, action: "allow" }, `${n} allowed`],
  deny: (n) => ["/api/access", { name: n, action: "deny" }, `${n} blocked`],
  // Done-messages echo the exact words statusHtml() renders on the Health pill ("consuming
  // on"/"consuming off"), so the toast previews exactly what that tab shows after load(true) re-runs.
  start: () => ["/api/pool/toggle", { action: "start" }, "consuming on"],
  stop: () => ["/api/pool/toggle", { action: "stop" }, "consuming off"],
  on: () => ["/api/autoswitch/toggle", { action: "on" }, "autoswitch on"],
  off: () => ["/api/autoswitch/toggle", { action: "off" }, "autoswitch off"],
  update: () => ["/api/update/apply", { action: "apply" }, "updated — restarting…"],
};

// Every write this page can make: `claudex switch <account>` from a Usage card, and `claudex pool
// use <member>` / `claudex access allow|deny <name>` both from a Pool card. Delegated on <main>
// rather than per button for the reason given above — load() replaces every panel via innerHTML,
// dropping element listeners. One listener covers both panels; the pool detail listener above stays
// separate because it opens a dialog and shares nothing with this.
//
// A function rather than the listener body because the header's "Switch to mine" needs exactly this
// sequence but sits OUTSIDE <main>, so the delegation below can never reach it.
// The POST half of every write, shared by doAction() (a real button) and the Playground tab (no
// button — just a history entry). Throws claudex's own explanation on failure rather than one made
// up here; callers decide what to do with that (a toast + restored label for doAction, a red history
// entry for Playground).
async function fireMutation(kind, name) {
  const [url, body] = FIRE[kind](name);
  const r = await fetch(url, {
    method: "POST",
    // Not decoration: the server rejects anything else, which is what forces a CORS preflight on
    // a cross-origin caller and keeps another page in this browser from switching your account.
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error(d.error || d.raw || `HTTP ${r.status}`);
  return d;
}

async function doAction(btn, kind, name) {
  // Ask BEFORE touching the button, for two reasons. A cancelled confirm has to leave the page
  // exactly as it was, and showModal() records whatever is focused as its return target — disabling
  // first would move focus to <body>, so Cancel would dump the user at the top of the page instead
  // of back on this button. The dialog is modal, so the button is unclickable meanwhile regardless.
  if (!(await ask(...ASK[kind](name)))) return;

  const [, , done] = FIRE[kind](name);
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "working…";
  try {
    await fireMutation(kind, name);
    // Unkeyed on purpose: load() below clears only keyed toasts, so this survives the re-render.
    toast(done);
    await load(true);
    // For a panel button (switch/pool/allow/deny) this re-render already replaced btn's whole card
    // via innerHTML, so this line touches an orphaned node and does nothing visible — harmless. For
    // #mine/#consuming/#autoswitch, which live outside <main> and are updated in place rather than
    // recreated (see updateMine/updateConsuming/updateAutoswitch), this is the ONLY place their
    // .disabled ever gets cleared after a success. Without it, the first successful click on any of
    // those three disables them for good — paint() relabels the button but never re-enables it.
    btn.disabled = false;
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Matched on data-kind rather than a class: an Allow/Deny button is not a "switch" by any reading,
// and FIRE is already keyed on exactly this attribute. Nothing else inside <main> carries one — the
// confirm dialog's Cancel/Confirm live outside it for that reason (see index.html).
document.querySelector("main").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-kind]");
  if (btn) doAction(btn, btn.dataset.kind, btn.dataset.name);
});

// ---------- playground ----------
// TREE/childKind/namesFor/findNode are pure (playground.js, no DOM); everything here is just the DOM
// half, same split as sort.js's arrange() vs paint(). Not part of PANELS/paint() — this section
// renders itself, and re-renders on its own triggers (expand/collapse, and every load()) rather than
// through the /api/all pipeline the other tabs share.
const pgRight = document.querySelector("#playground .pg-right");
const pgLogEl = document.querySelector("#playground .pg-log");
let pgExpanded = new Set(); // node ids currently expanded — survives across re-renders
let pgHistory = []; // {cmd, status: "running"|"ok"|"bad", output} — in-memory only, cleared on reload

// A dynamic branch's "children" are names read live off `last` (never free text) — one leaf button
// per name, addressed as "<parentId>::<name>" since they aren't real TREE nodes. Empty is an ordinary
// state (that panel hasn't loaded ok yet, or truly has nobody in it), not an error.
function pgRenderChildren(node, depth) {
  if (childKind(node) === "static") return node.children.map((c) => pgRenderNode(c, depth)).join("");
  const names = namesFor(node.argSource, last);
  return names.length
    ? names
        .map(
          (name) =>
            `<button class="pg-item pg-leaf" style="--depth:${depth}" data-node="${esc(node.id)}::${esc(name)}" title="claudex ${esc(node.cli.replace("{name}", name))}">${esc(name)}</button>`
        )
        .join("")
    : `<p class="note pg-empty" style="--depth:${depth}">no known names yet — refresh first</p>`;
}

// A node is either expandable (children/argSource — pressing it toggles) or a direct leaf (cmd, for
// a no-argument read, or mutate, for a no-argument write like Start pool) — never both. See
// playground.js's TREE comment for the full shape.
function pgRenderNode(node, depth) {
  const kind = childKind(node);
  const expanded = kind && pgExpanded.has(node.id);
  const arrow = kind ? (expanded ? "▾" : "▸") : "";
  let html = `<button class="pg-item" style="--depth:${depth}" data-node="${esc(node.id)}"${node.cli ? ` title="claudex ${esc(node.cli)}"` : ""}>
    <span class="pg-label">${arrow ? `<span class="pg-caret">${arrow}</span> ` : ""}${esc(node.label)}</span>
    ${node.summary ? `<span class="pg-summary">${esc(node.summary)}</span>` : ""}
  </button>`;
  if (expanded) html += `<div class="pg-children">${pgRenderChildren(node, depth + 1)}</div>`;
  return html;
}

function renderPgTree() {
  pgRight.innerHTML = TREE.map((n) => pgRenderNode(n, 0)).join("");
}

function pgLogStart(cli) {
  const entry = { cmd: cli, status: "running", output: "" };
  pgHistory.push(entry);
  renderPgHistory();
  return entry;
}

function pgLogFinish(entry, ok, output) {
  entry.status = ok ? "ok" : "bad";
  entry.output = output;
  renderPgHistory();
}

// Oldest to newest, auto-scrolled to the bottom — a real terminal's scrollback, not a stack of
// toasts. Reuses .raw's monospace styling for the output block; nothing new needed there.
function renderPgHistory() {
  pgLogEl.innerHTML = pgHistory
    .map(
      (e) => `<div class="pg-entry${e.status === "bad" ? " bad" : ""}">
        <div class="pg-cmd">claudex ${esc(e.cmd)}</div>
        <pre class="raw">${esc(e.status === "running" ? "running…" : e.output)}</pre>
      </div>`
    )
    .join("");
  pgLogEl.scrollTop = pgLogEl.scrollHeight;
}

// The three ways a leaf actually runs. Every one of them is a route that already exists for another
// tab's button — Playground adds no new way to reach claudex beyond the one read route in server.ts.
async function pgRunRead(node) {
  const entry = pgLogStart(node.cli);
  try {
    const r = await fetch(`/api/playground/read?cmd=${encodeURIComponent(node.cmd)}`);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || d.raw || "failed");
    pgLogFinish(entry, true, d.raw?.trim() || "(empty)");
  } catch (err) {
    pgLogFinish(entry, false, err.message);
  }
}

// Same route showMember() already uses for View Details — always fresh, same as every Playground run.
async function pgRunMemberRead(node, name) {
  const entry = pgLogStart(node.cli.replace("{name}", name));
  try {
    const r = await fetch(`/api/pool/member?name=${encodeURIComponent(name)}&fresh=1`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    pgLogFinish(entry, true, d.raw?.trim() || "(empty)");
  } catch (err) {
    pgLogFinish(entry, false, err.message);
  }
}

// Same ask-then-fire as doAction(), just logged instead of toasted — see fireMutation() above.
async function pgRunMutation(node, name) {
  if (!(await ask(...ASK[node.mutate](name)))) return;
  const entry = pgLogStart(node.cli.replace("{name}", name ?? ""));
  try {
    const d = await fireMutation(node.mutate, name);
    pgLogFinish(entry, true, d.raw?.trim() || "(no output)");
    await load(true); // keeps the other tabs, and this tab's own name lists, in sync
  } catch (err) {
    pgLogFinish(entry, false, err.message);
  }
}

// Delegated: renderPgTree() replaces the whole tree via innerHTML on every expand/collapse.
pgRight.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-node]");
  if (!btn) return;
  const raw = btn.dataset.node;
  const sep = raw.indexOf("::");
  // A real TREE node id — either expandable (toggle) or a direct leaf (cmd/mutate, no argument).
  if (sep === -1) {
    const node = findNode(raw);
    if (!node) return;
    if (childKind(node)) {
      if (pgExpanded.has(node.id)) pgExpanded.delete(node.id);
      else pgExpanded.add(node.id);
      renderPgTree();
    } else if (node.cmd) {
      pgRunRead(node);
    } else if (node.mutate) {
      pgRunMutation(node, undefined);
    }
    return;
  }
  // A dynamic name leaf — resolve its parent (the real TREE node) to know how to run it.
  const node = findNode(raw.slice(0, sep));
  const name = raw.slice(sep + 2);
  if (!node) return;
  if (node.readMember) pgRunMemberRead(node, name);
  else if (node.mutate) pgRunMutation(node, name);
});

// Direct listener, not delegated: this button is markup in index.html, so it outlives every
// innerHTML pass — same reasoning as #refresh. Clears the log only; expand state is untouched.
$("pg-clear").addEventListener("click", () => {
  pgHistory = [];
  renderPgHistory();
});

renderPgTree(); // static top level renders immediately; dynamic branches fill in once `last` loads

// ---------- check for updates ----------
// Lives in Settings, not <main>, so it gets its own direct listener like #mine/#consuming/#autoswitch
// rather than the delegated one above.
const updateBtn = $("update-btn");
const updateStatus = $("update-status");
const setUpdateStatus = (text) => {
  if (updateStatus) updateStatus.textContent = text;
};

async function checkForUpdates(auto) {
  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.textContent = "Checking…";
  }
  if (!auto) setUpdateStatus("checking…");
  try {
    const r = await fetch("/api/update/check");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "check failed");
    if (d.upToDate) {
      setUpdateStatus(`up to date · you're on ${d.current}`);
    } else {
      setUpdateStatus(`commit ${d.latest} available · you're on ${d.current}`);
      if (await ask(...ASK.update(d.latest))) {
        if (updateBtn) updateBtn.textContent = "Updating…";
        await fireUpdate();
      }
    }
  } catch (err) {
    setUpdateStatus(auto ? "" : `check failed: ${err.message}`);
    if (!auto) toast(err.message, true); // quiet on the boot check: offline is not an error worth a toast
  } finally {
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = "Check for updates";
    }
  }
}

// Deliberately NOT doAction(): every other write reloads via load(true) on success, but this one's
// success means the server is about to process.exit(0) (server.ts) for launchd to respawn — an
// immediate load(true) would almost certainly hit the dead process mid-restart and toast a confusing
// failure right under the success message. So it just settles the status line and stops there.
async function fireUpdate() {
  const [url, body, done] = FIRE.update();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || d.raw || `HTTP ${r.status}`);
    toast(done);
    setUpdateStatus("restarting…");
  } catch (err) {
    toast(err.message, true);
    setUpdateStatus(`update failed: ${err.message}`);
  }
}

updateBtn?.addEventListener("click", () => checkForUpdates(false));

// ---------- switch to mine ----------
// Which account is *mine* is the one thing claudex cannot say — its `current` (aliased `whoami`)
// reports whoever is logged in, not whoever owns the machine. So the server resolves it from
// CLAUDEX_ME and ships it as `me`, carrying both spellings the two commands need. mine.js decides
// which of them the open tab means; everything below is just the DOM half.

function updateMine() {
  const btn = $("mine");
  const t = mineTarget(last, fromHash());
  // Hiding the element the user is standing on drops focus to <body>. That happens on every
  // successful press — the switch lands, and the button's own reason to exist goes with it — so
  // hand focus to its neighbour rather than to the top of the page.
  if (!t && !btn.hidden && document.activeElement === btn) $("refresh").focus();
  btn.hidden = !t;
  if (!t) return;
  btn.dataset.kind = t.kind;
  btn.dataset.name = t.name;
  btn.title = cliFor(t.kind, t.name);
}

// Direct listener, not delegated: like #refresh, this button outlives every innerHTML pass.
$("mine").addEventListener("click", (e) =>
  doAction(e.currentTarget, e.currentTarget.dataset.kind, e.currentTarget.dataset.name)
);

// Same reasoning as updateMine(), one field simpler: no tab/namespace to pick between, and no
// dataset.name (pool start/pool stop take no argument at all).
function updateConsuming() {
  const btn = $("consuming");
  const t = consumingTarget(last);
  if (!t && !btn.hidden && document.activeElement === btn) $("refresh").focus();
  btn.hidden = !t;
  if (!t) return;
  btn.dataset.kind = t.kind;
  btn.textContent = t.label;
  btn.title = cliFor(t.kind);
}

// Direct listener, not delegated: like #mine and #refresh, this button outlives every innerHTML pass.
$("consuming").addEventListener("click", (e) =>
  doAction(e.currentTarget, e.currentTarget.dataset.kind, e.currentTarget.dataset.name)
);

// Same reasoning as updateConsuming(): no dataset.name (autoswitch on/off take no argument either),
// reads the doctor row via autoswitchTarget() instead of the pool status block.
function updateAutoswitch() {
  const btn = $("autoswitch");
  const t = autoswitchTarget(last);
  if (!t && !btn.hidden && document.activeElement === btn) $("refresh").focus();
  btn.hidden = !t;
  if (!t) return;
  btn.dataset.kind = t.kind;
  btn.textContent = t.label;
  btn.title = cliFor(t.kind);
}

// Direct listener, not delegated: like #mine and #refresh, this button outlives every innerHTML pass.
$("autoswitch").addEventListener("click", (e) =>
  doAction(e.currentTarget, e.currentTarget.dataset.kind, e.currentTarget.dataset.name)
);

addEventListener("hashchange", () => show(fromHash()));

history.replaceState(null, "", `#${fromHash()}`); // sync the URL without adding a history entry
show(fromHash());

$("sort").innerHTML = SORTS.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join("");

// ---------------------------------------------------------------------------
// Saved preferences — sort order, 5x filter, and theme are persisted in localStorage
// so they survive page reloads. Key is namespaced to avoid collisions.
// ---------------------------------------------------------------------------
const PREFS_KEY = "claudex-dash:prefs";

function setTheme(theme) {
  if (theme === "scifi") {
    document.documentElement.setAttribute("data-theme", "scifi");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const sel = $("theme-select");
  if (sel && sel.value !== theme) {
    sel.value = theme;
  }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    // Validate sort against the known list before applying, so a stale value
    // from an older build that removed a sort option does not get silently set.
    const validSorts = SORTS.map(([v]) => v);
    if (typeof p.sort === "string" && validSorts.includes(p.sort)) {
      $("sort").value = p.sort;
    }
    if (typeof p.only5x === "boolean") {
      $("only5x").checked = p.only5x;
    }
    if (typeof p.theme === "string" && ["default", "scifi"].includes(p.theme)) {
      setTheme(p.theme);
    }
  } catch {
    // localStorage unavailable or JSON malformed — silently ignore.
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      sort: $("sort").value,
      only5x: $("only5x").checked,
      theme: $("theme-select")?.value || "default",
    }));
  } catch {
    // Private browsing or quota exceeded — silently ignore.
  }
}

// Restore saved prefs before the first paint so the UI never flickers.
loadPrefs();

// Direct listeners, not delegated: unlike the cards, these elements outlive every innerHTML pass.
// Wrap paint() so every sort/filter change is persisted automatically.
$("sort").addEventListener("change", () => { savePrefs(); paint(); });
$("only5x").addEventListener("change", () => { savePrefs(); paint(); });

$("settings-btn")?.addEventListener("click", () => $("settings").showModal());
$("settings")?.addEventListener("click", (e) => {
  if (e.target === $("settings")) $("settings").close();
});
$("theme-select")?.addEventListener("change", (e) => {
  setTheme(e.target.value);
  savePrefs();
});

$("refresh").addEventListener("click", () => load(true));
load(false);
