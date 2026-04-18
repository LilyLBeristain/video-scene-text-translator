/**
 * Root app shell — state-machine owner for the entire web client.
 *
 * A single <AppShell>-based layout driven by a discriminated `UiState` union
 * (plan.md D7). Left and right columns are slot props composed per-phase.
 *
 * Phases
 * ------
 *   idle       — no file, or file picked but not yet submitted. Dropzone,
 *                language pair, submit enabled when valid.
 *   uploading  — XHR in flight. File + langs locked; UploadProgress on the
 *                right. Transitions to `active` on 201, back to `idle` on
 *                4xx (with an inline alert), or to `rejoin` on 409.
 *   rejoin     — server said "another job is running". Show RejoinCard with
 *                the blocking job's /status metadata + Rejoin CTA.
 *   active     — <ActiveView> instantiates `useJobStream` once and composes
 *                both left-column submit bar + right-column progress surface
 *                off of the same hook state. A single SSE subscription per
 *                active job.
 *
 * Transitions and guards follow plan.md's UI state-machine section verbatim.
 * Nothing here pokes at the child hook — every transition lands in the
 * reducer via a plain `dispatch({...})`.
 *
 * Keybinds
 * --------
 * Cmd/Ctrl+Enter submits when `phase === "idle"` and the form is valid.
 * Implemented via a document-level `keydown` listener in a `useEffect`.
 *
 * Mid-upload abort
 * ----------------
 * We keep the upload's `AbortController` in a ref so the XHR is cancelled on
 * unmount. We do not expose a cancel button — that's deferred (see plan's
 * deferred list for the `↻ replace` chip).
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { ApiError, createJob, deleteJob, getJobStatus, getLanguages } from "@/api/client";
import type {
  JobCreateResponse,
  JobStatus,
  Language,
  UploadProgress as UploadProgressSnapshot,
} from "@/api/schemas";

import { AppShell } from "@/components/AppShell";
import { Dropzone } from "@/components/Dropzone";
import { LogPanel } from "@/components/LogPanel";
import { ResultPanel } from "@/components/ResultPanel";
import { StageProgress } from "@/components/StageProgress";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { LanguagePair } from "@/components/left/LanguagePair";
import { LeftColumn } from "@/components/left/LeftColumn";
import { SubmitBar } from "@/components/left/SubmitBar";
import { VideoCard } from "@/components/left/VideoCard";

import { FailureCard } from "@/components/right/FailureCard";
import { IdlePlaceholder } from "@/components/right/IdlePlaceholder";
import { RejoinCard } from "@/components/right/RejoinCard";
import { StatusBand, type StatusBandKind } from "@/components/right/StatusBand";
import { UploadProgress } from "@/components/right/UploadProgress";

import {
  useJobStream,
  type JobStreamState,
} from "@/hooks/useJobStream";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

const DEFAULT_SOURCE = "en";
const DEFAULT_TARGET = "es";
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // matches server cap

/**
 * Errors surfaced when the submit attempt keeps us in `idle`. 409 is NOT
 * part of this union — it transitions to `rejoin`, not back to idle.
 */
type SubmitError =
  | { kind: "size"; message: string }
  | { kind: "lang"; message: string }
  | { kind: "other"; message: string };

function errorTitle(err: SubmitError): string {
  switch (err.kind) {
    case "size":
      return "File too large";
    case "lang":
      return "Invalid language code";
    default:
      return "Upload failed";
  }
}

type UiState =
  | {
      phase: "idle";
      file: File | null;
      source: string;
      target: string;
      submitError?: SubmitError;
    }
  | {
      phase: "uploading";
      file: File;
      source: string;
      target: string;
      progress: UploadProgressSnapshot;
    }
  | {
      phase: "rejoin";
      file: File;
      source: string;
      target: string;
      blockingJobId: string;
      blockingStatus: JobStatus | null;
    }
  | {
      phase: "active";
      jobId: string;
      file: File | null;
      source: string;
      target: string;
    };

type Action =
  | { type: "pickFile"; file: File | null }
  | { type: "setSource"; code: string }
  | { type: "setTarget"; code: string }
  | { type: "swap" }
  | { type: "startUpload" }
  | { type: "uploadProgress"; progress: UploadProgressSnapshot }
  | { type: "uploadSucceeded"; jobId: string }
  | {
      type: "uploadBlocked";
      blockingJobId: string;
      blockingStatus: JobStatus | null;
    }
  | { type: "uploadFailed"; error: SubmitError }
  | { type: "blockingStatusLoaded"; status: JobStatus }
  | { type: "rejoinClicked" }
  | { type: "dismissError" }
  | { type: "reset" };

