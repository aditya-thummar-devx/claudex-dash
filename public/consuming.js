// Whether the header's pool start/stop button should show and which command it would fire, decided
// purely from the last /api/all payload — the same reasoning as mine.js's mineTarget. Its own module
// for the same reason: pure, worth pinning down in a test, and app.js cannot be imported without a DOM.
export function consumingTarget(last) {
  const p = last?.status;
  if (!p?.ok) return null; // Health fell back to raw text, or nothing has loaded yet
  return p.data.status.consuming.on
    ? { kind: "stop", label: "Stop pool" }
    : { kind: "start", label: "Start pool" };
}
