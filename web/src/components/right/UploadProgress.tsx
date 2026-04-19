/**
 * <UploadProgress> — live upload readout shown in the right column while the
 * XHR upload is in flight. Driven entirely by the `UploadProgress` snapshot
 * emitted by `createJob`'s `onProgress` callback (see api/client.ts).
 *
 * Layout follows mockup 02-uploading.png:
 *   • UPLOADING TO SERVER       (accent eyebrow with a small dot)
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ 64%                        91.2 / 142.6 MB · 8.4 MB/s       │
 *   │                                           ~ 8s remaining    │
 *   └────────────────────────────────────────────────────────────┘
 *   [==========================           ]   (thin accent bar)
 *
 *   Pipeline will start once the server finishes receiving the
 *   file. Stages, log, and ETA appear then.
 *
 * Degradation rules (plan R2):
 *   - `bytesPerSec` / `etaSeconds` are null until the throughput estimator
 *     has at least ~1s of samples. When null, render "\u2014" (em dash)
 *     instead of synthesising a speed — never show NaN / Infinity.
 *   - `total === 0` (server hasn't sent Content-Length yet) keeps the
 *     percent at 0; no division by zero — upstream already clamps this.
 *
 * A11y: the numeric blob is exposed via `role="progressbar"` with
 * `aria-valuenow` / `min` / `max`. The thin visual bar is decorative.
 */

import type { UploadProgress as UploadProgressSnapshot } from "@/api/schemas";
import { formatBytes } from "@/lib/format";

interface UploadProgressProps {
  progress: UploadProgressSnapshot;
  filename: string;
}

export function UploadProgress({
  progress,
  filename,
}: UploadProgressProps): JSX.Element {
  const { loaded, total, percent, bytesPerSec, etaSeconds } = progress;

  const throughputSegment =
    bytesPerSec !== null ? ` \u00B7 ${formatBytes(bytesPerSec)}/s` : "";
  const bytesLine = `${formatBytes(loaded)} / ${formatBytes(total)}${throughputSegment}`;

  const etaLine =
    etaSeconds !== null ? `~ ${etaSeconds}s remaining` : "\u2014";

  // Clamp the bar width so a bogus percent can't spill.
  const barPct = Math.max(0, Math.min(100, percent));

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-10">
      {/* eyebrow: small accent dot + "UPLOADING TO SERVER" */}
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[color:var(--acc)]">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--acc)]"
        />
        Uploading to server
      </div>

      {/* main readout row: big % on the left, rate + ETA stacked on the right */}
      <div className="flex w-full max-w-xl items-end justify-between gap-6">
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Uploading ${filename}`}
          className="text-6xl font-semibold leading-none tracking-tight text-foreground"
        >
          {percent}%
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <p className="font-mono text-sm text-muted-foreground">{bytesLine}</p>
          <p className="font-mono text-[11px] text-[color:var(--ink-3)]">
            {etaLine}
          </p>
        </div>
      </div>

      {/* thin accent bar */}
      <div
        aria-hidden="true"
        className="h-1 w-full max-w-xl overflow-hidden rounded-full bg-[color:var(--bg-3)]"
      >
        <div
          className="h-full bg-[color:var(--acc)] transition-[width] duration-200"
          style={{ width: `${barPct}%` }}
        />
      </div>

      {/* description paragraph — explains what happens once upload finishes */}
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Pipeline will start once the server finishes receiving the file.
        Stages and log appear then.
      </p>
    </div>
  );
}
