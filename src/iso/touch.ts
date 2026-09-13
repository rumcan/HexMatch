// ══════════════════════════════════════════════════════════════════════════
// MOBILE-01 — one question, one answer: is this a hand or a mouse?
//
// Several surfaces say different things depending on the answer — the Select
// tool's sub-line ("Q / right-click" is nonsense to a thumb), the tour's
// controls card, the help modal, and the ☰ menu's extra Recenter/Names rows
// (the keys a narrow phone's top bar sheds). They must not drift apart, so
// the question is asked once, here.
//
// `pointer: coarse` is the platform's own answer (a stylus-only tablet reads
// coarse too, which is right: it has no wheel and no right button either).
// Absent matchMedia — node tests, an odd embed — the answer is "mouse", the
// historic default every desktop assertion was written against.
// ══════════════════════════════════════════════════════════════════════════

/** True when the primary pointing device is a finger or stylus. */
export function coarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}
