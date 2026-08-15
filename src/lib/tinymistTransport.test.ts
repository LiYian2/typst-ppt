import { describe, expect, it, vi } from "vitest";
import type { TinymistChannel } from "./tinymistTransport";
import {
  createTinymistTransport,
  createTinymistInitializationTransport,
  filePathToUri,
} from "./tinymistTransport";

function fakeChannel() {
  let receive: ((event: { generation: number; message: string }) => void) | null = null;
  const channel: TinymistChannel = {
    send: vi.fn(async () => undefined),
    subscribe: (handler) => {
      receive = handler;
      return () => {
        receive = null;
      };
    },
    dispose: vi.fn(),
  };
  return {
    channel,
    emit(event: { generation: number; message: string }) {
      receive?.(event);
    },
  };
}

describe("Tinymist JSON-RPC transport", () => {
  it("forwards only messages belonging to the active generation", () => {
    const fake = fakeChannel();
    const transport = createTinymistTransport(fake.channel, 7);
    const received: string[] = [];
    const handler = (message: string) => received.push(message);

    transport.subscribe(handler);
    fake.emit({ generation: 6, message: '{"id":1}' });
    fake.emit({ generation: 7, message: '{"id":2}' });

    expect(received).toEqual(['{"id":2}']);
    transport.unsubscribe(handler);
    expect(fake.channel.dispose).not.toHaveBeenCalled();
  });

  it("reports asynchronous send failures without creating an unhandled rejection", async () => {
    const fake = fakeChannel();
    const report = vi.fn();
    vi.mocked(fake.channel.send).mockRejectedValueOnce(new Error("backend closed"));
    const transport = createTinymistTransport(fake.channel, 7, report);

    transport.send('{"jsonrpc":"2.0"}');
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("Tinymist initialization", () => {
  it("injects preview options and UTF-16 semantic token capabilities", () => {
    const fake = fakeChannel();
    const base = createTinymistTransport(fake.channel, 3);
    const transport = createTinymistInitializationTransport(base, filePathToUri("/tmp/deck"));
    const sent: string[] = [];
    vi.mocked(fake.channel.send).mockImplementation(async (_generation, message) => {
      sent.push(message);
    });

    transport.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: { workspace: {} } },
    }));

    const initialize = JSON.parse(sent[0]);
    expect(initialize.params.rootUri).toBe(filePathToUri("/tmp/deck"));
    expect(initialize.params.initializationOptions).toMatchObject({
      customizedShowDocument: true,
      semanticTokens: "enable",
      preview: { refresh: "onType", partialRendering: true },
    });
    expect(initialize.params.capabilities.general.positionEncodings).toContain("utf-16");
    expect(initialize.params.capabilities.textDocument.semanticTokens.requests.full).toEqual({ delta: true });
    expect(initialize.params.capabilities.textDocument.semanticTokens.tokenTypes).toContain("function");
  });
});

describe("file URI conversion", () => {
  it("escapes spaces and unicode while preserving an absolute file URI", () => {
    expect(filePathToUri("/tmp/My Deck/你好.typ")).toBe("file:///tmp/My%20Deck/%E4%BD%A0%E5%A5%BD.typ");
  });
});
