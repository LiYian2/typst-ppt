export interface SpeakerNote {
  page: number;
  text: string;
  label: string;
  overlay: number;
}

export type BuildStatus = "ready" | "error";

export interface BuildSnapshot {
  revision: number;
  sourcePath: string;
  outputPath: string | null;
  status: BuildStatus;
  diagnostics: string[];
  notes: SpeakerNote[];
  elapsedMs: number;
  typstVersion: string;
}

export interface PresentationState {
  currentPage: number;
  revision: number;
}
