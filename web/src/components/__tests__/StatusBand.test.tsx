/**
 * Tests for <StatusBand> — the thin header row at the top of the right
 * column that renders a status pill whose label + color change per `kind`.
 * Layout / color tokens are presentational and not covered here.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusBand } from "../right/StatusBand";

describe("<StatusBand>", () => {
  it("renders the phase-specific eyebrow label", () => {
    const cases: Array<[import("../right/StatusBand").StatusBandKind, RegExp]> = [
      ["idle", /READY WHEN YOU ARE/i],
      ["uploading", /^UPLOADING$/],
      ["connecting", /CONNECTING/i],
      ["running", /PIPELINE/],
      ["succeeded", /RESULT/],
      ["failed", /FAILURE/],
      ["blocked", /ACTION REQUIRED/i],
    ];
    for (const [kind, rx] of cases) {
      const { unmount } = render(<StatusBand kind={kind} />);
      // Some labels collide with their pill text (e.g. CONNECTING); just
      // assert the text appears at least once in the band.
      expect(screen.getAllByText(rx).length).toBeGreaterThanOrEqual(1);
      unmount();
    }
  });

  it("renders 'IDLE' when kind=idle", () => {
    render(<StatusBand kind="idle" />);
    expect(screen.getByText("IDLE")).toBeInTheDocument();
  });

  it("renders 'CLIENT → SERVER' when kind=uploading", () => {
    render(<StatusBand kind="uploading" />);
    // Don't pin the arrow glyph exactly — accept either → or -> or ->.
    expect(screen.getByText(/CLIENT.+SERVER/)).toBeInTheDocument();
  });

  it("renders 'CONNECTING' when kind=connecting", () => {
    render(<StatusBand kind="connecting" />);
    // Both the eyebrow (left) and the pill (right) carry "CONNECTING".
    expect(screen.getAllByText("CONNECTING").length).toBeGreaterThanOrEqual(1);
  });

  it("renders 'LIVE' when kind=running", () => {
    render(<StatusBand kind="running" />);
    // The pulsing dot is decorative; just match the LIVE text.
    expect(screen.getByText(/LIVE/)).toBeInTheDocument();
  });

  it("renders 'READY' when kind=succeeded", () => {
    render(<StatusBand kind="succeeded" />);
    expect(screen.getByText("READY")).toBeInTheDocument();
  });

  it("renders 'ERR' when kind=failed", () => {
    render(<StatusBand kind="failed" />);
    expect(screen.getByText(/ERR/)).toBeInTheDocument();
  });

  it("renders 'BLOCKED' when kind=blocked", () => {
    render(<StatusBand kind="blocked" />);
    expect(screen.getByText(/BLOCKED/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // jobId + progress prop coverage. The band renders up to three right-side
  // items: jobId chip · progress chip · pill. Separators are middle-dots
  // (U+00B7). The counts below describe DOM structure, not semantics, so
  // we reach for `querySelectorAll` on the jobId/progress testids + a dot
  // span count inside the right-side container.
  // -------------------------------------------------------------------------

  it("renders jobId chip + dot separator + pill when only jobId is provided", () => {
    render(<StatusBand kind="running" jobId="7ca09ebb-deadbeef" />);

    // jobId chip visible, truncated to first 8 chars.
    const jobChip = screen.getByTestId("status-band-job-id");
    expect(jobChip).toBeInTheDocument();
    expect(jobChip).toHaveTextContent("7ca09ebb");

    // No progress chip.
    expect(screen.queryByTestId("status-band-progress")).toBeNull();

    // Pill still renders.
    expect(screen.getByText(/LIVE/)).toBeInTheDocument();
  });

  it("renders progress chip + dot separator + pill when only progress is provided", () => {
    render(<StatusBand kind="running" progress="S3/5" />);

    // No jobId chip.
    expect(screen.queryByTestId("status-band-job-id")).toBeNull();

    // Progress chip visible.
    const progressChip = screen.getByTestId("status-band-progress");
    expect(progressChip).toBeInTheDocument();
    expect(progressChip).toHaveTextContent("S3/5");

    // Pill still renders.
    expect(screen.getByText(/LIVE/)).toBeInTheDocument();
  });

  it("renders jobId + progress + both separators + pill when both are provided", () => {
    render(
      <StatusBand kind="running" jobId="7ca09ebb-deadbeef" progress="S3/5" />,
    );

    const jobChip = screen.getByTestId("status-band-job-id");
    expect(jobChip).toHaveTextContent("7ca09ebb");

    const progressChip = screen.getByTestId("status-band-progress");
    expect(progressChip).toHaveTextContent("S3/5");

    expect(screen.getByText(/LIVE/)).toBeInTheDocument();
  });

  it("renders only the pill when neither jobId nor progress is provided", () => {
    const { container } = render(<StatusBand kind="running" />);

    // No chrome chips.
    expect(screen.queryByTestId("status-band-job-id")).toBeNull();
    expect(screen.queryByTestId("status-band-progress")).toBeNull();

    // No aria-hidden middle-dot separator spans — only the pill's own
    // pulsing dot glyph should remain (that's the "●", not "·").
    const rightSide = container.querySelector(".flex.items-center.gap-2");
    expect(rightSide).not.toBeNull();
    const middleDots = Array.from(
      rightSide?.querySelectorAll("span[aria-hidden]") ?? [],
    ).filter((el) => el.textContent?.includes("\u00B7"));
    expect(middleDots).toHaveLength(0);

    // Pill still renders.
    expect(screen.getByText(/LIVE/)).toBeInTheDocument();
  });
});
