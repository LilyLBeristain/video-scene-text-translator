# UI Design Brief — Scene Text Translator (Web)

A web app that replaces on-screen text in a video across languages.
This brief describes **what the app does and what the UI must convey**
— not how the current implementation looks. The redesign is expected
to be new from the ground up; do not feel bound by the existing
components, layout, or copy.

If a screenshot of the current build is useful for reference, ask the
engineering team — it is deliberately not embedded here.

---

## 1. What the app does

The user uploads one video file. They pick a **source language** (the
language of the on-screen text) and a **target language** (what they
want the text replaced with). The server runs a five-stage computer-
vision pipeline that:

1. Detects text regions in the video.
2. Warps each region to a flat, upright image.
3. Replaces the flat image's text with the target-language equivalent,
   preserving font, colour, and style.
4. Propagates the edited text across every frame where it appears.
5. Reverts the edits back into the original video geometry.

When the pipeline finishes, the user can preview the translated video
inline and download it.

The pipeline is slow — seconds per stage for short clips, minutes for
longer ones. Live progress is a first-class feature, not a nice-to-
have. Designing around silence and uncertainty is a core part of the
brief.

## 2. Audience and setting

- **Primary user**: the research team presenter, operating the app in
  front of an audience at a live demo.
- **Secondary user**: an audience member on the same network running
  the flow on their own laptop.
- **Not designed for**: anonymous public traffic, mobile-first use, or
  accessibility-regulated production contexts. Desktop browsers
  (Chrome, Firefox, Safari) at typical laptop widths are the baseline
  target. Tablet-friendly is a nice-to-have; mobile is explicitly not.
- **Concurrency**: the server runs **one job at a time**. A second
  upload while a job is running is rejected — the UI must make that
  obvious and offer a way to rejoin the running job.

## 3. End-to-end user flow (happy path)

1. User arrives on the app.
2. User selects a video file, a source language, and a target language,
   then submits.
3. The upload transfers to the server (can take a while for large
   files).
4. The pipeline begins. The UI conveys progress through five stages,
   streams a live log, and surfaces any errors.
5. On success, the user can preview the translated video and download
   it.
6. The user can start a new job, which resets the flow. They can also
   delete the finished job, which removes its files from the server.

Two branches from step 4:
- **Failure**: same flow position, but the result is an error instead
  of a preview. The user can still start a new job.
- **Rejoin**: if the user lands on the app (fresh visit, refresh, or
  second user attempt) while a job is already running, they should end
  up watching that job's progress — not blocked.

## 4. Required states

The UI must convey each of the following states clearly and
unambiguously. **How** they are visualised is entirely the designer's
call.

| State            | Entered when                                         | What the UI must convey                                                                 |
|------------------|------------------------------------------------------|------------------------------------------------------------------------------------------|
| **Idle**         | App load; after "start a new job"                    | The input affordances (file, two languages, submit). Validation state of the inputs.     |
| **Uploading**    | Submit fired; bytes in flight                        | That the upload is in progress and cannot be cancelled by the normal flow.               |
| **Connecting**   | Upload complete; waiting for the first progress event | That the job was accepted and work is about to begin.                                   |
| **Running**      | Pipeline has started                                 | Which stage is active, which stages are done, how long each done stage took, live log.   |
| **Succeeded**    | Pipeline finished                                    | A playable preview of the result, a way to download it, a way to start over or delete.   |
| **Failed**       | Pipeline errored                                     | An error message, optional deeper detail (traceback), a way to start over or delete.     |
| **Rejoin-blocked** | User tries to start a new job while one is running | That another job is already running and a way to jump into its progress view.           |

All interactions the UI must support across these states:
- Pick a video file (via picker and/or drag-and-drop).
- Pick a source language and a target language from a server-provided
  list.
- Validate that source ≠ target before submitting.
- Submit the form.
- Observe stage progress and log output while running.
- Play the result video inline on success.
- Download the result video on success.
- Start a new job from a terminal state.
- Delete a finished job (removes server-side files).
- Rejoin a running job from the "already running" block.

## 4.1 Component inventory (functional)

The interactions above decompose into the following conceptual
components. These are **named by purpose only** — layout, size,
shape, colour, iconography, grouping, and whether any of them share
a container are entirely the designer's call. Two items on this list
may become one element in the final design (or vice versa).

