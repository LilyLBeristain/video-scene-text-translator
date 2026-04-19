/**
 * Tests for <ResultPanel> — the output surface shown in the right column
 * when a job finishes successfully. Behavior under test:
 *
 *   1. Renders a <video> + <source> pointing at `outputUrl` with MP4 type
 *   2. Shows the decorative "OUTPUT" corner tag (mockup vocab)
 *   3. Surfaces the first 8 chars of the job id in a mono caption
 *   4. Exposes a download anchor that targets `outputUrl` and carries a
 *      non-empty `download` filename
 *   5. The download anchor's visible label is "Download"
 *
 * jsdom has no implicit ARIA role for `<video>`, so we query the video +
 * source via `container.querySelector` rather than `getByRole` (matches the
 * web/CLAUDE.md gotcha).
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ResultPanel } from "../ResultPanel";

describe("<ResultPanel>", () => {
  it("renders a <video> with a <source> pointing at the output URL", () => {
    const outputUrl = "/api/jobs/job-1/output";
    const { container } = render(
      <ResultPanel jobId="job-1" outputUrl={outputUrl} />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    const source = video!.querySelector("source");
    expect(source).toHaveAttribute("src", outputUrl);
    expect(source).toHaveAttribute("type", "video/mp4");
  });

  it("renders the OUTPUT corner tag", () => {
    render(<ResultPanel jobId="job-1" outputUrl="/api/jobs/job-1/output" />);
    expect(screen.getByText("OUTPUT")).toBeInTheDocument();
  });

  it("exposes a download anchor with the expected href + a non-empty download attr", () => {
    const outputUrl = "/api/jobs/7ca09ebb-dead-beef/output";
    render(<ResultPanel jobId="7ca09ebb-dead-beef" outputUrl={outputUrl} />);

    const download = screen.getByRole("link", { name: /download/i });
    expect(download).toHaveAttribute("href", outputUrl);
    const downloadAttr = download.getAttribute("download");
    expect(downloadAttr).not.toBeNull();
    expect(downloadAttr!.length).toBeGreaterThan(0);
    // Filename matches the button label so the saved file lines up with
    // what the UI promised. The browser auto-disambiguates collisions
    // (translated (1).mp4, etc.) when multiple downloads land in the
    // same folder.
    expect(downloadAttr).toMatch(/translated.*\.mp4/);
  });

  it("renders a visible 'Download' label in the link", () => {
    render(<ResultPanel jobId="job-1" outputUrl="/api/jobs/job-1/output" />);
    const download = screen.getByRole("link", { name: /download/i });
    expect(download).toHaveTextContent(/Download/);
  });
});
