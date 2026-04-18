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
      ["running", /PIPELINE.+ONE WINDOW/i],
      ["succeeded", /RESULT.+SAME WINDOW/i],
      ["failed", /FAILURE.+SAME WINDOW/i],
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
});
