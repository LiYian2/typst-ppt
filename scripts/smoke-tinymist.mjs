import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourcePath = await realpath(resolve(process.argv[2] ?? "examples/demo.typ"));
const binaryPath = resolve(process.argv[3] ?? defaultBinaryPath());
const rootPath = dirname(sourcePath);
const child = spawn(binaryPath, ["lsp"], {
  cwd: rootPath,
  stdio: ["pipe", "pipe", "pipe"],
});

let nextId = 0;
let buffer = Buffer.alloc(0);
let stderr = "";
const pending = new Map();

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainMessages();
});

try {
  const rootUri = pathToFileURL(`${rootPath}/`).href;
  const sourceUri = pathToFileURL(sourcePath).href;
  await request("initialize", {
    processId: null,
    clientInfo: { name: "typst-presenter-smoke" },
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "smoke" }],
    initializationOptions: {
      customizedShowDocument: true,
      semanticTokens: "enable",
      preview: { refresh: "onType", partialRendering: true },
    },
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      workspace: { configuration: true, workspaceFolders: true },
      window: { showDocument: { support: true }, workDoneProgress: true },
      textDocument: { synchronization: { didSave: true } },
    },
  });
  notify("initialized", {});
  notify("textDocument/didOpen", {
    textDocument: {
      uri: sourceUri,
      languageId: "typst",
      version: 0,
      text: await readFile(sourcePath, "utf8"),
    },
  });

  const preview = await request("workspace/executeCommand", {
    command: "tinymist.doStartPreview",
    arguments: [[
      "--task-id", "typst-presenter-smoke",
      "--data-plane-host", "127.0.0.1:0",
      "--preview-mode", "slide",
      "--partial-rendering", "true",
      "--no-open",
      sourcePath,
    ]],
  });
  const address = preview.staticServerAddr ?? `127.0.0.1:${preview.staticServerPort}`;
  const response = await fetch(`http://${address}/`);
  const html = await response.text();
  if (!response.ok || !html.includes("typst-container")) {
    throw new Error(`Preview health check failed with HTTP ${response.status}.`);
  }

  await request("workspace/executeCommand", {
    command: "tinymist.scrollPreview",
    arguments: [
      "typst-presenter-smoke",
      { event: "panelScrollByPosition", position: { page_no: 1, x: 0, y: 0 } },
    ],
  });

  await request("workspace/executeCommand", {
    command: "tinymist.doKillPreview",
    arguments: ["typst-presenter-smoke"],
  });
  await request("shutdown", null);
  notify("exit", null);
  console.log(`Tinymist smoke passed: ${sourcePath} -> http://${address}/`);
} finally {
  child.kill();
}

function request(method, params) {
  const id = ++nextId;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out waiting for ${method}.${stderr ? `\n${stderr}` : ""}`));
    }, 15_000);
    pending.set(id, { resolveRequest, rejectRequest, timeout });
  });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function send(message) {
  const body = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function drainMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
    if (!Number.isFinite(length)) throw new Error(`Invalid LSP header: ${header}`);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString("utf8"));
    buffer = buffer.subarray(bodyStart + length);
    handleMessage(message);
  }
}

function handleMessage(message) {
  if (message.id != null && message.method) {
    const result = message.method === "workspace/configuration"
      ? (message.params?.items ?? []).map(() => null)
      : message.method === "window/showDocument"
        ? { success: true }
        : null;
    send({ jsonrpc: "2.0", id: message.id, result });
    return;
  }
  if (message.id == null) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timeout);
  if (message.error) waiter.rejectRequest(new Error(JSON.stringify(message.error)));
  else waiter.resolveRequest(message.result);
}

function defaultBinaryPath() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const target = process.env.TAURI_ENV_TARGET_TRIPLE
    ?? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${platformTarget()}`;
  return `src-tauri/binaries/tinymist-${target}${suffix}`;
}

function platformTarget() {
  if (process.platform === "darwin") return "apple-darwin";
  if (process.platform === "win32") return "pc-windows-msvc";
  return "unknown-linux-gnu";
}
