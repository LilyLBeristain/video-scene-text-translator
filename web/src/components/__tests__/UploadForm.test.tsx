/**
 * Tests for <UploadForm>. Mocks the API client so we exercise the form's
 * state machine (enable/disable + error branches) without touching fetch.
 *
 * We lean on getByRole for buttons, getByTestId for the hidden file input
 * (matching <Dropzone>'s test hook), and getByText for the label strings
 * since the two LanguageSelects have distinct labels.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Note: the Radix pointer-capture / scrollIntoView stubs used in the previous
// version of this file were only needed for the Radix-backed <LanguageSelect>.
// Step 6 swapped that for a native <select>, so the stubs are gone too.

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

function pickLanguage(
  labelText: string | RegExp,
  optionValue: string,
) {
  // Native <select>: one change event moves the controlled value. We use
  // `fireEvent.change` rather than `user.selectOptions` because the latter
  // requires `findByRole` in some environments and adds no signal here.
  const select = screen.getByRole("combobox", { name: labelText });
  fireEvent.change(select, { target: { value: optionValue } });
}

describe("<UploadForm>", () => {
  it("calls getLanguages on mount and renders the 7 codes as options", async () => {
    render(<UploadForm onJobCreated={vi.fn()} />);

    await waitFor(() => {
      expect(vi.mocked(getLanguages)).toHaveBeenCalledTimes(1);
    });

    // Native <select> renders all <option>s as children, so we can count them
    // directly without opening any popper. Two selects × N options each.
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(LANGUAGES.length * 2);
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
    pickLanguage(/target language/i, "en");

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

  it("shows an error banner and keeps submit disabled when getLanguages rejects", async () => {
    vi.mocked(getLanguages).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<UploadForm onJobCreated={vi.fn()} />);

    // The catch branch sets a kind="other" error; the description text
    // mentions the language list specifically so the user knows the form
    // couldn't be initialized.
    const description = await screen.findByText(
      /could not load language list: network down/i,
    );
    expect(description).toBeInTheDocument();

    // Submit stays disabled — both language selects are empty-disabled
    // because the options array is [], and no file is picked either.
    const submit = screen.getByRole("button", { name: /start translation/i });
    expect(submit).toBeDisabled();
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
