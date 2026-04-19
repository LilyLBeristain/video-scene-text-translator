/**
 * Tests for <UploadProgress> — the right-column surface shown while the
 * XHR upload is in flight. Per plan D1, `UploadProgress` snapshots come
 * from `api/schemas.ts` and may have `bytesPerSec`/`etaSeconds` null until
 * the throughput estimator has > ~1s of samples (R2 — divide-by-zero guard).
 *
 * Pinned contract:
 *   1. Big percent number renders from `progress.percent`.
 *   2. Secondary line does the KB/MB math correctly.
 *   3. Nullable throughput fields degrade to "—" (never "NaN", never "Infinity").
 *   4. Zero `total` still renders "0%" without division errors.
 *   5. role="progressbar" exposes the numeric percent for a11y.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { UploadProgress as UploadProgressSnapshot } from "@/api/schemas";

import { UploadProgress } from "../right/UploadProgress";

function snapshot(
  overrides: Partial<UploadProgressSnapshot> = {},
): UploadProgressSnapshot {
  return {
    loaded: 0,
    total: 0,
    percent: 0,
    bytesPerSec: null,
    etaSeconds: null,
    ...overrides,
  };
}

describe("<UploadProgress>", () => {
  it("renders the percent number from progress.percent", () => {
    render(
      <UploadProgress
        progress={snapshot({
          loaded: 4_200_000,
          total: 10_000_000,
          percent: 42,
          bytesPerSec: 1_000_000,
          etaSeconds: 6,
        })}
        filename="sample.mp4"
      />,
    );

    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("renders the bytes math + throughput on the secondary line", () => {
    render(
      <UploadProgress
        progress={snapshot({
          loaded: 1_500_000,
          total: 10_000_000,
          percent: 15,
          bytesPerSec: 500_000,
          etaSeconds: 17,
        })}
        filename="sample.mp4"
      />,
    );

    // KB/MB formatting: 1_500_000 B -> 1.4 MB, 10_000_000 B -> 9.5 MB,
    // 500_000 B/s -> 488.3 KB/s (below 1 MB threshold).
    // We assert on a combined substring so the test survives minor glyph
    // tweaks (en-dash vs middle-dot separators) as long as the numbers land.
    expect(screen.getByText(/1\.4 MB/)).toBeInTheDocument();
    expect(screen.getByText(/9\.5 MB/)).toBeInTheDocument();
    expect(screen.getByText(/488\.3 KB\/s/)).toBeInTheDocument();
  });

  it("degrades to '—' when bytesPerSec and etaSeconds are null (R2)", () => {
    const { container } = render(
      <UploadProgress
        progress={snapshot({
          loaded: 500_000,
          total: 10_000_000,
          percent: 5,
          bytesPerSec: null,
          etaSeconds: null,
        })}
        filename="sample.mp4"
      />,
    );

    // Never render NaN / Infinity when throughput is unknown.
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).not.toMatch(/Infinity/);

    // The em dash is the explicit degrade symbol. The component renders
    // it at least once (ETA line). Tolerate multiple instances.
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);

    // Percent still rendered + progressbar semantics still valid.
    expect(screen.getByText("5%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
  });

  it("renders '0%' when total is 0 and does not divide by zero", () => {
    const { container } = render(
      <UploadProgress
        progress={snapshot({
          loaded: 0,
          total: 0,
          percent: 0,
          bytesPerSec: null,
          etaSeconds: null,
        })}
        filename="sample.mp4"
      />,
    );

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).not.toMatch(/Infinity/);
  });

  it("exposes percent via role='progressbar' aria-valuenow", () => {
    render(
      <UploadProgress
        progress={snapshot({
          loaded: 4_200_000,
          total: 10_000_000,
          percent: 42,
          bytesPerSec: 1_000_000,
          etaSeconds: 6,
        })}
        filename="sample.mp4"
      />,
    );

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute(
      "aria-label",
      expect.stringContaining("sample.mp4"),
    );
  });
});
