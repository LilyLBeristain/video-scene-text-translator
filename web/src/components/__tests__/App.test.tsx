/**
 * Integration tests for <App> — the Step 14 state-machine owner.
 *
 * Focus: phase transitions on the App-level UiState reducer, not exhaustive
 * markup coverage (each primitive component has its own test file).
 *
 * Mocking strategy
 * ----------------
 *   - `@/api/client` is stubbed so createJob / getLanguages / getJobStatus
 *     are controllable per test.
 *   - `@/api/sse` (openEventStream) is stubbed so the real SSE code path
 *     never fires when we transition into the `active` phase — the child
 *     `useJobStream` hook runs for real, but stays in "connecting" because
 *     no events are pushed through the captured options.
 *   - Clipboard writes are shimmed for FailureCard's sake, though these
 *     tests never reach the failure state.
 *
 * Viewport
 * --------
 * jsdom's default 1024 × 768 is below the 1080 cutoff that <AppShell>
 * guards, so every test widens `window.innerWidth` first. `beforeAll`
 * sets 1440; tests never shrink it again.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { JobStatus, Language } from "@/api/schemas";
import type { StreamOptions } from "@/api/sse";

// ---------------------------------------------------------------------------
// Module mocks (hoisted).
// ---------------------------------------------------------------------------

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    createJob: vi.fn(),
    getLanguages: vi.fn(),
    getJobStatus: vi.fn(),
    deleteJob: vi.fn(),
  };
});

vi.mock("@/api/sse", () => ({
  openEventStream: vi.fn((_jobId: string, _opts: StreamOptions) => ({
    close: vi.fn(),
    readyState: 1,
  })),
}));

import App from "../../App";
import {
  ApiError,
  createJob,
  deleteJob,
  getJobStatus,
  getLanguages,
} from "@/api/client";

// ---------------------------------------------------------------------------
// Fixtures + helpers.
// ---------------------------------------------------------------------------

const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "ja", label: "Japanese" },
];

function setViewportWidth(w: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: w,
  });
}

function makeFile(name = "clip.mp4", bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "video/mp4" });
}

async function pickFile(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByTestId("dropzone-input") as HTMLInputElement;
  await user.upload(input, makeFile());
}

function baseJobStatus(overrides: Partial<JobStatus> = {}): JobStatus {
  return {
    job_id: "blocking-xyz",
    status: "running",
    source_lang: "en",
    target_lang: "es",
    created_at: 1_700_000_000,
    current_stage: "s2",
    finished_at: null,
    error: null,
    output_available: false,
    ...overrides,
  };
}

beforeAll(() => {
  setViewportWidth(1440);
});

beforeEach(() => {
  vi.mocked(createJob).mockReset();
  vi.mocked(getLanguages).mockReset();
  vi.mocked(getJobStatus).mockReset();
  vi.mocked(deleteJob).mockReset();

  vi.mocked(getLanguages).mockResolvedValue(LANGUAGES);
  // Default: getJobStatus returns a running status — used by the hook's
  // seed fetch when we drop into the active phase.
  vi.mocked(getJobStatus).mockResolvedValue(baseJobStatus());

  // jsdom lacks URL.createObjectURL / revokeObjectURL; VideoCard uses them
  // to produce a <video src> preview. Install no-ops so mounting the card
  // doesn't throw. Pattern mirrors VideoCard.test.tsx.
  (URL as unknown as { createObjectURL: (f: unknown) => string }).createObjectURL =
    () => "blob:mock";
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
    () => undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("<App> state machine", () => {
  it("initial idle phase: IdlePlaceholder, disabled submit, IDLE status band", async () => {
    render(<App />);

    // Languages fetched on mount.
    await waitFor(() => {
      expect(vi.mocked(getLanguages)).toHaveBeenCalledTimes(1);
    });

    // StatusBand label.
    expect(screen.getByText(/^IDLE$/)).toBeInTheDocument();

    // IdlePlaceholder eyebrow copy.
    expect(screen.getByText(/WAITING FOR A JOB/i)).toBeInTheDocument();

    // Submit button present but disabled.
    const submit = screen.getByRole("button", { name: /start translation/i });
    expect(submit).toBeDisabled();

    // Hint copy mentions the preconditions.
    expect(
      screen.getByText(/Pick a video and two languages/i),
    ).toBeInTheDocument();
  });

  it("enables submit once a file is picked and the two langs differ", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );

    // Default source/target are drawn from the fetched list (en, es).
    await pickFile(user);

    const submit = screen.getByRole("button", { name: /start translation/i });
    expect(submit).toBeEnabled();
  });

  it("click submit -> uploading phase with CLIENT -> SERVER status", async () => {
    // Controllable promise so we can assert the in-flight UI before resolving.
    let resolveCreate: (v: { job_id: string }) => void = () => {};
    vi.mocked(createJob).mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveCreate = res;
        }),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );
    await pickFile(user);

    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    // Uploading submit label + CLIENT -> SERVER pill are both visible.
    expect(
      await screen.findByRole("button", { name: /uploading…/i }),
    ).toBeInTheDocument();
    // U+2192 RIGHTWARDS ARROW in the pill label.
    expect(screen.getByText(/CLIENT \u2192 SERVER/)).toBeInTheDocument();

    // Resolve and assert transition into active (connecting pill — the hook
    // seeds from getJobStatus then waits for SSE events, which our mock
    // never fires).
    resolveCreate({ job_id: "job-42" });

    await waitFor(() => {
      // After transition the uploading button is gone.
      expect(
        screen.queryByRole("button", { name: /uploading…/i }),
      ).toBeNull();
    });

    // StatusBand now reads CONNECTING (or LIVE once /status seeds). Accept
    // either — the pill labels are exclusive.
    await waitFor(() => {
      const band = screen.queryByText(/^CONNECTING$/) ?? screen.queryByText(/^LIVE$/);
      expect(band).toBeInTheDocument();
    });
  });

  it("409 on submit -> rejoin phase with RejoinCard + BLOCKED pill", async () => {
    vi.mocked(createJob).mockRejectedValueOnce(
      new ApiError(409, {
        error: "concurrent_job",
        active_job_id: "blocking-xyz",
      }),
    );
    // The blocking job's /status populates the RejoinCard metadata.
    vi.mocked(getJobStatus).mockResolvedValueOnce(
      baseJobStatus({ job_id: "blocking-xyz", current_stage: "s3" }),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );
    await pickFile(user);

    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    // RejoinCard heading appears.
    expect(
      await screen.findByRole("heading", { name: /server is busy/i }),
    ).toBeInTheDocument();

    // BLOCKED pill on the right.
    expect(screen.getByText(/^BLOCKED$/)).toBeInTheDocument();

    // The blocking id prefix renders (first 8 chars of "blocking-xyz").
    expect(screen.getByText(/blocking/)).toBeInTheDocument();

    // /status was fetched for the blocking id.
    await waitFor(() => {
      expect(vi.mocked(getJobStatus)).toHaveBeenCalledWith("blocking-xyz");
    });
  });

  it("Rejoin click transitions to active phase with the blocking job id", async () => {
    vi.mocked(createJob).mockRejectedValueOnce(
      new ApiError(409, {
        error: "concurrent_job",
        active_job_id: "blocking-xyz",
      }),
    );
    vi.mocked(getJobStatus).mockResolvedValue(
      baseJobStatus({ job_id: "blocking-xyz", current_stage: "s3" }),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );
    await pickFile(user);
    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    // Wait for the RejoinCard to render.
    const rejoinBtn = await screen.findByRole("button", {
      name: /rejoin running job/i,
    });
    await user.click(rejoinBtn);

    // After rejoin we're in the active phase — the RejoinCard is gone and
    // the status band flips off BLOCKED.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /server is busy/i }),
      ).toBeNull();
    });
    expect(screen.queryByText(/^BLOCKED$/)).toBeNull();

    // The hook's seed fetch fires against the blocking id.
    await waitFor(() => {
      expect(vi.mocked(getJobStatus)).toHaveBeenCalledWith("blocking-xyz");
    });
  });

  it("413 submit error stays in idle with a dismissible alert", async () => {
    vi.mocked(createJob).mockRejectedValueOnce(
      new ApiError(413, "upload too big"),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );
    await pickFile(user);

    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    // Alert title reads "File too large".
    expect(
      await screen.findByText("File too large"),
    ).toBeInTheDocument();
    // Alert body elaborates with the cap.
    expect(screen.getByText(/server cap/i)).toBeInTheDocument();

    // Still in idle: submit button reads "Start translation" (not "Uploading…").
    expect(
      screen.getByRole("button", { name: /start translation/i }),
    ).toBeInTheDocument();

    // Dismiss clears the alert.
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => {
      expect(screen.queryByText("File too large")).toBeNull();
    });
  });

  it("Ctrl+Enter submits when the form is valid", async () => {
    vi.mocked(createJob).mockResolvedValueOnce({ job_id: "job-kb" });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );
    await pickFile(user);

    // Fire the keydown at document level — that's where App attaches the
    // listener.
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(vi.mocked(createJob)).toHaveBeenCalledTimes(1);
    });
  });

  it("Ctrl+Enter does nothing when the form is not submittable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );
    // No file picked -> submit is not valid.

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    // Give React a tick to have called createJob if it was going to.
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(createJob)).not.toHaveBeenCalled();

    // Silence unused-var lint for `user` — keeps the setup symmetric with
    // other tests in case we extend this one.
    void user;
  });
});
