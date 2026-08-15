import { describe, expect, it } from "vitest";
import {
  parsePreviewUrl,
  shutdownTinymistClient,
  sourceJumpFromParams,
  tinymistPageScrollRequest,
  tinymistStoppedMessage,
  tinymistPreviewArguments,
} from "./useTinymistSession";

describe("Tinymist preview session protocol", () => {
  it("accepts only loopback preview addresses", () => {
    expect(parsePreviewUrl({ staticServerAddr: "127.0.0.1:4242" })).toBe("http://127.0.0.1:4242");
    expect(parsePreviewUrl({ staticServerAddr: "http://localhost:4242" })).toBe("http://localhost:4242");
    expect(() => parsePreviewUrl({ staticServerAddr: "https://example.com:4242" })).toThrow(/loopback/);
  });

  it("normalizes Tinymist tuple source ranges to LSP positions", () => {
    expect(sourceJumpFromParams({
      filepath: "/deck/main.typ",
      start: [3, 2],
      end: [3, 8],
    })).toEqual({
      filepath: "/deck/main.typ",
      start: [3, 2],
      end: [3, 8],
    });
  });

  it("passes the required value for Tinymist partial rendering", () => {
    const args = tinymistPreviewArguments("/deck/main.typ");
    const option = args.indexOf("--partial-rendering");
    expect(args[option + 1]).toBe("true");
    expect(args.at(-1)).toBe("/deck/main.typ");
  });

  it("stops preview before graceful LSP shutdown and disconnect", async () => {
    const calls: string[] = [];
    const client = {
      request: async (method: string) => {
        calls.push(method);
        return null;
      },
      notification: (method: string) => calls.push(method),
      disconnect: () => calls.push("disconnect"),
    };

    await shutdownTinymistClient(client);

    expect(calls).toEqual([
      "workspace/executeCommand",
      "shutdown",
      "exit",
      "disconnect",
    ]);
  });

  it("only reports a stopped process for the active generation", () => {
    expect(tinymistStoppedMessage(4, { generation: 3, message: "old process stopped" })).toBeNull();
    expect(tinymistStoppedMessage(4, { generation: 4, message: "process exited" }))
      .toBe("process exited");
  });

  it("maps the selected slide to Tinymist's document-position scroll command", () => {
    expect(tinymistPageScrollRequest(0)).toEqual({
      command: "tinymist.scrollPreview",
      arguments: [
        "typst-presenter-editor",
        { event: "panelScrollByPosition", position: { page_no: 1, x: 0, y: 0 } },
      ],
    });
    expect(tinymistPageScrollRequest(1).arguments[1]).toEqual({
      event: "panelScrollByPosition",
      position: { page_no: 2, x: 0, y: 0 },
    });
  });
});
