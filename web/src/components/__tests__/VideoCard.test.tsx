/**
 * Tests for <VideoCard> — the picked-file preview surface used in the left
 * column once the user has selected a video. Behavior under test:
 *
 *   1. Renders a <video> element + the filename + the formatted size
 *   2. Calls URL.createObjectURL on mount and URL.revokeObjectURL on unmount
 *      with the same URL (R4 — blob URL leak prevention)
 *   3. Corner-tag text varies by `variant` (and by optional `sourceLang`)
 *
 * jsdom has no real <video> role, so assertions query via
 * `container.querySelector("video")` (matches the web/CLAUDE.md gotcha).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { VideoCard } from "../left/VideoCard";

function makeFile(name = "clip.mp4", bytes = 2 * 1024 * 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "video/mp4" });
}

// We stub URL.createObjectURL / revokeObjectURL at the global level. jsdom
// does not implement these (they're no-ops in some versions, entirely
// absent in others), so we define-then-spy rather than spyOn directly.
const BLOB_URL = "blob:mock-url-sentinel";

beforeEach(() => {
  // Install no-op implementations so `vi.spyOn` has a property to wrap.
  (URL as unknown as { createObjectURL: (f: unknown) => string }).createObjectURL =
    () => BLOB_URL;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
    () => undefined;
  vi.spyOn(URL, "createObjectURL").mockReturnValue(BLOB_URL);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<VideoCard>", () => {
  it("renders a <video> element plus the filename and formatted size", () => {
    const file = makeFile("interview_cut_v3.mp4", 2 * 1024 * 1024);
    const { container, getByText } = render(
      <VideoCard file={file} variant="input" />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe(BLOB_URL);

    expect(getByText("interview_cut_v3.mp4")).toBeInTheDocument();
    // 2 MB file → "2.0 MB"
    expect(getByText(/2\.0\s*MB/i)).toBeInTheDocument();
  });

  it("revokes the blob URL on unmount (R4)", () => {
    const file = makeFile();
    const { unmount } = render(
      <VideoCard file={file} variant="input" />,
    );

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it("renders 'INPUT' corner tag by default when variant is 'input'", () => {
    const { getByText } = render(
      <VideoCard file={makeFile()} variant="input" />,
    );
    expect(getByText("INPUT")).toBeInTheDocument();
  });

  it("renders 'INPUT · EN' when variant='input' and sourceLang is provided", () => {
    const { getByText } = render(
      <VideoCard file={makeFile()} variant="input" sourceLang="en" />,
    );
    expect(getByText(/INPUT\s*·\s*EN/)).toBeInTheDocument();
  });

  it("renders 'YOUR INPUT · QUEUED' when variant='queued'", () => {
    const { getByText } = render(
      <VideoCard file={makeFile()} variant="queued" />,
    );
    expect(getByText(/YOUR INPUT\s*·\s*QUEUED/)).toBeInTheDocument();
  });
});