| Component                   | Purpose                                                                           |
|-----------------------------|------------------------------------------------------------------------------------|
| App identity                | Tells the user what this tool is for on first arrival.                            |
| File input                  | Lets the user provide a video file from their machine (picker and/or drop).       |
| File summary                | Confirms which file is selected, after selection.                                 |
| Oversize indication         | Warns the user that the selected file is over the 200 MB server cap.              |
| Source-language picker      | Lets the user choose the language of the on-screen text.                          |
| Target-language picker      | Lets the user choose the language to translate to.                                |
| Same-language validation    | Tells the user source and target must differ before they submit.                  |
| Submit control              | Kicks off the upload + job. Reflects in-flight state while uploading.             |
| Submit-error display        | Surfaces language, size, concurrency, and generic upload errors.                  |
| Rejoin control              | Lets the user jump into the currently running job when submit is blocked.         |
| Job identity                | Identifies which job is being observed (may be minimal or omitted).               |
| Overall job status          | A single-glance "what's happening" indicator (idle / connecting / running / done / failed). |
| Stage progress indicator    | Shows which of the five pipeline stages are pending / active / done, with per-stage durations when known. |
| Live log feed               | Streams pipeline log lines in real time; three severity levels; scrollable.       |
| Result preview              | Plays the translated video inline.                                                |
| Result download control     | Saves the translated video to disk.                                               |
| Failure display             | Shows the error message and an optional deeper detail (traceback).                |
| Start-new-job control       | Resets the view back to the idle state on a terminal job.                         |
| Delete-job control          | Removes the finished job and its files from the server.                           |
| Delete-error display        | Surfaces delete failures (e.g. "still running") and lets the user recover.        |

## 5. Data the UI must display

Content inventory. Every item below is dynamic; plan space for it.

| Content                                    | Source                                          | Variability                                                  |
|--------------------------------------------|-------------------------------------------------|--------------------------------------------------------------|
| Selected filename                          | Browser (`File.name`)                           | Arbitrary length; must handle long names gracefully          |
| Selected file size                         | Browser (`File.size`)                           | Up to 200 MB; render in a friendly unit                      |
| Language list (code + label)               | `GET /api/languages`                            | 7 today (English, Spanish, Chinese Simplified, French, German, Japanese, Korean); may grow |
| Job identifier                             | Server-generated UUID                           | 36 chars; UI typically shows only a short prefix             |
| Current stage status                       | SSE `stage_start` / `stage_complete` events     | One of five stages; may advance or regress on reconnect re-sync |
| Completed stage durations                  | `duration_ms` field on `stage_complete`         | Sub-second up to minutes                                     |
| Log lines                                  | SSE `log` events                                | 0 – hundreds per run; each 20–200 chars; three severity levels (info / warning / error) |
| Error message                              | SSE `error` event or `/status.error`            | Single line                                                  |
| Error traceback                            | Optional field on `error` event                 | Multi-line (Python traceback)                                |
| Result video                               | `GET /api/jobs/{id}/output` (H.264 MP4)         | Any resolution the user uploaded                             |

The pipeline's five stages have internal codes **S1–S5**. Current
frontend labels are Detect / Frontalize / Edit / Propagate / Revert —
these are technical jargon and are **explicitly up for redesign**.
Feel free to rename to user-facing verbs.

Log lines are the most variable piece of copy; plan for both short
single lines and long wrapped lines, and plan for the panel to be
scrolled to by the user (they may want to read earlier lines without
the view snapping).

## 6. Error conditions the UI must handle

Every item below is something the server will produce that the UI
must surface to the user. The designer decides **how** (alert,
inline, modal, toast — their call).

| Trigger                                                    | Where it happens        | Information available                                                |
|------------------------------------------------------------|-------------------------|----------------------------------------------------------------------|
| Language code not supported                                | Submit                  | Which code was rejected                                              |
| File exceeds 200 MB                                        | Submit / during upload  | The size cap is 200 MB                                               |
| Job already running on the server                          | Submit                  | The active job's UUID (user should be able to rejoin it)             |
| Any other upload failure                                   | Submit                  | HTTP status + detail string                                          |
| Language list failed to load                               | Initial app load        | HTTP error detail                                                    |
| Pipeline crashed during the run                            | Running                 | One-line message + optional multi-line traceback                     |
| Tried to delete a job that is still running                | Terminal screen         | (server refuses; UI must recover gracefully)                         |
| Any other delete failure                                   | Terminal screen         | HTTP status + detail string                                          |

An **oversize file** is also useful to surface **before** submit as a
soft warning, so the user knows the server will reject it.

## 7. Timing, feedback, and uncertainty

- **Language list fetch** — sub-second on localhost. Must not block
  the overall app — the user should be able to see the app while it
  loads, but cannot submit until it resolves.
- **Upload duration** — linear with file size and bandwidth. A 200 MB
  upload over a slow link takes minutes. The browser exposes upload
  progress events if a progress bar is desired — currently there is
  none, and this is a known gap worth closing in the redesign.
- **Job duration** — wall-clock seconds to many minutes depending on
  video length and text density. Stage 3 (the AI model) is almost
  always the slowest; the others range from seconds to tens of
  seconds.
- **Log cadence** — bursty. Dozens of lines per second while active,
  minutes of silence possible (especially during Stage 3). The UI
  should **not** imply "stalled" purely from silence.
