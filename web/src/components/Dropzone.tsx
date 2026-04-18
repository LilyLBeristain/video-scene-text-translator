/**
 * <Dropzone> — drag-drop + click-to-pick file picker for the video upload.
 *
 * Styled to match the mockup's `.drop` target: a dashed raised panel on
 * `var(--bg-2)`, with an upload-cloud glyph, a "Drop video here" headline,
 * a secondary "or click to pick" line, and a tiny mono constraints line.
 * Hover shifts the border to `var(--acc-line)`; isDragging shifts to
 * `var(--acc)` + `var(--acc-soft)`.
 *
 * Behavior (unchanged from the MVP):
 *   - Click anywhere on the drop target → opens the native file picker via
 *     a hidden `<input type="file">`.
 *   - Drag-drop → reads the first file out of `dataTransfer.files`.
 *   - Selected file: filename + MB size are rendered underneath (this box
 *     keeps the file-picked affordance for UploadForm; the new
 *     <VideoCard> is the future replacement but not yet adopted here).
 *   - Oversize warning (R2): when `currentFile.size > maxSizeBytes`, a
 *     single-line red warning appears. Matches the server's 200 MiB cap.
 *
 * The component is intentionally presentational — parent owns the `File`
 * state. Accepting the file is the parent's call (the warning is advisory,
 * the submit button is the real gate).
 */

import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";

const DEFAULT_MAX_SIZE = 200 * 1024 * 1024; // 200 MiB — matches R2 server cap

export interface DropzoneProps {
  onFileSelected: (file: File | null) => void;
  currentFile: File | null;
  disabled?: boolean;
  maxSizeBytes?: number;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Dropzone({
  onFileSelected,
  currentFile,
  disabled = false,
  maxSizeBytes = DEFAULT_MAX_SIZE,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const openPicker = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      onFileSelected(file);
      // Reset value so re-picking the same filename still fires change.
      e.target.value = "";
    },
    [onFileSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const file = e.dataTransfer.files?.[0] ?? null;
      if (file) onFileSelected(file);
    },
    [disabled, onFileSelected],
  );

  const oversize =
    currentFile !== null && currentFile.size > maxSizeBytes;
  const maxMB = Math.floor(maxSizeBytes / (1024 * 1024));

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          // Base panel — matches mockup `.drop`
          "flex flex-col items-center justify-center gap-2",
          "min-h-[150px] w-full rounded-md p-6 text-center",
          "border-2 border-dashed border-[color:var(--line-2)]",
          "bg-[color:var(--bg-2)] transition-colors cursor-pointer",
          // Hover → accent-line border + accent-soft tint
          "hover:border-[color:var(--acc-line)] hover:bg-[color:var(--acc-soft)]",
          // Active drag → full accent border
          isDragging &&
            "border-[color:var(--acc)] bg-[color:var(--acc-soft)]",
          // Disabled → dim + no hover shift
          disabled &&
            "cursor-not-allowed opacity-50 hover:border-[color:var(--line-2)] hover:bg-[color:var(--bg-2)]",
        )}
      >
        <UploadCloud
          className="h-8 w-8 text-[color:var(--ink-2)]"
          aria-hidden
        />
        <p className="text-sm font-medium text-foreground">
          Drop video here
        </p>
        <p className="text-xs text-muted-foreground">or click to pick</p>
        <p className="text-[11px] text-[color:var(--ink-3)]">
          MP4, MOV, WebM, or AVI · up to {maxMB} MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/*"
          className="hidden"
          disabled={disabled}
          onChange={handleChange}
          data-testid="dropzone-input"
        />
      </div>

      {currentFile && (
        <div className="flex items-center justify-between rounded-md border border-[color:var(--line-2)] bg-[color:var(--bg-2)] px-3 py-2 text-sm">
          <span className="truncate font-medium text-foreground">
            {currentFile.name}
          </span>
          <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
            {formatMB(currentFile.size)}
          </span>
        </div>
      )}

      {oversize && (
        <p className="text-xs text-[color:var(--err)]">
          File exceeds the {maxMB} MB limit — the server will reject it.
        </p>
      )}
    </div>
  );
}
