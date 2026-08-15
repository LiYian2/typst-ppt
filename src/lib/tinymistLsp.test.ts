import { LSPClient } from "@codemirror/lsp-client";
import { describe, expect, it, vi } from "vitest";
import { createTinymistInitializationTransport, createTinymistTransport, filePathToUri, type TinymistChannel } from "./tinymistTransport";

function fakePeer() {
  let receive: ((event: { generation: number; message: string }) => void) | null = null;
  const sent: string[] = [];
  const channel: TinymistChannel = {
    send: vi.fn(async (_generation, message) => {
      sent.push(message);
    }),
    subscribe: (handler) => {
      receive = handler;
      return () => { receive = null; };
    },
    dispose: vi.fn(),
  };
  return {
    channel,
    sent,
    respond(message: unknown) {
      receive?.({ generation: 4, message: JSON.stringify(message) });
    },
  };
}

describe("Tinymist protocol peer", () => {
  it("exposes diagnostics, completion, hover, and definition responses through LSPClient", async () => {
    const peer = fakePeer();
    const diagnostics = vi.fn();
    const client = new LSPClient({
      rootUri: filePathToUri("/deck"),
      notificationHandlers: {
        "textDocument/publishDiagnostics": (_client, params) => {
          diagnostics(params);
          return true;
        },
      },
    });
    client.connect(createTinymistInitializationTransport(createTinymistTransport(peer.channel, 4), filePathToUri("/deck")));
    const initialize = JSON.parse(peer.sent[0]);
    peer.respond({ jsonrpc: "2.0", id: initialize.id, result: { capabilities: { textDocumentSync: 1 } } });
    await client.initializing;

    peer.respond({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///deck/main.typ", diagnostics: [{ message: "bad", severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] },
    });
    expect(diagnostics).toHaveBeenCalledOnce();

    const ask = async (method: string, params: unknown, result: unknown) => {
      const promise = client.request(method, params);
      await Promise.resolve();
      const request = JSON.parse(peer.sent.at(-1) ?? "{}");
      peer.respond({ jsonrpc: "2.0", id: request.id, result });
      return promise;
    };
    await expect(ask("textDocument/completion", { textDocument: { uri: "file:///deck/main.typ" }, position: { line: 0, character: 1 } }, { items: [{ label: "#let" }] })).resolves.toMatchObject({ items: [{ label: "#let" }] });
    await expect(ask("textDocument/hover", { textDocument: { uri: "file:///deck/main.typ" }, position: { line: 0, character: 1 } }, { contents: "Typst" })).resolves.toEqual({ contents: "Typst" });
    await expect(ask("textDocument/definition", { textDocument: { uri: "file:///deck/main.typ" }, position: { line: 0, character: 1 } }, [{ uri: "file:///deck/include.typ", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } }])).resolves.toHaveLength(1);
    client.disconnect();
  });
});
