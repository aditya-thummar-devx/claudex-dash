# claudex-dash

A local web view of your `claudex` state — usage, pool, accounts, access, health — with buttons to
switch which account you're on, control who may borrow it, and toggle whether you're borrowing from
the pool.

```
curl -fsSL https://raw.githubusercontent.com/aditya-thummar-devx/claudex-dash/main/bootstrap.sh | bash
```

That installs Bun if you don't have it, clones to `~/tools/claudex-dash`, pulls the latest, and
opens <http://127.0.0.1:4400>. Re-run the same line any time — it updates in place.

**The server runs in the foreground.** Ctrl-C stops it, and closing the terminal stops it too.

## What you need first

`claudex` itself, installed and logged in. This tool only reads and drives it — it does not install
it. If it's missing, the dashboard says so and gives you a Retry button rather than starting.

Bun is installed for you. macOS.

## What it shows

| Tab | |
|---|---|
| **Usage** | Your saved accounts, with session and weekly gauges. |
| **Pool** | Everyone in the pool, their headroom, and their net give/take. "View Details" opens one person's own / borrowed / shared breakdown. |
| **Accounts** | The saved account table — email, org, plan, when it was last saved. |
| **Access** | Who may borrow *your* account through the pool, and whether each is allowed or blocked. |
| **Health** | `pool status` and `doctor` — what's on, what's wired, what's failing. |

Everything on Usage / Pool can be sorted, and filtered to Max 5x accounts only.

## What it can change

Five things, each behind a confirmation:

- **Switch** on a Usage card → `claudex switch <account> --force`. Moves this machine between your
  own saved accounts.
- **Switch** on a Pool card → `claudex pool use <member>`. Points your traffic at a coworker's
  token. Your usage counts against *their* limit and shows up as "borrowed" in their breakdown.
  This is the one worth reading the dialog for.
- **Allow / Deny** on an Access row → `claudex access allow|deny <name>`. Decides who may borrow
  *your* account. Allowing someone means their usage counts against your rate limit; denying someone
  who is running on your token right now cuts them off with no warning. Each row shows only the
  button that would change something.
- **Start pool / Stop pool** in the header → `claudex pool start` / `claudex pool stop`. Toggles
  whether this account is currently borrowing from the shared pool (token-swap) instead of using its
  own token. Only ever affects this account, and it's reversible any time by pressing the other one.
- **Enable / Disable autoswitch** in the header → `claudex autoswitch on` / `claudex autoswitch off`.
  Toggles whether claudex automatically switches your active account when usage gets high. Only ever
  affects this account, and it's reversible any time by pressing the other one.

Enter confirms, Esc cancels.

Everything else is read-only, and the command allowlist is enforced in code
(`src/claudex-dash.ts`). It will never run: `login` · `add` · `remove` · `rename` ·
`pool join` · `access remove` · `sessions share/pull` · `keep-warm` · `refresh` ·
`autoswitch run` · `update`. Those create or destroy profiles, move tokens between people, or erase
someone from your access list with no way back from a web page — none of them belong behind a button.

`access remove` is the odd one on that list: `access` itself *is* reachable, because reading the list
and flipping a row between allowed and blocked are both recoverable from the page you did them on.
Removing a person is not — you'd need the terminal to put them back — so only `allow` and `deny` are
wired up, and the two verbs are a literal union in the code rather than a value passed through from
the request.

## Privacy

- Binds `127.0.0.1` only. Not reachable from another machine.
- Sends nothing anywhere. No telemetry, no analytics, no phone-home — the only network calls the
  install makes are to github.com, and to bun.sh the first time.
- The fixtures committed to this repo are fabricated. Real captures stay in `fixtures.local/`,
  which is gitignored.
- **Do not add CORS headers to `server.ts`.** The Pool panel serves coworkers' email addresses, and
  the *absence* of `Access-Control-Allow-Origin` is what stops another tab in your browser from
  reading it. There's a longer note at the route itself.

## Running it yourself

```sh
bun run server.ts                      # or: bun run start
PORT=4500 bun run server.ts            # if 4400 is taken
CLAUDEX_BIN=/path/to/claudex bun run server.ts
```

`claudex` is found at `~/.local/bin`, Homebrew, `/usr/local/bin`, or on `PATH` — `CLAUDEX_BIN` is
only needed if yours lives somewhere else.

Reads are cached for 60s. ↻ Refresh forces a fresh capture, and so does any of the four write buttons.

## If a panel shows raw terminal text

That's deliberate, not a bug.

`claudex` has no `--json` and self-updates, so its printed output is the only contract we get. Every
parser here returns nothing rather than guessing when it sees a shape it doesn't recognise, and the
panel falls back to the raw text with a ⚠ on its tab. A claudex update degrades this dashboard to
plain text; it never shows you numbers it isn't sure about.

If you see one, open an issue and paste the raw block — that's exactly what's needed to fix it.

## Development

```sh
bun test
```

`fixtures/` holds sanitized captures of real `claudex` output, and the tests parse them. They exist
to fail loudly when claudex changes its table layout. If you regenerate them from your own machine,
put the originals in `fixtures.local/` and scrub names, emails, paths and internal URLs before
anything lands in `fixtures/`.
