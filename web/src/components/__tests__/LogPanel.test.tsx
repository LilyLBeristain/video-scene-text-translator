/**
 * Tests for <LogPanel>. Covers the mockup-vocabulary rewrite:
 *   - empty state copy
 *   - each line renders [HH:MM:SS] + severity chip (INFO/WARN/ERROR) + body
 *   - stage-separator regex bolds "=== Stage N ===" lines (loose pattern)
 *   - severity classnames reference the right token var
 *   - header "N lines" pill
 *   - plain auto-scroll on log growth (no escape hatch)
 *   - S3 silence hint only appears when currentStage==="s3" && isRunning===true
 *   - large log arrays don't crash rendering
 *
 * jsdom doesn't lay out, so for the auto-scroll assertion we stub
 * `scrollHeight` via Object.defineProperty and observe that the component
 * writes it into `scrollTop`.
 */

import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { LogPanel } from "../LogPanel";

describe("<LogPanel>", () => {
  it("shows the empty-state hint when logs is empty", () => {
    const { getByText } = render(<LogPanel logs={[]} />);
    expect(getByText(/waiting for pipeline output/i)).toBeInTheDocument();
  });

  it("renders each log line with timestamp, severity chip, and body", () => {
    const logs = [
      { level: "info" as const, message: "alpha", ts: 1 },
      { level: "warning" as const, message: "beta", ts: 2 },
      { level: "error" as const, message: "gamma", ts: 3 },
    ];

    const { container, getByText } = render(<LogPanel logs={logs} />);

    const lines = container.querySelectorAll("[data-testid='log-line']");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.textContent).toContain("alpha");
    expect(lines[1]!.textContent).toContain("beta");
    expect(lines[2]!.textContent).toContain("gamma");

    // Severity chips show the truncated labels.
    expect(getByText("INFO")).toBeInTheDocument();
    expect(getByText("WARN")).toBeInTheDocument();
    expect(getByText("ERROR")).toBeInTheDocument();
  });

  it("bolds '=== Stage N ===' lines via the .hdr class", () => {
    const logs = [
      { level: "info" as const, message: "=== Stage 3 ===", ts: 1 },
      { level: "info" as const, message: "==== Stage 10 ====", ts: 2 },
      { level: "info" as const, message: "plain body", ts: 3 },
    ];

    const { container } = render(<LogPanel logs={logs} />);
    const lines = container.querySelectorAll(
      "[data-testid='log-line']",
    ) as NodeListOf<HTMLElement>;

    expect(lines[0]!.className).toContain("hdr");
    expect(lines[1]!.className).toContain("hdr");
    expect(lines[2]!.className).not.toContain("hdr");
  });

  it("paints the error severity chip with the --err color token", () => {
    const logs = [{ level: "error" as const, message: "boom", ts: 1 }];
    const { container } = render(<LogPanel logs={logs} />);
    const line = container.querySelector(
      "[data-testid='log-line']",
    ) as HTMLElement;
    // The chip carries the color class; we look for the token substring so
    // we don't couple to the full Tailwind utility string.
    expect(line.innerHTML).toContain("var(--err)");
  });

  it("shows the log-count pill in the header", () => {
    const logs = Array.from({ length: 7 }, (_, i) => ({
      level: "info" as const,
      message: `line ${i}`,
      ts: i,
    }));
    const { getByText } = render(<LogPanel logs={logs} />);
    expect(getByText("7 lines")).toBeInTheDocument();
  });

  it("auto-scrolls to the bottom whenever logs grow", async () => {
    const first = [{ level: "info" as const, message: "first", ts: 1 }];
    const { container, rerender } = render(<LogPanel logs={first} />);

    const panel = container.querySelector(
      "[data-testid='log-panel']",
    ) as HTMLElement;
    expect(panel).not.toBeNull();

    // jsdom doesn't compute layout; fake scrollHeight so the effect has
    // something to assign to scrollTop.
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 1234,
    });

    rerender(
      <LogPanel
        logs={[
          ...first,
          { level: "info" as const, message: "second", ts: 2 },
        ]}
      />,
    );

    await waitFor(() => expect(panel.scrollTop).toBe(1234));

    // Another append → should auto-follow unconditionally (no escape hatch).
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 2468,
    });
    rerender(
      <LogPanel
        logs={[
          ...first,
          { level: "info" as const, message: "second", ts: 2 },
          { level: "info" as const, message: "third", ts: 3 },
        ]}
      />,
    );
    await waitFor(() => expect(panel.scrollTop).toBe(2468));
  });

  it("shows the S3 silence hint only when currentStage='s3' and isRunning", () => {
    const logs = [{ level: "info" as const, message: "x", ts: 1 }];

    const { queryByTestId, rerender } = render(
      <LogPanel logs={logs} currentStage="s3" isRunning={true} />,
    );
    expect(queryByTestId("s3-hint")).not.toBeNull();

    rerender(<LogPanel logs={logs} currentStage="s3" isRunning={false} />);
    expect(queryByTestId("s3-hint")).toBeNull();

    rerender(<LogPanel logs={logs} currentStage="s4" isRunning={true} />);
    expect(queryByTestId("s3-hint")).toBeNull();

    // Back-compat: both props omitted → hint absent.
    rerender(<LogPanel logs={logs} />);
    expect(queryByTestId("s3-hint")).toBeNull();
  });

  it("renders a large number of log lines without crashing", () => {
    const logs = Array.from({ length: 200 }, (_, i) => ({
      level: "info" as const,
      message: `line ${i}`,
      ts: i,
    }));
    const { container } = render(<LogPanel logs={logs} />);
    expect(
      container.querySelectorAll("[data-testid='log-line']"),
    ).toHaveLength(200);
  });
});
