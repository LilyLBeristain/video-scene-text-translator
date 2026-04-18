/**
 * Tests for <Dropzone>. The component wraps a hidden `<input type="file">`
 * so user-event's `upload()` drives both the click-to-pick and drag-drop
 * paths (drag-drop is a visual affordance; DnD in jsdom is flaky, so we
 * exercise the file input which is the fallback anyway).
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Dropzone } from "../Dropzone";

function makeFile(name: string, bytes: number, type = "video/mp4"): File {
  // File constructor accepts BlobParts — a single Uint8Array of the target
  // size keeps allocations tight and .size honest for the oversize test.
  const data = new Uint8Array(bytes);
  return new File([data], name, { type });
}

describe("<Dropzone>", () => {
  it("renders the empty-state prompt when no file is selected", () => {
    render(<Dropzone onFileSelected={vi.fn()} currentFile={null} />);
    expect(
      screen.getByText(/drop video here/i),
    ).toBeInTheDocument();
  });

  it("shows filename and MB size when currentFile is a File", () => {
    const file = makeFile("clip.mp4", 2 * 1024 * 1024);
    render(<Dropzone onFileSelected={vi.fn()} currentFile={file} />);
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    // 2 MB file → "2.0 MB" (formatted to one decimal place)
    expect(screen.getByText(/2\.0\s*MB/i)).toBeInTheDocument();
  });

  it("fires onFileSelected with the File on input change", async () => {
    const onFileSelected = vi.fn();
    render(
      <Dropzone onFileSelected={onFileSelected} currentFile={null} />,
    );
    const user = userEvent.setup();
    const file = makeFile("clip.mp4", 1024);

    // The hidden input gets `data-testid="dropzone-input"` so we don't have
    // to rely on role heuristics for `type="file"`.
    const input = screen.getByTestId("dropzone-input") as HTMLInputElement;
    await user.upload(input, file);

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("renders an oversize warning when file > maxSizeBytes", () => {
    const file = makeFile("big.mp4", 300 * 1024 * 1024);
    render(
      <Dropzone
        onFileSelected={vi.fn()}
        currentFile={file}
        maxSizeBytes={200 * 1024 * 1024}
      />,
    );
    // The warning copy is more specific than the info text — anchor on it.
    const warning = screen.getByText(/exceeds the 200 MB limit/i);
    expect(warning).toBeInTheDocument();
  });

  it("does not fire onFileSelected when disabled", async () => {
    const onFileSelected = vi.fn();
    render(
      <Dropzone
        onFileSelected={onFileSelected}
        currentFile={null}
        disabled
      />,
    );
    const user = userEvent.setup();
    const input = screen.getByTestId("dropzone-input") as HTMLInputElement;
    expect(input).toBeDisabled();
    // user-event refuses to upload into a disabled input — swallow that
    // rejection and assert the handler was never reached.
    await user.upload(input, makeFile("x.mp4", 1)).catch(() => undefined);
    expect(onFileSelected).not.toHaveBeenCalled();
  });
});