- **There is no server-provided ETA or percent-complete.** The only
  progress signal is stage transitions + log volume. The redesign may
  choose to compute a heuristic ETA if it wants one; engineering does
  not ship one today.
- **SSE reconnects are silent** — if the event stream drops, the
  browser reconnects automatically and the UI re-syncs the current
  stage by polling `/status`. Log lines emitted during the gap are
  lost. The redesign does not need to expose the reconnect to the
  user.

## 8. Inputs required from the user

| Input           | Type                                 | Required | Notes                                                                 |
|-----------------|--------------------------------------|----------|-----------------------------------------------------------------------|
| Video file      | File (MP4 / MOV / WebM / AVI, ≤200 MB) | Yes    | Picker and drag-and-drop both desirable                               |
| Source language | Code from `GET /api/languages`       | Yes      | Default suggestion is English, but designer can rethink               |
| Target language | Code from `GET /api/languages`       | Yes      | Must differ from source; the UI must validate before submit           |
| Submit          | Action                               | —        | Only enabled when file + two distinct languages are present           |
| Start new job   | Action                               | —        | Available on terminal states                                          |
| Delete job      | Action                               | —        | Available on terminal states; server removes files, irreversible      |
| Rejoin          | Action                               | —        | Available on the "already running" error                              |

The language-list contents **must not be hardcoded** in the design
mockups — the server is the source of truth and the list may change.
Use placeholder labels, or ask engineering for the current list.

## 9. Non-obvious technical constraints

These shape what the designer can and cannot ask engineering for.

- **The language list is server-driven**; do not duplicate it in the
  design.
- **Job IDs are UUID4 strings** (36 chars). Showing the full id in the
  UI is visually heavy; hiding it entirely is fine.
- **The result video is H.264 MP4** and plays in every modern
  browser's native `<video>` element. Custom scrubbing, frame
  stepping, or overlay chrome requires replacing that element, which
  is feasible but not free.
- **Download is a direct link to an endpoint**; the browser handles the
  save dialog. Right-click "Save link as" is expected to work.
- **A job cannot be cancelled mid-run.** The server has no cancel
  signal. "Delete" only works on finished jobs.
- **The entire app is one URL.** There is no router today. If the
  redesign wants multi-page (e.g. `/` for idle, `/jobs/{id}` for
  running), engineering can add that; flag it explicitly so it's
  planned.
- **No auth, no history.** Each visit is fresh unless a job is
  already running.

## 10. Accessibility requirements

Targets (not current-implementation descriptions — treat these as
requirements for the new design):

- **Keyboard-operable**: every interactive affordance (file picker,
  language selects, submit, start-over, delete, rejoin, log scroll)
  must be reachable and activatable without a mouse.
- **Screen-reader labels**: every form control must have an associated
  label; the active pipeline stage must be announced non-disruptively
  when it changes.
- **Colour-independent state**: pipeline progress, error state, and
  oversize warnings must be distinguishable without relying on colour
  alone.
- **Focus indication**: visible focus ring on all interactive
  elements.
- **Motion-sensitivity**: any running-state animation (pulse, spinner,
  bar) should honour `prefers-reduced-motion`.
- **Live log panel**: consider a live-region strategy that does not
  fire an announcement per line (which would be overwhelming).

## 11. Explicitly out of scope

Not shipping in this iteration. If the designer spec's them, they
will become follow-up work, not MVP:

- Auth, profiles, multi-user.
- Persistent job history across sessions or server restarts.
- Cancel a running job.
- Queueing multiple jobs.
- Frame-level debug previews or intermediate-stage images.
- Sample video library.
- Custom config beyond source/target language (fonts, thresholds,
  etc.).
- Mobile-optimised breakpoints.
- Internationalising the app chrome itself (the UI is English-only;
  only the scene text gets translated).

## 12. Questions worth raising before the redesign starts

1. **Target widths and form factors.** Demo laptop is ~1440 px. Do we
   need a tablet layout? Mobile is explicitly out.
2. **Dark mode.** Should it exist? Toggled by the user, by system
   preference, or fixed?
3. **Upload progress.** Currently no bar — worth speccing?
4. **Stage vocabulary.** Keep internal terms or rename to user-facing
   verbs? (The internal terms are Detect / Frontalize / Edit /
   Propagate / Revert.)
5. **Log panel as a first-class surface vs. progressive disclosure.**
   A technical demo audience benefits from it; a general audience may
   not.
6. **ETA or percent-complete.** Engineering does not provide one. Do
   we invent one?
7. **Branding.** No logo, no team identity, no footer credits today.
   Should there be?
8. **Delete confirmation.** Currently one-click; irreversible but
   low-stakes. Add a confirm step?

---

**Document owner**: engineering team. Update §5 (data shown) and §6
(errors) when the server API changes; everything else should remain
stable as long as the product scope stays as described in §1–§2.
