// The four analytics facts only the server can resolve, shipped to the browser inside /api/all so
// the client can set them as GA4 user properties. Everything else the analytics layer needs
// (account counts, pool membership, consuming/autoswitch state) the client already has in the
// /api/all payload, so it is derived there — this file is only the parts the browser cannot see.
//
// Defensive throughout: this rides the /api/all path every panel depends on, so nothing here may
// throw. Every unknown resolves to "" and the client renders it as "unknown", exactly as `me` does.
import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentRevision } from "./update.ts";

// The OS login name — os.userInfo() reads the passwd entry for the running uid. It can throw on an
// unusual account setup (no passwd entry), so it is guarded like everything else here.
export function osUsername(): string {
  try {
    return userInfo().username || "";
  } catch {
    return "";
  }
}

// macOS product version, e.g. "14.5". os.release() would give the Darwin kernel string (23.x),
// which is not what an analyst reading "macos_version" expects — so this shells `sw_vers` once and
// memoizes it (the OS version cannot change while the server runs). Non-macOS or a missing binary
// yields "".
let macosCache: string | null = null;
export async function macosVersion(): Promise<string> {
  if (macosCache !== null) return macosCache;
  macosCache = await readSwVers();
  return macosCache;
}

function readSwVers(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const child = spawn("sw_vers", ["-productVersion"], { stdio: ["ignore", "pipe", "pipe"], shell: false });
      let out = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve("");
      }, 5_000);
      child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? out.trim() : "");
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
    } catch {
      resolve("");
    }
  });
}

// This dashboard's own version, as a display string: the short git SHA when available (most useful
// for correlating breakage to a build), falling back to package.json's "version". "" if neither
// resolves.
let appVersionCache: string | null = null;
export async function appVersion(): Promise<string> {
  if (appVersionCache !== null) return appVersionCache;
  const sha = await currentRevision();
  appVersionCache = sha || packageVersion();
  return appVersionCache;
}

function packageVersion(): string {
  try {
    const raw = readFileSync(join(import.meta.dir, "..", "package.json"), "utf8");
    const v = JSON.parse(raw)?.version;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

export type ClientContext = {
  email: string;
  os_username: string;
  macos_version: string;
  app_version: string;
};

// Assembled once per /api/all. `email` is the boot-resolved identity (server.ts passes ME in), the
// same value whoAmI() found; the other three are memoized, so this is cheap on every call after the
// first. All string, never null — the client maps "" to "unknown".
export async function clientContext(email: string): Promise<ClientContext> {
  const [macos, version] = await Promise.all([macosVersion(), appVersion()]);
  return {
    email: email || "",
    os_username: osUsername(),
    macos_version: macos,
    app_version: version,
  };
}
