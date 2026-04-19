# Session: Web Client UI Redesign — 2026-04-18

## Completed
- Scanned `web/mockup-handoff/` (brief, tokens, 1351-line `mockup.html`, 6 state screenshots) to ground the redesign in the design-of-record.
- Re-read each cleaned screenshot pixel-by-pixel and compared against README prose; caught two overshoot items (Cancel button + Before/After toggle aren't actually in the mockup).
- Agreed 10 decisions (D1–D10) with user; settled a locked defer list for mockup features the backend doesn't support.
- Archived the shipped web-client MVP plan to `docs/plans_archive/web-client-mvp.md`.
- Wrote a fresh `plan.md` for the redesign: 19-step progress checklist, Risks R1–R10, 12-item Done-When.
- Two atomic commits pushed to the branch: `011d00a chore(web): add design handoff for UI redesign`, `f750118 chore(plan): archive web-client MVP plan; add UI redesign plan`.

## Current State
- Branch: `feat/web-client`, 2 commits ahead of `origin/feat/web-client` (not pushed).
- `plan.md` at repo root now describes the redesign; old plan safely archived.
- `web/mockup-handoff/` (13 files, ~3.9 KLoC added) is the pixel source of truth.
- No web or server code has been touched yet — the shipped MVP still renders.
- All tests still green from the prior session (pipeline 433, server 87+3 gpu, web 60).

## Next Steps
1. Push `feat/web-client` → origin and run remote Claude Code from the GPU box for implementation.
2. Execute `plan.md` Step 1 first — port tokens.css + fonts + theme swap. Verify the existing UploadForm/JobView still renders in slate-dark before any layout change.
3. Proceed through Steps 2–19 in order; steps are staged so `npm run test` stays green commit-by-commit.
4. Revisit R3 (shadcn re-skin drift) after Step 1 — manually verify the four shadcn primitive variants against the new palette before building on top.

## Decisions Made
- **D1** Upload progress uses XHR (`onProgress` callback); `fetch` stays for non-upload endpoints.
- **D2** shadcn primitives kept where close (Button/Alert/Card/Badge); mockup-vocabulary elements (`.lang-select`, stage tile, log line) hand-rolled.
- **D3** Minimal source video preview: native `<video controls>` + filename + size only.
- **D5** Keep technical stage names (Detect/Frontalize/Edit/Propagate/Revert) — matches mockup + backend `s1..s5` codes.
- **D6** Drop the macOS window chrome — fixed-width two-column shell only.
- **D7** Collapse `<UploadForm>` + `<JobView>` into an `<App>`-level `UiState` reducer; left column becomes a stateless composite.
- **D8** Reuse `useJobStream` + one additive `activeStageElapsedMs` tick.
- **D9** Rejoin card fetches blocking job's `/status` on 409 to populate metadata; "from other session" marker omitted.
- **D10** No backend changes — everything local to `web/`.
- Deferred mockup features: ETA heuristic, "4 regions rewritten" stat, session marker, queued-auto-resubmit, `↻ replace` chip, Retry button, human error-title mapping, localStorage reload-rejoin, jump-to-latest chip.

## Open Questions
- None blocking. `<FailureCard>` Retry button stays out for MVP; revisit if user feedback on remote implementation flags the omission.
