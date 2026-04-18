/**
 * Thin fetch wrapper around the FastAPI surface in server/app/routes.py.
 *
 * Responsibilities:
 *   - Typed JSON GET/POST helpers with consistent error handling.
 *   - Multipart POST for `/api/jobs` (file + two language form fields).
 *   - `ApiError` with structured info on non-2xx, including a convenience
 *     accessor for FastAPI's 409 concurrent-job detail shape (R8).
 *
 * The `outputUrl` / `eventsUrl` helpers exist so UI code never hand-builds
 * API paths — a grep for `/api/jobs/` should only find this file.
 */

import type {
  ConcurrentJobErrorDetail,
  JobCreateResponse,
  JobStatus,
  Language,
  UploadProgress,
} from "./schemas";

const BASE = "/api";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown by every function in this module on non-2xx responses.
 *
 * `detail` holds FastAPI's unwrapped `detail` payload when the response was
 * JSON, or the raw response text otherwise. Code paths that need structured
 * handling should prefer dedicated accessors like `concurrentJobDetail`
 * rather than poking at `detail` directly.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  /** Structured 409 payload when present, else null. */
  get concurrentJobDetail(): ConcurrentJobErrorDetail | null {
    if (this.status !== 409) return null;
    const d = this.detail;
    if (
      typeof d === "object" &&
      d !== null &&
      "error" in d &&
      (d as { error: unknown }).error === "concurrent_job"
    ) {
      return d as ConcurrentJobErrorDetail;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a `fetch` Response into T, throwing ApiError on non-2xx.
 *
 * FastAPI wraps error bodies as `{"detail": ...}`; we unwrap that so
 * `ApiError.detail` always points at the *inner* payload. This keeps the
 * 409 concurrent-job handling path straightforward.
 */
async function handleResponse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail: unknown = null;
    const contentType = resp.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        detail = await resp.json();
      } else {
        detail = await resp.text();
      }
    } catch {
      // Body already consumed or malformed — fall through with null detail.
    }
    throw new ApiError(resp.status, unwrapFastapiDetail(detail));
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await resp.json()) as T;
  }
  // Fall back to text — used by the few endpoints that might return plain
  // text (none right now, but keeps the helper honest).
  return (await resp.text()) as unknown as T;
}

/**
 * FastAPI wraps error bodies as `{"detail": ...}`. Unwrap one level so
 * callers see the inner payload directly. Used by both the fetch path
 * (`handleResponse`) and the XHR path (`createJob`).
 */
function unwrapFastapiDetail(body: unknown): unknown {
  if (
    body &&
    typeof body === "object" &&
    "detail" in (body as Record<string, unknown>)
  ) {
    return (body as { detail: unknown }).detail;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getHealth(): Promise<{ status: string }> {
  const resp = await fetch(`${BASE}/health`);
  return handleResponse(resp);
}

export async function getLanguages(): Promise<Language[]> {
  const resp = await fetch(`${BASE}/languages`);
  return handleResponse(resp);
}

/**
 * Multipart POST to `/api/jobs`.
 *
 * Unlike the other helpers this one runs on `XMLHttpRequest`, not `fetch`,
 * because `fetch` has no upload-progress API and the Uploading UI state
 * needs live `%` / MB-per-second / ETA readouts (plan D1). The `onProgress`
 * callback fires on every XHR `upload.progress` event with an
 * `UploadProgress` snapshot — `bytesPerSec` and `etaSeconds` stay `null`
 * until at least ~1 s of elapsed time, guarding the divide-by-zero path on
 * browsers that coalesce progress events (plan R2).
 *
 * The fourth argument is optional so existing three-arg callers keep
 * compiling without change.
 */
export function createJob(
  video: File,
  sourceLang: string,
  targetLang: string,
  options?: {
    onProgress?: (p: UploadProgress) => void;
    signal?: AbortSignal;
  },
): Promise<JobCreateResponse> {
  const { onProgress, signal } = options ?? {};

  return new Promise<JobCreateResponse>((resolve, reject) => {
    // Fail fast on an already-aborted signal — don't even construct the XHR.
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const body = new FormData();
    body.append("video", video);
    body.append("source_lang", sourceLang);
    body.append("target_lang", targetLang);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/jobs`);
    // DO NOT set Content-Type — the browser injects the multipart boundary
    // when the body is a FormData instance. Same contract as `fetch`.

    // --- progress wiring --------------------------------------------------
    if (onProgress) {
      const startedAt = Date.now();
      xhr.upload.addEventListener("progress", (ev) => {
        const loaded = ev.loaded;
        const total = ev.total;
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        const elapsedMs = Date.now() - startedAt;
        // Only compute throughput once we have >=1s of signal AND we know
        // the total size; otherwise we'd either divide by a tiny number or
        // pretend we know how much is left when we don't.
        let bytesPerSec: number | null = null;
        let etaSeconds: number | null = null;
        if (elapsedMs >= 1000 && total > 0) {
          bytesPerSec = Math.round(loaded / (elapsedMs / 1000));
          if (bytesPerSec > 0) {
            etaSeconds = Math.round((total - loaded) / bytesPerSec);
          }
        }
        onProgress({ loaded, total, percent, bytesPerSec, etaSeconds });
      });
    }

    // --- abort wiring -----------------------------------------------------
    const onAbortSignal = () => xhr.abort();
    if (signal) {
      signal.addEventListener("abort", onAbortSignal);
    }
    const cleanupSignal = () => {
      if (signal) signal.removeEventListener("abort", onAbortSignal);
    };

    // --- terminal handlers ------------------------------------------------
    xhr.onload = () => {
      cleanupSignal();
      let parsed: unknown = null;
      const text = xhr.responseText ?? "";
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // Server emitted non-JSON — fall back to the raw text so ApiError
        // still carries something useful.
        parsed = text;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as JobCreateResponse);
        return;
      }
      reject(new ApiError(xhr.status, unwrapFastapiDetail(parsed)));
    };

    xhr.onerror = () => {
      cleanupSignal();
      reject(new ApiError(0, null, "Network error"));
    };
    xhr.ontimeout = () => {
      cleanupSignal();
      reject(new ApiError(0, null, "Network error"));
    };
    xhr.onabort = () => {
      cleanupSignal();
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.send(body);
  });
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const resp = await fetch(
    `${BASE}/jobs/${encodeURIComponent(jobId)}/status`,
  );
  return handleResponse(resp);
}

/**
 * Delete a terminal job. Returns the server's `{deleted, ts}` shape.
 * Throws ApiError(409) if the job is still running.
 */
export async function deleteJob(
  jobId: string,
): Promise<{ deleted: string; ts: number }> {
  const resp = await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  return handleResponse(resp);
}

/** URL of the final MP4 — suitable for `<a href>` or `<video src>`. */
export function outputUrl(jobId: string): string {
  return `${BASE}/jobs/${encodeURIComponent(jobId)}/output`;
}

/** URL of the SSE stream — used by `sse.ts`. */
export function eventsUrl(jobId: string): string {
  return `${BASE}/jobs/${encodeURIComponent(jobId)}/events`;
}
