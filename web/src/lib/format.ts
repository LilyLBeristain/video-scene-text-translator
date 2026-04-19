/**
 * Tiered byte formatter. Base-1024 (MiB-style) since user intuition for
 * "MB" in this context (download sizes, upload speeds) is typically the
 * binary unit. Used by the upload progress surfaces in <App> and
 * <UploadProgress>.
 */
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
