/**
 * <StageProgress> — pipeline progress strip rewritten to the mockup vocabulary.
 *
 * Two rows inside a single <section>:
 *   1. Five tiles (<li>) for S1..S5. Each tile carries its number, label, and
 *      either the completed duration (`X.Ys`) when done or the live elapsed
 *      tick (`Ns`) when active. Active tile gets `role="status"` and a static
 *      accent ring so the state reads even under `prefers-reduced-motion`
 *      (Risk R9). A subtle pulse on the active tile's dot is a motion bonus
 *      that `globals.css` dampens for reduced-motion users.
 *   2. An elapsed row: clock icon + full-width stripe meter + a live clock
 *      readout. The stripe meter is decorative — it does not encode %
 *      progress. It lives on purely to signal "something is happening" during
 *      the long Stage 3.
 *
 * Failed stage handling (R-noted path): if `failedStage` is set the matching
 * tile is rendered with fail styling regardless of its `state`, and all tiles
 * *after* it are forced to pending (they never ran). Tiles before it keep
 * whatever state the caller supplied (typically "done").
 *
 * `activeStageElapsedMs`, `currentStage`, and `failedStage` are optional
 * so a caller that only has the two canonical fields (`stages`,
 * `stageDurations`) can mount the component without tick wiring.
 */

import { Check, Clock } from "lucide-react";

import type { Stage } from "@/api/schemas";
import type { StageState } from "@/hooks/useJobStream";
import { cn } from "@/lib/utils";

// Human label map. Kept inline — RejoinCard has its own copy (Step 13 note);
// extract into a shared util only when a third caller shows up.
const STAGE_META: Array<{ stage: Stage; label: string }> = [
  { stage: "s1", label: "Detect" },
  { stage: "s2", label: "Frontalize" },
  { stage: "s3", label: "Edit" },
  { stage: "s4", label: "Propagate" },
  { stage: "s5", label: "Revert" },
];

// Visual state per tile. `fail` is a rendering override — it is never in the
// `StageState` union that `useJobStream` emits (that union is the truth about
// "did this stage finish?"). `failedStage` from props maps to this.
type TileState = StageState | "fail";

export interface StageProgressProps {
  stages: Record<Stage, StageState>;
  stageDurations: Partial<Record<Stage, number>>;
  /** Live tick for the currently-active stage in ms. When omitted, the tick
   *  readout is suppressed. */
  activeStageElapsedMs?: number;
  /** Active stage code — same info as `stages[s] === "active"`, but made
   *  explicit so the elapsed-row readout doesn't have to re-derive it. */
  currentStage?: Stage | null;
  /** If the pipeline failed, which stage failed. Forces fail styling on that
   *  tile + pending on later tiles. */
  failedStage?: Stage | null;
}

/** "4200" → "4.2s" */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Integer-second tick readout. "5000" → "5s" */
function formatTick(ms: number): string {
  return `${Math.floor(ms / 1000)}s`;
}

/** "00:42" · "1:23:45" for >=1h. */
function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function stageCode(stage: Stage): string {
  return stage.toUpperCase();
}

/** Index of a stage in the canonical 0..4 order. */
function stageIndex(stage: Stage): number {
  return STAGE_META.findIndex((m) => m.stage === stage);
}

/** Resolve the visible state of a single tile, accounting for failedStage. */
function resolveTileState(
  stage: Stage,
  rawState: StageState,
  failedStage: Stage | null | undefined,
): TileState {
  if (!failedStage) return rawState;
  const failedAt = stageIndex(failedStage);
  const here = stageIndex(stage);
  if (here === failedAt) return "fail";
  if (here > failedAt) return "pending";
  return rawState;
}

export function StageProgress({
  stages,
  stageDurations,
  activeStageElapsedMs,
  currentStage,
  failedStage,
}: StageProgressProps) {
  // Elapsed-row readout: prefer the live running tick, fall back to total
  // when everything is done, otherwise a neutral em-dash.
  const allDone = STAGE_META.every(({ stage }) => stages[stage] === "done");
  let elapsedReadout: string;
  if (
    !failedStage &&
    currentStage &&
    activeStageElapsedMs !== undefined
  ) {
    elapsedReadout = `${stageCode(currentStage)}/5 \u00B7 ${formatClock(activeStageElapsedMs)}`;
  } else if (allDone && !failedStage) {
    const total = STAGE_META.reduce(
      (acc, { stage }) => acc + (stageDurations[stage] ?? 0),
      0,
    );
    elapsedReadout = `5/5 \u00B7 ${formatClock(total)}`;
  } else {
    elapsedReadout = "\u2014"; // em-dash placeholder
  }

  return (
    <section className="flex flex-col">
      <ol
        aria-label="Pipeline progress"
        className="flex w-full items-stretch gap-2"
      >
        {STAGE_META.map(({ stage, label }) => {
          const rawState = stages[stage];
          const tileState = resolveTileState(stage, rawState, failedStage);
          const isActive = tileState === "active";
          const isDone = tileState === "done";
          const isFail = tileState === "fail";
          const isPending = tileState === "pending";

          const duration = stageDurations[stage];
          // Duration slot: done → completed duration; active → live tick (if
          // provided); fail → completed-partial duration (useful for "crashed
          // after 8s" readout); pending → nothing.
          let tickText: string | null = null;
          if (isDone && duration !== undefined) {
            tickText = formatDuration(duration);
          } else if (isActive && activeStageElapsedMs !== undefined) {
            tickText = formatTick(activeStageElapsedMs);
          } else if (isFail && duration !== undefined) {
            tickText = formatDuration(duration);
          }

          return (
            <li
              key={stage}
              // role="status" lives only on the single active tile so the a11y
              // tree stays quiet once the pipeline hits a terminal state.
              role={isActive ? "status" : undefined}
              data-stage={stage}
              data-state={tileState}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-start gap-1 rounded-md border p-3 transition-colors",
                isPending &&
                  "border-border bg-[color:var(--bg-2)] text-muted-foreground",
                isActive &&
                  "border-[color:var(--acc-line)] bg-[color:var(--acc-soft)] text-foreground ring-1 ring-[color:var(--acc-line)]",
                isDone &&
                  "border-[color:var(--acc-line)] bg-[color:var(--bg-2)] text-foreground",
                isFail &&
                  "border-[color:var(--err-line)] bg-[color:var(--err-soft)] text-[color:var(--err)]",
              )}
            >
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {stageCode(stage)}
              </span>
              <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                {isDone && (
                  <Check
                    aria-hidden
                    className="h-3 w-3 text-[color:var(--acc)]"
                  />
                )}
                {isActive && (
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--acc)]"
                  />
                )}
                <span className="truncate">{label}</span>
              </span>
              {tickText !== null && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {tickText}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-2 px-1 pt-3 font-mono text-[11px] text-muted-foreground">
        <Clock aria-hidden className="h-3.5 w-3.5 opacity-60" />
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-[color:var(--bg-3)]">
          <div className="stripe-fill h-full w-full animate-stripe-flow" />
        </div>
        <span>{elapsedReadout}</span>
      </div>
    </section>
  );
}
