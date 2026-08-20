// Whether the header's autoswitch button should show and which command it would fire, decided
// purely from the last /api/all payload's doctor checks — reads the row doctor already prints
// rather than adding a dedicated `autoswitch status` call. Own module for the same reason as
// consuming.js: pure, worth pinning down in a test, and app.js cannot be imported without a DOM.
//
// Unlike consuming.js this can't read a parsed boolean — parseDoctor()'s checks are free text — so
// it string-matches the one fixed spelling claudex uses for "off". Verified live: disabled reads
// exactly "disabled"; enabled instead describes hook install state ("Stop + SessionStart hooks
// present"), which varies, so "on" is "anything that isn't literally disabled" rather than a second
// fixed string to match.
export function autoswitchTarget(last) {
  const p = last?.status;
  if (!p?.ok) return null; // Health fell back to raw text, or nothing has loaded yet
  const row = p.data.doctor.checks.find((c) => c.label === "autoswitch");
  if (!row) return null; // doctor didn't report a row by this name — don't guess
  return row.detail === "disabled"
    ? { kind: "on", label: "Enable autoswitch" }
    : { kind: "off", label: "Disable autoswitch" };
}
