import type { Stage } from "@/api/schemas";

/** The five pipeline stages, ordered s1..s5. */
export const STAGES: readonly Stage[] = ["s1", "s2", "s3", "s4", "s5"] as const;

/** Human-facing label for each stage. Matches the backend's stage vocabulary. */
export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  s1: "Detect",
  s2: "Frontalize",
  s3: "Edit",
  s4: "Propagate",
  s5: "Revert",
};