function initialUploadProgress(fileSize: number): UploadProgressSnapshot {
  return {
    loaded: 0,
    total: fileSize,
    percent: 0,
    bytesPerSec: null,
    etaSeconds: null,
  };
}

function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case "pickFile": {
      if (state.phase !== "idle") return state;
      return { ...state, file: action.file, submitError: undefined };
    }
    case "setSource": {
      if (state.phase !== "idle") return state;
      return { ...state, source: action.code };
    }
    case "setTarget": {
      if (state.phase !== "idle") return state;
      return { ...state, target: action.code };
    }
    case "swap": {
      if (state.phase !== "idle") return state;
      return { ...state, source: state.target, target: state.source };
    }
    case "startUpload": {
      if (state.phase !== "idle" || state.file === null) return state;
      return {
        phase: "uploading",
        file: state.file,
        source: state.source,
        target: state.target,
        progress: initialUploadProgress(state.file.size),
      };
    }
    case "uploadProgress": {
      if (state.phase !== "uploading") return state;
      return { ...state, progress: action.progress };
    }
    case "uploadSucceeded": {
      if (state.phase === "uploading") {
        return {
          phase: "active",
          jobId: action.jobId,
          file: state.file,
          source: state.source,
          target: state.target,
        };
      }
      return state;
    }
    case "uploadBlocked": {
      if (state.phase !== "uploading") return state;
      return {
        phase: "rejoin",
        file: state.file,
        source: state.source,
        target: state.target,
        blockingJobId: action.blockingJobId,
        blockingStatus: action.blockingStatus,
      };
    }
    case "uploadFailed": {
      if (state.phase !== "uploading") return state;
      return {
        phase: "idle",
        file: state.file,
        source: state.source,
        target: state.target,
        submitError: action.error,
      };
    }
    case "blockingStatusLoaded": {
      if (state.phase !== "rejoin") return state;
      if (action.status.job_id !== state.blockingJobId) return state;
      return { ...state, blockingStatus: action.status };
    }
    case "rejoinClicked": {
      if (state.phase !== "rejoin") return state;
      return {
        phase: "active",
        jobId: state.blockingJobId,
        file: null,
        source: state.source,
        target: state.target,
      };
    }
    case "dismissError": {
      if (state.phase !== "idle") return state;
      if (!state.submitError) return state;
      return { ...state, submitError: undefined };
    }
    case "reset": {
      return {
        phase: "idle",
        file: null,
        source: DEFAULT_SOURCE,
        target: DEFAULT_TARGET,
      };
    }
    default:
      return state;
  }
}

function initialUiState(): UiState {
  return {
    phase: "idle",
    file: null,
    source: DEFAULT_SOURCE,
    target: DEFAULT_TARGET,
  };
}

// ---------------------------------------------------------------------------
// Misc helpers.
// ---------------------------------------------------------------------------

