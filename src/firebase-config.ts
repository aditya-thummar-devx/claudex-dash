// Firebase web config, committed on purpose so every install — including a fresh
// `curl … bootstrap.sh | bash` — picks it up, rather than each machine needing its own `.env`.
//
// These are the CLIENT-SIDE "public" Firebase keys: the browser downloads them on every run via
// /api/analytics-config, so committing them here leaks no secret that a running app doesn't already
// expose. Two things follow from that, and both must hold:
//   1. Keep this Firebase project scoped to ANALYTICS + REMOTE CONFIG only. Do not enable Firestore,
//      Auth, or Storage on it with permissive rules — a public apiKey is only safe when there is
//      nothing behind it to abuse.
//   2. Never put a real secret (a service-account key, an admin token) in this file. Nothing here is
//      private.
//
// TO TURN ANALYTICS ON: create the Firebase project + a GA4 web app, paste the seven values below,
// commit, and push. Every machine picks it up on its next `bun run update`. While the fields are
// blank, firebaseConfig() in server.ts treats the config as absent and analytics ships DARK — a
// complete no-op — so this file is safe to commit in its placeholder state.
//
// PER-MACHINE OVERRIDE: the matching FIREBASE_* env vars (see .env.example) override these
// field-by-field, and CLAUDEX_DASH_ANALYTICS=off disables analytics on a single machine regardless.
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  measurementId: "",
};
