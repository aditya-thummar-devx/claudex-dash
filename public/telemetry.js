// The impure half of the analytics layer: it loads the Firebase SDK, reads Remote Config, owns the
// install id in localStorage, and makes the actual logEvent / setUserProperties calls. app.js talks
// only to the four functions exported here — track(), trackError(), setUserContext(), and
// initTelemetry() — and never touches Firebase directly. All the shaping logic lives in the pure
// analytics.js, imported below and unit-tested there.
//
// Firm rule: telemetry can NEVER break the dashboard. Every path here is wrapped so a missing
// config, a blocked CDN, an ad-blocker, or an offline machine leaves the app working and the
// tracking functions as silent no-ops. This is why the module ships dark until a real Firebase
// project is wired in via .env.
import {
  EVENTS,
  isEnabled,
  sanitizeMessage,
  buildEventParams,
  buildUserProps,
  newInstallId,
} from "./analytics.js";

// Pinned exact version, loaded from the one CDN Firebase publishes its modular ESM builds on. Exact
// pin (not a range) so a future SDK release can never change behaviour under us. gstatic is the
// Firebase-documented host for these browser builds.
const SDK = "https://www.gstatic.com/firebasejs/11.6.0";

const INSTALL_ID_KEY = "claudex-dash:install-id";

// Module state, all null until initTelemetry() succeeds. `enabled` gates every track call; `fb`
// holds the live Firebase handles; `globals` are the always-on event params; `installId` stands in
// for user_id when no email is known.
let enabled = false;
let fb = null; // { analytics, logEvent, setUserId, setUserProperties }
let globals = {}; // { theme, active_tab, app_version }
let installId = "";

// A per-viewer id that survives reloads. localStorage can throw (private mode, blocked storage), so
// it is fully guarded — a fresh random id each load is an acceptable degrade, never an error.
function ensureInstallId() {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const id = newInstallId();
    localStorage.setItem(INSTALL_ID_KEY, id);
    return id;
  } catch {
    return newInstallId();
  }
}

// Called once at startup. Fetches the server's resolved config, and only if analytics is enabled AND
// a config is present does it dynamically import the Firebase SDK — so a disabled/unconfigured
// install makes no network call to Google at all. Remote Config is fetched with the bundled default
// so a slow or failed fetch never blocks the default-on decision. Everything is best-effort.
export async function initTelemetry() {
  try {
    installId = ensureInstallId();
    const res = await fetch("/api/analytics-config");
    const { enabled: serverEnabled, config, remoteConfigDefaults } = await res.json();
    if (!serverEnabled || !config) return; // ship-dark state: stay a no-op, import nothing

    const [{ initializeApp }, analyticsMod, rcMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-analytics.js`),
      import(`${SDK}/firebase-remote-config.js`),
    ]);

    const app = initializeApp(config);

    // Remote Config: the remote master switch. Defaults come from the server so the flag has a value
    // before the first fetch; a fetch failure leaves the default in place. The flag can only turn
    // analytics OFF (isEnabled treats undefined/true as on), never widen it.
    let remoteFlag; // undefined until a fetch resolves
    try {
      const rc = rcMod.getRemoteConfig(app);
      rc.defaultConfig = remoteConfigDefaults ?? { analytics_enabled: true };
      await rcMod.fetchAndActivate(rc);
      remoteFlag = rcMod.getValue(rc, "analytics_enabled").asBoolean();
    } catch {
      // offline or RC unavailable — fall back to the bundled default (on)
    }

    enabled = isEnabled(serverEnabled, remoteFlag);
    if (!enabled) return;

    const analytics = analyticsMod.getAnalytics(app);
    fb = {
      analytics,
      logEvent: analyticsMod.logEvent,
      setUserId: analyticsMod.setUserId,
      setUserProperties: analyticsMod.setUserProperties,
    };

    // Uncaught errors that never reach one of the app's own handled failure points. Registered only
    // once telemetry is live so a disabled install adds no listeners.
    installGlobalErrorHandlers();
  } catch {
    // Any failure — no config, blocked CDN, JSON error — leaves enabled=false and the app untouched.
    enabled = false;
    fb = null;
  }
}

// The single funnel every event goes through, as agreed. Enablement gate first, then the pure
// param builder (globals merged in, values clamped), then the Firebase call — all inside a try/catch
// so a telemetry fault can never surface to the user.
export function track(eventName, params = {}) {
  if (!enabled || !fb) return;
  try {
    fb.logEvent(fb.analytics, eventName, buildEventParams(params, globals));
  } catch {
    // swallow — analytics must never throw into the app
  }
}

// Errors route through the same core as every other event, as app_error, after the message is
// stripped of URLs and clamped. Callers pass an error_type from the agreed enum, the context
// (which panel/route), the raw message, and whether it is fatal.
export function trackError(errorType, context, message, fatal = false) {
  track(EVENTS.APP_ERROR, {
    error_type: errorType,
    context,
    message: sanitizeMessage(message),
    fatal: fatal ? "true" : "false",
  });
}

// Sets the GA4 user properties (identity + environment + feature state) and the user id. Called on
// every /api/all success so the properties track the current state, and once more names the actor:
// email when known, else the stable install id. `ctx` is the server's analytics context; `last` is
// the cached /api/all payload the client already holds.
export function setUserContext(ctx, last) {
  if (!enabled || !fb) return;
  try {
    const props = buildUserProps(ctx, last);
    fb.setUserProperties(fb.analytics, props);
    fb.setUserId(fb.analytics, props.user_email !== "unknown" ? props.user_email : installId);
  } catch {
    // swallow
  }
}

// The always-on event params. app.js calls this whenever theme, active tab, or app version change,
// so subsequent events carry the current values without each call site repeating them.
export function setGlobals(next = {}) {
  globals = { ...globals, ...next };
}

function installGlobalErrorHandlers() {
  try {
    window.addEventListener("error", (e) => {
      trackError("uncaught", "window.onerror", e?.message || String(e?.error || "error"), true);
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e?.reason;
      trackError("uncaught", "unhandledrejection", (r && (r.message || String(r))) || "rejection", true);
    });
  } catch {
    // no window (shouldn't happen in the browser) — skip
  }
}