/**
 * Tiered-unit bytes formatter — the same 6-line helper that UploadProgress
 * inlines. Duplicated twice for now (plan Step 14: "rule of three. When
 * Step 15 polishes, we can extract."). Base-1024 to match MB/GB intuition.
 */
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function errorFromApi(err: unknown): SubmitError {
  if (err instanceof ApiError) {
    if (err.status === 413) {
      return {
        kind: "size",
        message: `File too large (server cap is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB).`,
      };
    }
    if (err.status === 400) {
      return {
        kind: "lang",
        message:
          typeof err.detail === "string"
            ? `Invalid language code: ${err.detail}`
            : "Invalid language code.",
      };
    }
    return {
      kind: "other",
      message:
        typeof err.detail === "string"
          ? `Upload failed: ${err.detail}`
          : `Upload failed (status ${err.status}).`,
    };
  }
  return {
    kind: "other",
    message: `Upload failed: ${(err as Error)?.message ?? "unknown error"}`,
  };
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialUiState);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [languagesError, setLanguagesError] = useState<string | null>(null);

  // Abort controller for the in-flight XHR upload. Kept in a ref so the
  // submit handler has a stable handle to cancel on unmount. We never flip
  // the UI into "cancelled" — if the user navigates away mid-upload the XHR
  // rejects with AbortError and the component is gone anyway.
  const uploadAbortRef = useRef<AbortController | null>(null);

  // Languages fetch (once on mount).
  useEffect(() => {
    let cancelled = false;
    getLanguages()
      .then((langs) => {
        if (cancelled) return;
        setLanguages(langs);
      })
      .catch((e) => {
        if (cancelled) return;
        setLanguagesError(
          `Could not load language list: ${(e as Error)?.message ?? "unknown error"}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Unmount cleanup: abort any in-flight upload.
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
  }, []);

  // Blocking-job /status fetch (on transition into rejoin).
  const blockingJobId =
    state.phase === "rejoin" ? state.blockingJobId : null;
  useEffect(() => {
    if (!blockingJobId) return;
    let cancelled = false;
    getJobStatus(blockingJobId)
      .then((status) => {
        if (cancelled) return;
        dispatch({ type: "blockingStatusLoaded", status });
      })
      .catch(() => {
        // Non-fatal — the card falls back to generic copy.
      });
    return () => {
      cancelled = true;
    };
  }, [blockingJobId]);

  // Submit derived-state + handler.
  const idleCanSubmit =
    state.phase === "idle" &&
    state.file !== null &&
    state.source !== "" &&
    state.target !== "" &&
    state.source !== state.target;

  const handleSubmit = useCallback(() => {
    if (state.phase !== "idle") return;
    if (!state.file) return;
    if (state.source === "" || state.target === "") return;
    if (state.source === state.target) return;

    const file = state.file;
    const source = state.source;
    const target = state.target;

    dispatch({ type: "startUpload" });

    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    createJob(file, source, target, {
      signal: controller.signal,
      onProgress: (progress) => {
        dispatch({ type: "uploadProgress", progress });
      },
    })
      .then((resp: JobCreateResponse) => {
        dispatch({ type: "uploadSucceeded", jobId: resp.job_id });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        if (err instanceof ApiError && err.status === 409) {
          const detail = err.concurrentJobDetail;
          const blockingId = detail?.active_job_id ?? "";
          if (!blockingId) {
            dispatch({
              type: "uploadFailed",
              error: {
                kind: "other",
                message:
                  "A job is already running on the server, but the server didn't return the id.",
              },
            });
            return;
          }
          dispatch({
            type: "uploadBlocked",
            blockingJobId: blockingId,
            blockingStatus: null,
          });
          return;
        }

        dispatch({ type: "uploadFailed", error: errorFromApi(err) });
      })
      .finally(() => {
        if (uploadAbortRef.current === controller) {
          uploadAbortRef.current = null;
        }
      });
  }, [state]);

  // Cmd/Ctrl+Enter submit keybind (idle phase only).
  useEffect(() => {
    if (state.phase !== "idle") return;
    if (!idleCanSubmit) return;

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Enter") return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      handleSubmit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state.phase, idleCanSubmit, handleSubmit]);

  const handleReset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  // For the `active` phase we delegate to <ActiveView>, which instantiates
  // `useJobStream` ONCE and composes both the left submit bar + right
  // progress surface off the same hook state (one SSE stream per job).
  if (state.phase === "active") {
    return (
      <ActiveView
        state={state}
        languages={languages}
        onReset={handleReset}
      />
    );
  }

  return (
    <AppShell
      left={
        <LeftColumn
          fileSlot={renderFileSlotForNonActive(state, (f) =>
            dispatch({ type: "pickFile", file: f }),
          )}
          languagePairSlot={renderLanguagePairSlotForNonActive(
            state,
            languages,
            dispatch,
          )}
          submitSlot={renderSubmitSlotForNonActive(
            state,
            idleCanSubmit,
            handleSubmit,
          )}
        />
      }
      right={
        <NonActiveRightColumn
          state={state}
          onRejoin={() => dispatch({ type: "rejoinClicked" })}
          onDismissError={() => dispatch({ type: "dismissError" })}
          languagesError={languagesError}
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Slot renderers (idle / uploading / rejoin).
// ---------------------------------------------------------------------------

type NonActiveState = Exclude<UiState, { phase: "active" }>;

function renderFileSlotForNonActive(
  state: NonActiveState,
  onPickFile: (f: File | null) => void,
): JSX.Element {
  switch (state.phase) {
    case "idle":
      return (
        <Dropzone
          currentFile={state.file}
          onFileSelected={onPickFile}
          maxSizeBytes={MAX_UPLOAD_BYTES}
        />
      );
    case "uploading":
      return (
        <VideoCard
          file={state.file}
          variant="input"
          sourceLang={state.source}
        />
      );
    case "rejoin":
      return <VideoCard file={state.file} variant="queued" />;
  }
}

function renderLanguagePairSlotForNonActive(
  state: NonActiveState,
  languages: Language[],
  dispatch: React.Dispatch<Action>,
): JSX.Element {
  switch (state.phase) {
    case "idle": {
      const sameLang =
        state.source === state.target && state.source !== "";
      const footer = sameLang
        ? "SOURCE AND TARGET MUST DIFFER"
        : "SOURCE \u2260 TARGET";
      return (
        <LanguagePair
          source={state.source}
          target={state.target}
          languages={languages}
          onSourceChange={(code) => dispatch({ type: "setSource", code })}
          onTargetChange={(code) => dispatch({ type: "setTarget", code })}
          onSwap={() => dispatch({ type: "swap" })}
          footer={footer}
        />
      );
    }
    case "uploading":
      return (
        <LanguagePair
          source={state.source}
          target={state.target}
          languages={languages}
          onSourceChange={() => {}}
          onTargetChange={() => {}}
          onSwap={() => {}}
          disabled
          footer={"\u25CF LOCKED WHILE UPLOADING"}
        />
      );
    case "rejoin":
      return (
        <LanguagePair
          source={state.source}
          target={state.target}
          languages={languages}
          onSourceChange={() => {}}
          onTargetChange={() => {}}
          onSwap={() => {}}
          locked
          footer={"\u25CF HOLD WHILE JOB FINISHES"}
        />
      );
  }
}

function renderSubmitSlotForNonActive(
  state: NonActiveState,
  idleCanSubmit: boolean,
  onSubmit: () => void,
): JSX.Element {
  switch (state.phase) {
    case "idle": {
      const hint = state.file
        ? "\u2318\u21B5 or click to submit"
        : "Pick a video and two languages";
      return (
        <SubmitBar
          kind="idle"
          canSubmit={idleCanSubmit}
          onSubmit={onSubmit}
          hint={hint}
        />
      );
    }
    case "uploading": {
      const bytesLabel = `${formatBytes(state.progress.loaded)} / ${formatBytes(state.progress.total)}`;
      return (
        <SubmitBar
          kind="uploading"
          percent={state.progress.percent}
          bytesLabel={bytesLabel}
        />
      );
    }
    case "rejoin":
      return <SubmitBar kind="running" />;
  }
}

// ---------------------------------------------------------------------------
// Non-active right column (idle / uploading / rejoin).
// ---------------------------------------------------------------------------

interface NonActiveRightColumnProps {
  state: NonActiveState;
  onRejoin: () => void;
  onDismissError: () => void;
  languagesError: string | null;
}

function NonActiveRightColumn({
  state,
  onRejoin,
  onDismissError,
  languagesError,
}: NonActiveRightColumnProps): JSX.Element {
  const kind: StatusBandKind =
    state.phase === "idle"
      ? "idle"
      : state.phase === "uploading"
        ? "uploading"
        : "blocked";

  return (
    <>
      <StatusBand kind={kind} />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        {state.phase === "idle" && (
          <>
            <IdlePlaceholder />
            {state.submitError && (
              <Alert variant="destructive">
                <AlertTitle>{errorTitle(state.submitError)}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{state.submitError.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onDismissError}
                  >
                    Dismiss
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {languagesError && (
              <Alert variant="destructive">
                <AlertTitle>Languages unavailable</AlertTitle>
                <AlertDescription>{languagesError}</AlertDescription>
              </Alert>
            )}
          </>
        )}
        {state.phase === "uploading" && (
          <UploadProgress
            progress={state.progress}
            filename={state.file.name}
          />
        )}
        {state.phase === "rejoin" && (
          <div className="flex flex-1 items-center justify-center">
            <RejoinCard
              blockingJobId={state.blockingJobId}
              blockingStatus={state.blockingStatus}
              onRejoin={onRejoin}
            />
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Active view — owns the single `useJobStream` call and composes both
// columns off its state. Rendered only while `phase === "active"`.
// ---------------------------------------------------------------------------

interface ActiveState {
  phase: "active";
  jobId: string;
  file: File | null;
  source: string;
  target: string;
}

interface ActiveViewProps {
  state: ActiveState;
  languages: Language[];
  onReset: () => void;
}

function ActiveView({
  state,
  languages,
  onReset,
}: ActiveViewProps): JSX.Element {
  const { state: streamState } = useJobStream(state.jobId);

  return (
    <AppShell
      left={
        <LeftColumn
          fileSlot={renderActiveFileSlot(state)}
          languagePairSlot={renderActiveLanguagePairSlot(state, languages)}
          submitSlot={
            <ActiveSubmitSlot
              jobId={state.jobId}
              streamState={streamState}
              onReset={onReset}
            />
          }
        />
      }
      right={<ActiveRightColumn jobId={state.jobId} streamState={streamState} />}
    />
  );
}

function renderActiveFileSlot(state: ActiveState): JSX.Element {
  if (state.file !== null) {
    return <VideoCard file={state.file} variant="queued" />;
  }
  return <RemoteJobPlaceholder />;
}

function renderActiveLanguagePairSlot(
  state: ActiveState,
  languages: Language[],
): JSX.Element {
  if (state.file === null) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Source and target determined by the remote job.
      </p>
    );
  }
  return (
    <LanguagePair
      source={state.source}
      target={state.target}
      languages={languages}
      onSourceChange={() => {}}
      onTargetChange={() => {}}
      onSwap={() => {}}
      locked
      footer={"\u25CF LOCKED WHILE RUNNING"}
    />
  );
}

interface ActiveSubmitSlotProps {
  jobId: string;
  streamState: JobStreamState;
  onReset: () => void;
}

function ActiveSubmitSlot({
  jobId,
  streamState,
  onReset,
}: ActiveSubmitSlotProps): JSX.Element {
  const [isDeleting, setIsDeleting] = useState(false);

  const terminal =
    streamState.status === "succeeded" || streamState.status === "failed";

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteJob(jobId);
      onReset();
    } catch {
      // Terminal jobs shouldn't 409; we don't surface the failure here.
      // Step 15 can wire a better affordance if this becomes visible.
    } finally {
      setIsDeleting(false);
    }
  }, [jobId, onReset]);

  if (terminal) {
    return (
      <SubmitBar
        kind="terminal"
        onReset={onReset}
        onDelete={handleDelete}
        isDeleting={isDeleting}
      />
    );
  }
  return <SubmitBar kind="running" />;
}

interface ActiveRightColumnProps {
  jobId: string;
  streamState: JobStreamState;
}

function ActiveRightColumn({
  jobId,
  streamState,
}: ActiveRightColumnProps): JSX.Element {
  const kind: StatusBandKind =
    streamState.status === "connecting"
      ? "connecting"
      : streamState.status === "running"
        ? "running"
        : streamState.status === "succeeded"
          ? "succeeded"
          : "failed";

  const isRunning = streamState.status === "running";
  const failedStage =
    streamState.status === "failed"
      ? (streamState.currentStage ?? null)
      : null;

  return (
    <>
      <StatusBand kind={kind} />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        <StageProgress
          stages={streamState.stages}
          stageDurations={streamState.stageDurations}
          activeStageElapsedMs={streamState.activeStageElapsedMs}
          currentStage={streamState.currentStage}
          failedStage={failedStage}
        />
        {(streamState.status === "connecting" || isRunning) && (
          <LogPanel
            logs={streamState.logs}
            currentStage={streamState.currentStage}
            isRunning={isRunning}
          />
        )}
        {streamState.status === "succeeded" && (
          <>
            <LogPanel
              logs={streamState.logs}
              currentStage={streamState.currentStage}
              isRunning={false}
            />
            {streamState.outputUrl && (
              <ResultPanel jobId={jobId} outputUrl={streamState.outputUrl} />
            )}
          </>
        )}
        {streamState.status === "failed" && streamState.error && (
          <>
            <LogPanel
              logs={streamState.logs}
              currentStage={streamState.currentStage}
              isRunning={false}
            />
            <FailureCard
              message={streamState.error.message}
              traceback={streamState.error.traceback ?? null}
            />
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Rejoin-active placeholder: renders in the file slot when we entered the
// active phase via Rejoin (so we don't have the blocking job's original file
// to preview).
// ---------------------------------------------------------------------------

function RemoteJobPlaceholder(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex aspect-video items-center justify-center rounded-md border border-[color:var(--line-2)] bg-[color:var(--bg-2)]">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Other session {"\u00B7"} no local file
        </p>
      </div>
    </div>
  );
}
