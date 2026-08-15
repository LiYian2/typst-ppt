import type { LSPClient, WorkspaceFile } from "@codemirror/lsp-client";
import { LSPPlugin, Workspace } from "@codemirror/lsp-client";
import type { ChangeSet, Text, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

interface WorkspaceFileUpdate {
  file: WorkspaceFile;
  prevDoc: Text;
  changes: ChangeSet;
}

export type OpenTinymistUri = (uri: string) => Promise<EditorView | null> | EditorView | null;

/**
 * DefaultWorkspace intentionally only displays already-open files. This
 * workspace keeps that behavior for the active editor, while allowing the
 * host application to open an included source file on a definition jump.
 */
export class TinymistWorkspace extends Workspace {
  readonly files: WorkspaceFile[] = [];
  private readonly fileVersions = new Map<string, number>();

  constructor(client: LSPClient, private readonly openUri: OpenTinymistUri = () => null) {
    super(client);
  }

  syncFiles(): readonly WorkspaceFileUpdate[] {
    const updates: WorkspaceFileUpdate[] = [];
    for (const file of this.files) {
      const view = file.getView();
      if (!view) continue;
      const plugin = LSPPlugin.get(view);
      if (!plugin || plugin.unsyncedChanges.empty) continue;
      const changes = plugin.unsyncedChanges;
      const previous = file.doc;
      file.doc = view.state.doc;
      file.version = this.nextVersion(file.uri);
      plugin.clear();
      updates.push({ file, prevDoc: previous, changes });
    }
    return updates;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const existing = this.getFile(uri);
    if (existing) {
      if (existing.getView() === view) return;
      throw new Error(`Tinymist workspace already has an editor for ${uri}`);
    }
    const file: WorkspaceFile = {
      uri,
      languageId,
      version: this.nextVersion(uri),
      doc: view.state.doc,
      getView: () => view,
    };
    this.files.push(file);
    if (this.client.connected) this.client.didOpen(file);
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri);
    if (!file || file.getView() !== view) return;
    this.files.splice(this.files.indexOf(file), 1);
    if (this.client.connected) this.client.didClose(uri);
  }

  updateFile(uri: string, update: TransactionSpec): void {
    super.updateFile(uri, update);
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const existing = this.getFile(uri);
    if (existing) return existing.getView();
    return (await this.openUri(uri)) ?? null;
  }

  private nextVersion(uri: string): number {
    const next = (this.fileVersions.get(uri) ?? -1) + 1;
    this.fileVersions.set(uri, next);
    return next;
  }
}

export function createTinymistWorkspace(client: LSPClient, openUri?: OpenTinymistUri): TinymistWorkspace {
  return new TinymistWorkspace(client, openUri);
}
