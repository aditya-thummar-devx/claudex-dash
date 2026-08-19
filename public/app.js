// One fetch, four panels, no framework. Each panel renders native HTML when its parser recognised
// claudex's output, and the raw CLI text otherwise — so a claudex update degrades the page to
// plain text rather than showing numbers we can no longer trust.

import { arrange, SORTS } from "./sort.js";
import { mineTarget } from "./mine.js";

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
        // Nothing to switch to on the account you are already on, so the row is not rendered at
        // all. card() defaults actions to "", so this leaves no empty .card-actions behind.
        actions: r.active
          ? ""
          : `<div class="card-actions">
               <button class="switch" data-kind="switch" data-name="${esc(r.account)}">Switch</button>
             </div>`,
      })
    )
    .join("")}</div>`;

const poolHtml = (members) =>
  !members.length
    ? EMPTY
    : `<div class="cards">${members
    .map((m) =>
      card({
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
        actions: `<div class="card-actions">
             ${m.marked ? "" : `<button class="switch" data-kind="pool" data-name="${esc(m.name)}">Switch</button>`}
             <button class="detail" data-name="${esc(m.name)}">View Details</button>
           </div>`,
      })
    )
    .join("")}</div>`;

const accountsHtml = (d) => `
  <table>
    <tr><th>Account</th><th>Email</th><th>Org</th><th>Plan</th><th>Saved</th></tr>
    ${d.accounts
      .map(
        (a) => `<tr class="${a.active ? "active" : ""}">
        <td>${esc(a.account)}</td><td>${esc(a.email)}</td>
        <td>${esc(a.org)}</td><td>${esc(a.plan)}</td><td>${esc(a.saved)}</td></tr>`
      )
      .join("")}
  </table>
  <p class="note">active: ${esc(d.current.account)} · ${esc(d.current.email)}</p>`;

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
// row panels take the controls; accounts and status are passed through untouched.
const opts = () => ({ sort: $("sort").value, only5x: $("only5x").checked });
const HTML = {
  usage: (rows) => usageHtml(arrange(rows, opts())),
  pool: (members) => poolHtml(arrange(members, opts())),
  accounts: accountsHtml,
  status: statusHtml,
};
const PANELS = Object.keys(HTML);

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

// Panels differ in shape: usage/pool are bare arrays, accounts wraps one in an object. Health is
// absent on purpose — its tab has no .count span, so setCount() no-ops there.
// The count is of what the panel actually shows: with the 5x filter on, "Pool (10)" above three
// cards would be a lie about the list under it.
const COUNT = {
  usage: (d) => arrange(d, opts()).length,
  pool: (d) => arrange(d, opts()).length,
  accounts: (d) => d.accounts.length,
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
      $("app").removeAttribute("inert");
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
  for (const p of PANELS) {
    $(p).hidden = p !== name;
    $(`tab-${p}`).setAttribute("aria-selected", String(p === name));
  }
  // Accounts is a table and Health is not a list at all, so the controls would order nothing there.
  $("ctl").hidden = name !== "usage" && name !== "pool";
  updateMine(); // the tab decides which of the two commands "switch to mine" would run
}

// A stale or hand-typed hash must open Usage, not hide every panel.
const fromHash = () => {
  const h = decodeURIComponent(location.hash.slice(1));
  return PANELS.includes(h) ? h : PANELS[0];
};

// Every tab change goes through the hash, so clicks and browser back/forward share one code path.
const go = (name) => (location.hash = name);

for (const p of PANELS) {
  const tab = $(`tab-${p}`);
  tab.addEventListener("click", () => go(p));
  // Roles and aria-selected without keyboard nav is a half-built tablist.
  tab.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = PANELS[(PANELS.indexOf(p) + step + PANELS.length) % PANELS.length];
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
const details = new Map(); // name -> panel; cleared by load() so a refresh cannot pair a cached
let shown = null; //          breakdown with freshly pulled gauges. `shown` is what the toggle reads.

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

$("pool").addEventListener("click", async (e) => {
  const btn = e.target.closest("button.detail");
  if (!btn) return;
  const name = btn.dataset.name;

  // Open first, fill second: the request can take a second, and a button that does nothing until
  // then reads as broken.
  $("detail-name").textContent = name;
  dlg.querySelector(".plan").textContent = "";
  rawBtn.setAttribute("aria-pressed", "false");
  rawBtn.textContent = "show raw";
  rawBtn.hidden = true;
  dlg.querySelector(".body").innerHTML = `<p class="note">loading…</p>`;
  dlg.showModal();

  try {
    if (!details.has(name)) {
      const r = await fetch(`/api/pool/member?name=${encodeURIComponent(name)}`);
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || `HTTP ${r.status}`);
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
    // Close rather than leave an empty modal in the way of the toast that explains why.
    shown = null;
    dlg.close();
    toast(err.message, true);
  }
});

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
// Both writes ask first. See index.html for how Enter, Esc and the two buttons all work with no key
// handler; `close` is the one event all four exits funnel through, so one listener reads them all.
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
// coworker's token — it spends their limit and lands in their breakdown as "borrowed". Different
// blast radius, so different words and a different button label; the pool one names the person
// twice on purpose, because the cost of a mis-click is paid by someone who is not at this keyboard.
const ASK = {
  switch: (n) => [
    "Switch account?",
    `Logs this machine into “${n}”. Claude Code sessions started after this use that account.`,
    "Switch",
  ],
  pool: (n) => [
    `Use ${n}’s quota?`,
    `Routes your Claude traffic through ${n}’s token instead of your own. Your usage counts against their limit and shows up as “borrowed” in their pool breakdown.`,
    "Borrow quota",
  ],
};

// The only two writes this page can make: `claudex switch <account>` from a Usage card and
// `claudex pool use <member>` from a Pool card. Delegated on <main> rather than per button for the
// reason given above — load() replaces every card via innerHTML, dropping element listeners. One
// listener covers both panels; the pool detail listener above stays separate because it opens a
// dialog and shares nothing with this.
//
// A function rather than the listener body because the header's "Switch to mine" needs exactly this
// sequence but sits OUTSIDE <main>, so the delegation below can never reach it.
async function doSwitch(btn, kind, name) {
  // Ask BEFORE touching the button, for two reasons. A cancelled confirm has to leave the page
  // exactly as it was, and showModal() records whatever is focused as its return target — disabling
  // first would move focus to <body>, so Cancel would dump the user at the top of the page instead
  // of back on this button. The dialog is modal, so the button is unclickable meanwhile regardless.
  if (!(await ask(...ASK[kind](name)))) return;

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "switching…";
  try {
    const r = await fetch(kind === "pool" ? "/api/pool/use" : "/api/switch", {
      method: "POST",
      // Not decoration: the server rejects anything else, which is what forces a CORS preflight on
      // a cross-origin caller and keeps another page in this browser from switching your account.
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    // claudex's own output beats a message we made up — it says why far better than we can.
    if (!r.ok || !d.ok) throw new Error(d.error || d.raw || `HTTP ${r.status}`);
    // Unkeyed on purpose: load() below clears only keyed toasts, so this survives the re-render.
    toast(`switched to ${name}`);
    // No need to restore the button: this re-renders every card, so the green tint and the disabled
    // state both move to wherever they now belong.
    await load(true);
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = label;
  }
}

document.querySelector("main").addEventListener("click", (e) => {
  const btn = e.target.closest("button.switch");
  if (btn) doSwitch(btn, btn.dataset.kind, btn.dataset.name);
});

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
  btn.title = t.kind === "pool" ? `use ${t.name}'s quota` : `switch to ${t.name}`;
}

// Direct listener, not delegated: like #refresh, this button outlives every innerHTML pass.
$("mine").addEventListener("click", (e) =>
  doSwitch(e.currentTarget, e.currentTarget.dataset.kind, e.currentTarget.dataset.name)
);

addEventListener("hashchange", () => show(fromHash()));

history.replaceState(null, "", `#${fromHash()}`); // sync the URL without adding a history entry
show(fromHash());

$("sort").innerHTML = SORTS.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join("");
// Direct listeners, not delegated: unlike the cards, these elements outlive every innerHTML pass.
$("sort").addEventListener("change", paint);
$("only5x").addEventListener("change", paint);

$("refresh").addEventListener("click", () => load(true));
load(false);
