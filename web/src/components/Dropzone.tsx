/**
 * <Dropzone> — drag-drop + click-to-pick file picker for the video upload.
 *
 * No shadcn equivalent exists for a drop-target, so the component is custom
 * per D6's "custom from scratch last" tier. It still hydrates from the
 * shadcn design tokens (`border-border`, `bg-muted`, `text-muted-foreground`,
 * `hover:border-primary`) so it sits visually next to the rest of the form.
 *
 * Behaviour:
 *   - Click anywhere on the drop target → opens the native file picker via
 *     a hidden `<input type="file">`.
 *   - Drag-drop → reads the first file out of `dataTransfer.files`.
 *   - Selected file: filename + MB size are rendered underneath the drop
 *     target.
 *   - Oversize warning (R2): when `currentFile.size > maxSizeBytes`, an
 *     inline warning appears. Matches the server's 200 MiB cap.
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
          "flex flex-col items-center justify-center gap-2",
          "min-h-[150px] w-full rounded-lg border-2 border-dashed p-6",
          "bg-muted/30 text-muted-foreground transition-colors",
          "cursor-pointer",
          "border-border hover:border-primary hover:bg-muted/50",
          isDragging && "border-primary bg-muted/60",
          disabled && "cursor-not-allowed opacity-50 hover:border-border hover:bg-muted/30",
        )}
      >
        <UploadCloud className="h-8 w-8" aria-hidden />
        <p className="text-sm font-medium">
          Drop video here or click to pick
        </p>
        <p className="text-xs">
          MP4, MOV, WebM, or AVI — up to {maxMB} MB
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
        <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
          <span className="truncate font-medium">{currentFile.name}</span>
          <span className="ml-2 shrink-0 text-muted-foreground">
            {formatMB(currentFile.size)}
          </span>
        </div>
      )}

      {oversize && (
        <p className="text-sm text-destructive">
          File exceeds the {maxMB} MB limit — the server will reject it.
        </p>
      )}
    </div>
  );
}
