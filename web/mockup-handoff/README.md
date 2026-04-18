# Scene Text Translator — Design Handoff

Everything an engineer needs to build the UI. The design is final; what follows is spec, not suggestion.

---

## Folder map

```
handoff/
├── README.md                       ← you are here
├── brief.md                        ← original product brief
├── design/
│   ├── mockup.html                 ← SOURCE OF TRUTH — all 6 states in one file
│   ├── tokens.css                  ← CSS custom properties (drop-in)
│   └── assets/
│       ├── still-en.png            ← source video still (English)
│       └── still-es.png            ← translated video still (Spanish)
├── screenshots/                    ← per-state PNG references
│   ├── 01-idle.png
│   ├── 02-uploading.png
│   ├── 03-running.png
│   ├── 04-succeeded.png
│   ├── 05-failed.png
│   └── 06-rejoin.png
└── wireframes/
    └── lo-fi.html                  ← earlier exploration, context only
```

Open `design/mockup.html` in any browser. It's self-contained (no build, no network). Every visual in the final app is in there — scroll through the six labeled state sections.

---

## What to build

A single-page web app that replaces on-screen text in a video (e.g. English → Spanish). One job at a time. Six visible states:

| # | State | Trigger |
|---|---|---|
| 01 | **Idle** | Page load, no file |
| 02 | **Uploading** | User dropped a file, upload in flight |
| 03 | **Running** | Server is executing the pipeline |
| 04 | **Succeeded** | Pipeline finished, translated video available |
| 05 | **Failed** | Pipeline errored mid-stage |
| 06 | **Rejoin** | User reloaded while a job was running server-side |

---

## Layout

Two-column app shell, fixed 1080×760, inside a macOS-style window chrome.

- **Left column (300px):** identity · input (drop zone / locked file card) · language pair · primary CTA
- **Right column (flex):** canvas header (status + job id) · pipeline stages strip · live progress + timeline (running only) · log window / result area

The window chrome (traffic lights, URL bar, status chip) is decorative — it's what makes this feel like a tool, not a web form. Keep it.

---

## Design tokens

Drop `design/tokens.css` into your stylesheet bundle and reference the custom properties directly. Do not introduce new colors.

Key groups: surfaces `--bg-0..4`, text `--ink-0..3`, accent `--acc*` (electric blue), semantic `--ok / --warn / --err`, type `--ff-sans / --ff-mono`, radii `--r-*`, shadows `--sh-*`.

**Fonts:** Inter (UI) and JetBrains Mono (logs, timestamps, labels). Load from Google Fonts or self-host.

---

## Components & patterns (all live in `mockup.html`)

- `.btn` — sizes `sm`, variants `primary` (filled accent, glows), `ghost`, `danger`
- `.chip` / `.job-chip` — status pills with colored dot
- `.field` — dashed drop zone (idle) + solid file card (locked)
- `.stage` — pipeline stage tile, modifiers `.done`, `.active`, `.failed`, `.idle`
- `.log-line` — monospace log entry with timestamp, level, body
- `.progress` — thin linear bar, animated shimmer while running
- `.timeline` — horizontal stage timeline shown in the success recap

Copy the CSS verbatim from `mockup.html`'s `<style>` block into your component styles — token names match `tokens.css`.

---

## State behavior notes

**Idle → Uploading:** user drops a file. The drop zone collapses into a locked file card; CTA becomes `Uploading X%`, disabled. The language pair stays editable during upload.

**Uploading → Running:** upload completes, server confirms job id. Left column locks entirely (file card shows `LOCKED`, language selectors become read-only with a `LOCKED WHILE RUNNING` chip). CTA is replaced by a `Cancel` ghost button. Right column swaps to pipeline view.

**Running:** stages are Detect → Frontalize → Edit → Propagate → Revert. Each tile shows its own state; only one is `active` at a time. The log streams via SSE. `est. remaining` is a best-effort tooltip — show `~` prefix to signal the estimate.

**Running → Succeeded:** stage tiles all go `done`. Right column swaps to a recap: translated video player (top), compact timeline of stage durations (middle), log collapsed to a `View log` toggle (bottom). CTA row: `Download translated.mp4` primary, `Start new job` ghost.

**Running → Failed:** the failing stage tile goes red with an `✗`. Right column shows an error card with: failing stage name, one-line human reason, raw error code, and `Copy details` / `Retry` actions. The log stays open and auto-scrolls to the error.

**Rejoin:** on load, if localStorage has an in-flight `jobId`, show a warn-colored banner at top of right column (before the canvas): `Job {id} is still running on the server · Rejoin running job`. Clicking rejoin transitions straight to the Running state and reconnects SSE. No red used here — yellow only; red is reserved for actual failure.

---

## Interaction details worth preserving

- Drop zone accepts MP4 / MOV / WebM / AVI, max 200MB, one file. Reject others with inline red text under the zone, not a modal.
- Language pair has a swap button (↕) between the two dropdowns.
- Log panel auto-scrolls unless the user has scrolled up; if they have, show a `Jump to latest` chip.
- Timestamps in logs are `HH:MM:SS` in `--ff-mono` at `--ink-2`.
- All buttons have a visible focus ring using `--acc-line`.
- The accent glow on the primary CTA is load-bearing — do not flatten it.

---

## Responsive scope

Design is **desktop-only, fixed 1080px wide**. Below 1080 show a polite "desktop required" card. Phones and tablets are out of scope for v1.

---

## What is NOT in this handoff

- Backend API shapes — see `brief.md` for pipeline behavior; coordinate with backend for exact endpoints.
- SSE event schema — ask backend.
- Copywriting for marketing surfaces (outside the app).

---

## Questions

Open `design/mockup.html` side-by-side with your implementation. If a pixel disagrees, the mockup wins.
