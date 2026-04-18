/**
 * Tests for <StageProgress>.
 *
 * The mockup vocabulary is five numbered tiles (S1..S5) plus an elapsed row
 * (clock glyph + stripe meter + live clock). We test the visible contract:
 *
 *   - all five tiles render with their S# prefix and human label
 *   - done tiles show their completed duration
 *   - an active tile shows the live elapsed tick *iff* activeStageElapsedMs
 *     is provided (callers may omit it when no live tick is available)
 *   - failedStage forces the fail styling on its tile and pending on later
 *     tiles, regardless of what the `stages` prop says
 *   - the elapsed row shows `S#/5 · MM:SS` while running and `5/5 · MM:SS`
 *     when every stage is done
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { Stage } from "@/api/schemas";
import { StageProgress } from "../StageProgress";
import type { StageState } from "@/hooks/useJobStream";

const ALL_PENDING: Record<Stage, StageState> = {
  s1: "pending",
  s2: "pending",
  s3: "pending",
  s4: "pending",
  s5: "pending",
};

const ALL_DONE: Record<Stage, StageState> = {
  s1: "done",
  s2: "done",
  s3: "done",
  s4: "done",
  s5: "done",
};

describe("<StageProgress>", () => {
  it("renders all five stage tiles with S1..S5 prefixes and labels", () => {
    render(<StageProgress stages={ALL_PENDING} stageDurations={{}} />);

    const stages = screen.getByRole("list");
    const items = within(stages).getAllByRole("listitem");
    expect(items).toHaveLength(5);

    // S# mono prefixes
    for (const code of ["S1", "S2", "S3", "S4", "S5"]) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
    // Human labels
    for (const label of [
      "Detect",
      "Frontalize",
      "Edit",
      "Propagate",
      "Revert",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Nothing is active yet — no role="status" in the tree.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the completed duration on a done tile", () => {
    render(
      <StageProgress
        stages={{ ...ALL_PENDING, s1: "done" }}
        stageDurations={{ s1: 2400 }}
      />,
    );
    // 2400ms rounds to 2.4s.
    expect(screen.getByText("2.4s")).toBeInTheDocument();
  });

  it("shows the live elapsed tick on the active tile when activeStageElapsedMs is provided", () => {
    render(
      <StageProgress
        stages={{ ...ALL_PENDING, s1: "done", s2: "done", s3: "active" }}
        stageDurations={{ s1: 4200, s2: 6100 }}
        activeStageElapsedMs={5000}
        currentStage="s3"
      />,
    );

    const active = screen.getByRole("status");
    expect(active).toHaveAttribute("data-stage", "s3");
    // Tick readout on the S3 tile, "5s" at t=5000ms.
    expect(within(active).getByText("5s")).toBeInTheDocument();
  });

  it("omits the tick on the active tile when activeStageElapsedMs is undefined (back-compat)", () => {
    render(
      <StageProgress
        stages={{ ...ALL_PENDING, s3: "active" }}
        stageDurations={{}}
      />,
    );

    const active = screen.getByRole("status");
    // The active tile still renders and is marked, but no tick readout.
    expect(active).toHaveAttribute("data-stage", "s3");
    expect(within(active).queryByText(/\ds$/)).toBeNull();
  });

  it("applies fail styling to the failed stage and forces later stages to pending", () => {
    render(
      <StageProgress
        stages={{
          s1: "done",
          s2: "done",
          // Defensively pass values that would otherwise render as active/done
          // on the later tiles — failedStage must override them.
          s3: "active",
          s4: "active",
          s5: "done",
        }}
        stageDurations={{ s1: 4200, s2: 6100, s3: 8000, s5: 1000 }}
        failedStage="s3"
      />,
    );

    // S3 is the failed tile.
    const stages = screen.getByRole("list");
    const items = within(stages).getAllByRole("listitem");
    expect(items[2]).toHaveAttribute("data-state", "fail");

    // S4 and S5 forced to pending regardless of what `stages` says.
    expect(items[3]).toHaveAttribute("data-state", "pending");
    expect(items[4]).toHaveAttribute("data-state", "pending");
  });

  it("renders the elapsed row with S#/5 and MM:SS while running", () => {
    render(
      <StageProgress
        stages={{ ...ALL_PENDING, s1: "done", s2: "done", s3: "active" }}
        stageDurations={{ s1: 4200, s2: 6100 }}
        activeStageElapsedMs={5000}
        currentStage="s3"
      />,
    );

    // "S3/5 · 00:05" — uses middle-dot separator (U+00B7).
    expect(screen.getByText(/S3\/5\s*\u00B7\s*00:05/)).toBeInTheDocument();
  });

  it("renders the elapsed row with 5/5 and the summed total when all stages are done", () => {
    render(
      <StageProgress
        stages={ALL_DONE}
        stageDurations={{ s1: 2000, s2: 3000, s3: 4000, s4: 2000, s5: 1500 }}
      />,
    );

    // 2+3+4+2+1.5 = 12.5s → "5/5 · 00:12".
    expect(screen.getByText(/5\/5\s*\u00B7\s*00:12/)).toBeInTheDocument();
  });
});
