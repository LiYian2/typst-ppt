import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { BuildSnapshot, PresentationState, SourceDocument } from "../types";

export async function chooseDeck(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Open a Typst deck",
    filters: [{ name: "Typst source", extensions: ["typ"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export const api = {
  typstStatus: () => invoke<string>("typst_status"),
  loadDeck: (path: string) => invoke<BuildSnapshot>("load_deck", { path }),
  rebuild: () => invoke<BuildSnapshot>("rebuild"),
  sessionSnapshot: () => invoke<BuildSnapshot | null>("session_snapshot"),
  presentationState: () => invoke<PresentationState>("presentation_state"),
  setCurrentPage: (page: number) =>
    invoke<PresentationState>("set_current_page", { page }),
  pdfBytes: () => invoke<ArrayBuffer>("pdf_bytes"),
  openCurrentPdf: () => invoke<void>("open_current_pdf"),
  sourceDocument: (path?: string) => invoke<SourceDocument>("source_document", { path: path ?? null }),
  saveSource: (text: string, path?: string) => invoke<void>("save_source", { path: path ?? null, text }),
  audienceOpen: () => invoke<boolean>("audience_open"),
  openAudience: () => invoke<void>("open_audience"),
  toggleAudienceFullscreen: () => invoke<boolean>("toggle_audience_fullscreen"),
};
