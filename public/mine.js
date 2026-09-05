// Which command "Switch to mine" would run, given the last /api/all payload and the open tab.
//
// Its own module for the same reason sort.js is: it is pure, it decides something worth pinning
// down in a test, and app.js cannot be imported without a DOM.
//
// The stakes are why it is tested at all. The two switch commands take names from DIFFERENT
// namespaces — `switch` the short profile name off `claudex list`, `pool use` the dotted name off
// `claudex pool members` — and the server rejects a name from the wrong list with a 400. Worse than
// the 400: `pool use` spends a coworker's quota, so picking the wrong branch is not a cosmetic bug.
//
// Returns null wherever the button would be pointless or wrong, and every one of those is an
// ordinary state: no CLAUDEX_ME configured, a panel that fell back to raw text, a tab with no
// accounts on it (Health, Access), or already being on your own account. Null hides the button — the same choice usageHtml makes when
// it renders no Switch at all on the row you are already on.
export function mineTarget(last, tab) {
  const me = last?.me;
  if (!me) return null;

  switch (tab) {
    case "pool": {
      if (!me.pool || !last.pool?.ok) return null;
      // claudex's ▶ marks the member currently serving you — the same inference poolHtml makes when
      // it omits that row's Switch. Undocumented, so wrong at worst by offering a no-op.
      const on = last.pool.data.find((m) => m.marked)?.name;
      return on === me.pool ? null : { kind: "pool", name: me.pool };
    }
    // Usage shows the same `claudex list` / `claudex current` pair Accounts used to — no tab of its
    // own anymore, but `last.accounts` is still sent for exactly this.
    case "usage":
      if (!last.accounts?.ok) return null;
      return last.accounts.data.current.account === me.account
        ? null
        : { kind: "switch", name: me.account };
    default:
      return null; // Health and Access show no accounts, so there is nothing here to switch to
  }
}
