# Direct chat after joining

Liz's October 25 recording shows a confirmed join followed by an unresponsive
Open Chat experience, an optional People loading screen, a return to the plan,
and eventual chat. The connected iPhone 17 Pro has production build 51 and the
October 25 update `01a17208-995d-7135-89b6-5a84cfb24262`; this report cannot be
written off as an uninstalled update. No matching new iOS crash was visible in
the inspected Sentry feed. A touch/navigation stall need not produce a crash.

Open Chat previously used the same callback as closing the share screen. That
callback inserted People loading, an invitation modal, and, for ticketed plans,
an external-ticket reminder before chat. The new explicit callback waits for
native share dismissal on iOS and then opens the existing plan or Circle
conversation directly. It keeps account ownership and duplicate-action guards.
Sharing and ordinary close behavior remain available, as does the plan's ticket
link. This does not change ticket purchase or admission rules.

Validation: three added regressions failed before the change; 241 focused tests
across four suites and application TypeScript pass afterward. Additional cases
cover retired accounts, repeated callbacks and Android Circle destinations.
The full-root iPhone 13 simulator opens chat with a 30-second fictional People
response and existing participation assent. A baseline simulator run also
reached chat, so the exact physical-device stall is not yet reproduced locally.
The private diagnostic binary includes an experimental scheduler guard and is
not equivalent to the production native binary.

Physical-device verification and mandatory CI are required before release.
No production publication is recorded by this document.

Local evidence and the whole-app reliability work register:
`/Users/liz/Desktop/Ops/Audits/2026-10-25-salsa-freeze/`.
The private subdirectory contains device diagnostics and recording frames and
must not be committed or published.
