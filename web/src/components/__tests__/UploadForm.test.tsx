/**
 * Tests for <UploadForm>. Mocks the API client so we exercise the form's
 * state machine (enable/disable + error branches) without touching fetch.
 *
 * We lean on getByRole for buttons, getByTestId for the hidden file input
 * (matching <Dropzone>'s test hook), and getByText for the label strings
 * since the two LanguageSelects have distinct labels.
 */

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Hoisted mock: every test in this file gets the same mocked client.
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    getLanguages: vi.fn(),
    createJob: vi.fn(),
  };
});

import { UploadForm } from "../UploadForm";
import { ApiError, createJob, getLanguages } from "@/api/client";
import type { Language } from "@/api/schemas";

const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  vi.mocked(getLanguages).mockReset();
  vi.mocked(createJob).mockReset();
  vi.mocked(getLanguages).mockResolvedValue(LANGUAGES);
});

function makeFile(name = "clip.mp4", bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "video/mp4" });
}

async function pickFile(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByTestId("dropzone-input") as HTMLInputElement;
  await user.upload(input, makeFile());
}

async function pickLanguage(
  user: ReturnType<typeof userEvent.setup>,
  labelText: string | RegExp,
  optionLabel: string,
) {
  const trigger = screen.getByRole("combobox", { name: labelText });
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: optionLabel }));
}

describe("<UploadForm>", () => {
  it("calls getLanguages on mount and renders the 7 codes as options", async () => {
    const user = userEvent.setup();
    render(<UploadForm onJobCreated={vi.fn()} />);

    await waitFor(() => {
      expect(vi.mocked(getLanguages)).toHaveBeenCalledTimes(1);
    });

    // Open the first combobox (source lang) and count its options.
    await user.click(
      screen.getByRole("combobox", { name: /source language/i }),
    );
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(LANGUAGES.length);
  });

  it("submit button stays disabled until a file is picked", async () => {
    render(<UploadForm onJobCreated={vi.fn()} />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );

    // Defaults are en/es, so once a file is picked the form is valid.
    const submit = screen.getByRole("button", { name: /start translation/i });
    expect(submit).toBeDisabled();
  });

  it("submit button is disabled when source === target", async () => {
    const user = userEvent.setup();
    render(<UploadForm onJobCreated={vi.fn()} />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );

    await pickFile(user);
    // Change target to English (matches default source).
    await pickLanguage(user, /target language/i, "English");

    const submit = screen.getByRole("button", { name: /start translation/i });
    expect(submit).toBeDisabled();
    expect(
      screen.getByText(/source and target must differ/i),
    ).toBeInTheDocument();
  });

  it("on successful submit, calls onJobCreated with the new job_id", async () => {
    vi.mocked(createJob).mockResolvedValueOnce({ job_id: "job-42" });
    const onJobCreated = vi.fn();
    const user = userEvent.setup();

    render(<UploadForm onJobCreated={onJobCreated} />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );

    await pickFile(user);
    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    await waitFor(() => {
      expect(onJobCreated).toHaveBeenCalledWith("job-42");
    });
    expect(vi.mocked(createJob)).toHaveBeenCalledTimes(1);
    const [, src, tgt] = vi.mocked(createJob).mock.calls[0]!;
    expect(src).toBe("en");
    expect(tgt).toBe("es");
  });

  it("shows a rejoin alert on 409 and Rejoin button calls onRejoinActiveJob", async () => {
    vi.mocked(createJob).mockRejectedValueOnce(
      new ApiError(409, {
        error: "concurrent_job",
        active_job_id: "existing-id",
      }),
    );
    const onRejoinActiveJob = vi.fn();
    const user = userEvent.setup();

    render(
      <UploadForm
        onJobCreated={vi.fn()}
        onRejoinActiveJob={onRejoinActiveJob}
      />,
    );
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );

    await pickFile(user);
    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    // The alert title and description both mention "already running" —
    // anchor on the title's heading role to disambiguate.
    await screen.findByRole("heading", { name: /already running/i });
    expect(screen.getByText(/existing-id/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /rejoin/i }));
    expect(onRejoinActiveJob).toHaveBeenCalledWith("existing-id");
  });

  it("shows a size-error alert on 413", async () => {
    vi.mocked(createJob).mockRejectedValueOnce(
      new ApiError(413, "upload too big"),
    );
    const user = userEvent.setup();

    render(<UploadForm onJobCreated={vi.fn()} />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );

    await pickFile(user);
    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    await screen.findByRole("heading", { name: /file too large/i });
  });

  it("shows a language-error alert on 400", async () => {
    vi.mocked(createJob).mockRejectedValueOnce(
      new ApiError(400, "unsupported source_lang: xx"),
    );
    const user = userEvent.setup();

    render(<UploadForm onJobCreated={vi.fn()} />);
    await waitFor(() =>
      expect(vi.mocked(getLanguages)).toHaveBeenCalled(),
    );

    await pickFile(user);
    await user.click(
      screen.getByRole("button", { name: /start translation/i }),
    );

    await screen.findByRole("heading", { name: /invalid language code/i });
  });
});
