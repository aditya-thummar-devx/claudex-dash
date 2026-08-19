// CSRF guard for the two mutating routes.
//
// server.ts binds 127.0.0.1, which stops other machines — but it does not stop other *pages*. Any
// site open in this browser can fire a request at http://127.0.0.1:4400. That was harmless while
// every route was a read; a drive-by POST that flips which Claude account is logged in is not.
//
// A same-origin fetch from our own page sends either no Origin header at all or exactly our origin.
// A cross-origin one always sends the attacker's, and cannot forge it, so a match is enough. (The
// routes also demand Content-Type: application/json, which forces a CORS preflight this server
// never answers — belt and braces, because Origin is legitimately absent on a non-browser client
// like curl and so cannot be the only check.)
//
// Several origins are allowed because 127.0.0.1 and localhost are different origins by spec but the
// same machine in practice, and the user types whichever they remember. Rejecting one of them would
// buy no security — both are reachable only from here — and would look like a broken button.
export function sameOrigin(origin: string | null, allowed: readonly string[]): boolean {
  return origin === null || allowed.includes(origin);
}
