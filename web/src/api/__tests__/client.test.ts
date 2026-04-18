/**
 * Unit tests for api/client.ts. Mocks global `fetch` via `vi.stubGlobal`.
 *
 * We only exercise the wrapper behaviors — happy-path decoding, multipart
 * shape, FastAPI `{detail: ...}` unwrapping, and the `ApiError` accessor for
 * the 409 concurrent-job body. End-to-end integration with the real server
 * lives in tests on the server side.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createJob,
  deleteJob,
  eventsUrl,
  getJobStatus,
  getLanguages,
  outputUrl,
} from "../client";
import type { JobStatus, Language, UploadProgress } from "../schemas";

type FetchArgs = Parameters<typeof fetch>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function errorJsonResponse(
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api/client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("getLanguages returns the parsed array", async () => {
    const langs: Language[] = [
      { code: "en", label: "English" },
      { code: "es", label: "Spanish" },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(langs));

    const out = await getLanguages();

    expect(out).toEqual(langs);
    const [url] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("/api/languages");
  });

  // createJob is no longer exercised via `fetch` — it moved to XHR as part
  // of Step 2 (plan D1). Multipart shape + happy path + 409 handling now
  // live in the `createJob — XHR upload progress` describe block below.

  it("getJobStatus returns the parsed status body", async () => {
    const status: JobStatus = {
      job_id: "abc",
      status: "running",
      source_lang: "en",
      target_lang: "es",
      created_at: 1_700_000_000,
      current_stage: "s2",
      finished_at: null,
      error: null,
      output_available: false,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(status));

    const out = await getJobStatus("abc");

    expect(out).toEqual(status);
    const [url] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("/api/jobs/abc/status");
  });

  it("getJobStatus URL-encodes the job id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({} as JobStatus));
    await getJobStatus("a b/c");
    const [url] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("/api/jobs/a%20b%2Fc/status");
  });

  it("deleteJob issues DELETE to the right URL and returns the payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ deleted: "abc", ts: 1_700_000_010 }),
    );

    const out = await deleteJob("abc");

    expect(out).toEqual({ deleted: "abc", ts: 1_700_000_010 });
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("/api/jobs/abc");
    expect(init?.method).toBe("DELETE");
  });

  it("outputUrl and eventsUrl return the expected paths", () => {
    expect(outputUrl("abc")).toBe("/api/jobs/abc/output");
    expect(eventsUrl("abc")).toBe("/api/jobs/abc/events");
    // encoding
    expect(outputUrl("a b")).toBe("/api/jobs/a%20b/output");
  });

  it("non-2xx throws ApiError with correct status and unwrapped detail", async () => {
    fetchMock.mockResolvedValueOnce(
      errorJsonResponse(400, { detail: "unsupported source_lang: xx" }),
    );

    await expect(getLanguages()).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      detail: "unsupported source_lang: xx",
    });
  });

  it("ApiError.concurrentJobDetail returns null for non-409 errors", async () => {
    // Exercise the accessor on a fetch-path error so we still cover it
    // outside the XHR describe block below. `getLanguages` is the closest
    // shared-helper analog.
    fetchMock.mockResolvedValueOnce(
      errorJsonResponse(413, { detail: "upload too big" }),
    );

    let caught: ApiError | null = null;
    try {
      await getLanguages();
    } catch (e) {
      caught = e as ApiError;
    }

    expect(caught?.status).toBe(413);
    expect(caught?.concurrentJobDetail).toBeNull();
  });

  it("handleResponse tolerates non-JSON error bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream timeout", {
        status: 504,
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(getLanguages()).rejects.toMatchObject({
      name: "ApiError",
      status: 504,
      detail: "upstream timeout",
    });
  });
});

// ---------------------------------------------------------------------------
// createJob — XHR upload progress
// ---------------------------------------------------------------------------
//
// `createJob` is the only request that needs upload-progress telemetry, so it
// runs on `XMLHttpRequest` instead of `fetch` (plan D1). The tests below use a
// hand-rolled `FakeXMLHttpRequest` that models just the surface the client
// touches: open/send/abort, onload/onerror/onabort, an upload event target,
// and the status/responseText pair. Tests drive the fake via `_emitProgress`
// / `_complete` / `_fail` helpers rather than poking readyState directly.

type UploadListener = (ev: { loaded: number; total: number }) => void;

class FakeUpload {
  private listeners: UploadListener[] = [];

  addEventListener(type: "progress", fn: UploadListener): void {
    if (type === "progress") this.listeners.push(fn);
  }

  removeEventListener(type: "progress", fn: UploadListener): void {
    if (type !== "progress") return;
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  _dispatch(ev: { loaded: number; total: number }): void {
    for (const fn of this.listeners) fn(ev);
  }
}

class FakeXMLHttpRequest {
  // Populated by client.ts
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  // Response-side fields the client reads.
  status = 0;
  responseText = "";
  responseURL = "";

  // Request-side fields the tests introspect.
  method = "";
  url = "";
  body: FormData | null = null;
  requestHeaders: Record<string, string> = {};
  aborted = false;
  sent = false;

  readonly upload = new FakeUpload();

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.requestHeaders[key] = value;
  }

  send(body: FormData): void {
    this.body = body;
    this.sent = true;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  getResponseHeader(name: string): string | null {
    if (name.toLowerCase() === "content-type") return "application/json";
    return null;
  }

  // --- test helpers ---------------------------------------------------------

  _emitProgress(loaded: number, total: number): void {
    this.upload._dispatch({ loaded, total });
  }

  _complete(status: number, responseText: string): void {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }

  _fail(): void {
    this.onerror?.();
  }
}

describe("createJob — XHR upload progress", () => {
  const OriginalXHR = globalThis.XMLHttpRequest;
  let instances: FakeXMLHttpRequest[] = [];

  beforeEach(() => {
    instances = [];
    class TrackedXHR extends FakeXMLHttpRequest {
      constructor() {
        super();
        instances.push(this);
      }
    }
    // jsdom's XMLHttpRequest is a full class; we only need the shape the
    // client touches, so a structural cast is fine for tests.
    (globalThis as unknown as { XMLHttpRequest: typeof TrackedXHR }).XMLHttpRequest =
      TrackedXHR;
  });

  afterEach(() => {
    (globalThis as unknown as { XMLHttpRequest: typeof OriginalXHR }).XMLHttpRequest =
      OriginalXHR;
    vi.useRealTimers();
  });

  function latestXhr(): FakeXMLHttpRequest {
    const xhr = instances[instances.length - 1];
    if (!xhr) throw new Error("no XHR instance was constructed");
    return xhr;
  }

  it("resolves with the parsed body on 201 when no onProgress is given", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
      type: "video/mp4",
    });

    const promise = createJob(file, "en", "es");

    // Flush microtasks so the client gets a chance to wire up the XHR.
    await Promise.resolve();

    const xhr = latestXhr();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/jobs");
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get("source_lang")).toBe("en");
    expect((xhr.body as FormData).get("target_lang")).toBe("es");
    expect(((xhr.body as FormData).get("video") as File).name).toBe("clip.mp4");
    // Must NOT set Content-Type — FormData carries its own boundary.
    expect(xhr.requestHeaders["Content-Type"]).toBeUndefined();

    xhr._complete(201, JSON.stringify({ job_id: "abc-123" }));

    await expect(promise).resolves.toEqual({ job_id: "abc-123" });
  });

  it("emits UploadProgress snapshots: bytesPerSec=null under 1s, computed after", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4");
    const snapshots: UploadProgress[] = [];

    const promise = createJob(file, "en", "es", {
      onProgress: (p) => snapshots.push(p),
    });

    await Promise.resolve();
    const xhr = latestXhr();

    // t=0ms — first progress, no elapsed yet.
    xhr._emitProgress(500, 1000);

    // t=500ms — still under 1s.
    vi.advanceTimersByTime(500);
    xhr._emitProgress(750, 1000);

    // t=2000ms — elapsed is 2s, 1000 bytes in, throughput should compute.
    vi.advanceTimersByTime(1500);
    xhr._emitProgress(1000, 1000);

    xhr._complete(201, JSON.stringify({ job_id: "x" }));
    await promise;

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]).toEqual({
      loaded: 500,
      total: 1000,
      percent: 50,
      bytesPerSec: null,
      etaSeconds: null,
    });
    expect(snapshots[1]).toEqual({
      loaded: 750,
      total: 1000,
      percent: 75,
      bytesPerSec: null,
      etaSeconds: null,
    });
    expect(snapshots[2]?.loaded).toBe(1000);
    expect(snapshots[2]?.total).toBe(1000);
    expect(snapshots[2]?.percent).toBe(100);
    // 1000 bytes over 2s = 500 B/s; ETA 0.
    expect(snapshots[2]?.bytesPerSec).toBe(500);
    expect(snapshots[2]?.etaSeconds).toBe(0);
  });

  it("unwraps FastAPI concurrent-job 409 into ApiError.concurrentJobDetail", async () => {
    const promise = createJob(new File([], "x.mp4"), "en", "es");
    await Promise.resolve();

    latestXhr()._complete(
      409,
      JSON.stringify({
        detail: { error: "concurrent_job", active_job_id: "existing-id" },
      }),
    );

    let caught: ApiError | null = null;
    try {
      await promise;
    } catch (e) {
      caught = e as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(409);
    expect(caught?.concurrentJobDetail).toEqual({
      error: "concurrent_job",
      active_job_id: "existing-id",
    });
  });

  it("rejects with ApiError(0) on network error", async () => {
    const promise = createJob(new File([], "x.mp4"), "en", "es");
    await Promise.resolve();

    latestXhr()._fail();

    let caught: unknown = null;
    try {
      await promise;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(0);
  });

  it("aborts the XHR and rejects with AbortError when the signal fires", async () => {
    const controller = new AbortController();
    const promise = createJob(new File([], "x.mp4"), "en", "es", {
      signal: controller.signal,
    });
    await Promise.resolve();

    const xhr = latestXhr();
    controller.abort();

    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects immediately without sending when passed a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const promise = createJob(new File([], "x.mp4"), "en", "es", {
      signal: controller.signal,
    });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    // No XHR should have been constructed at all.
    expect(instances).toHaveLength(0);
  });

  it("degrades cleanly when total=0 (no divide-by-zero, no rate)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const snapshots: UploadProgress[] = [];
    const promise = createJob(new File([], "x.mp4"), "en", "es", {
      onProgress: (p) => snapshots.push(p),
    });
    await Promise.resolve();
    const xhr = latestXhr();

    // Browser fires progress before it knows the total size.
    xhr._emitProgress(123, 0);

    // Even with elapsed > 1s, we still can't compute rate when total is 0.
    vi.advanceTimersByTime(2000);
    xhr._emitProgress(456, 0);

    xhr._complete(201, JSON.stringify({ job_id: "x" }));
    await promise;

    expect(snapshots[0]).toEqual({
      loaded: 123,
      total: 0,
      percent: 0,
      bytesPerSec: null,
      etaSeconds: null,
    });
    expect(snapshots[1]?.percent).toBe(0);
    expect(snapshots[1]?.bytesPerSec).toBeNull();
    expect(snapshots[1]?.etaSeconds).toBeNull();
  });
});
