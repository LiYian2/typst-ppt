import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesPinnedTinymistMarker, reportsPinnedTinymistVersion } from "./tinymist-version.mjs";

const TINYMIST_VERSION = "0.15.2";
const RELEASE_ROOT = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}`;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const artifacts = {
  "aarch64-apple-darwin": {
    archive: "tinymist-aarch64-apple-darwin.tar.gz",
    sha256: "16241868c6752aa5e8f9c162562293c7cdf69e82f54687d7886336daf2c51915",
  },
  "x86_64-apple-darwin": {
    archive: "tinymist-x86_64-apple-darwin.tar.gz",
    sha256: "fcfcfd01376394048443f81de349d165c271c17c36579eb9a08b889b30b8c3b2",
  },
  "aarch64-unknown-linux-gnu": {
    archive: "tinymist-aarch64-unknown-linux-gnu.tar.gz",
    sha256: "eba8e14338cf211906d77be6b18102736222da6721e98161133fa0d8ff5ab599",
  },
  "x86_64-unknown-linux-gnu": {
    archive: "tinymist-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "9b8a1aea6bb3fc9c39cb70496f0082bd518cfede555757bc3cb5225b05abc99b",
  },
  "aarch64-pc-windows-msvc": {
    archive: "tinymist-aarch64-pc-windows-msvc.zip",
    sha256: "ed120fc474a07c5614bb8a7ecd17a649360cba26c2d9f1f96b14a8bc7b3afc11",
  },
  "x86_64-pc-windows-msvc": {
    archive: "tinymist-x86_64-pc-windows-msvc.zip",
    sha256: "91edb0d21edca5841b896d702d8086622792d52b71a9b444d8befb0e937969ae",
  },
};

const target = process.env.TAURI_ENV_TARGET_TRIPLE || hostTarget();
const artifact = artifacts[target];
if (!artifact) {
  throw new Error(`Tinymist ${TINYMIST_VERSION} has no configured sidecar artifact for ${target}.`);
}

const extension = target.includes("windows") ? ".exe" : "";
const destination = join(projectRoot, "src-tauri", "binaries", `tinymist-${target}${extension}`);
const markerPath = `${destination}.version.json`;
if (await isPinnedTinymist(destination)) {
  console.log(`Tinymist v${TINYMIST_VERSION} sidecar is ready for ${target}.`);
  process.exit(0);
}

const scratch = await mkdtemp(join(tmpdir(), "typst-presenter-tinymist-"));
try {
  const archivePath = join(scratch, artifact.archive);
  await download(`${RELEASE_ROOT}/${artifact.archive}`, archivePath);
  await verifySha256(archivePath, artifact.sha256);
  const extracted = join(scratch, "extracted");
  await mkdir(extracted);
  execFileSync("tar", ["-xf", archivePath, "-C", extracted], { stdio: "inherit" });
  const binary = await findExtractedBinary(extracted, extension);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(binary, destination);
  if (!extension) await chmod(destination, 0o755);
  await writeFile(markerPath, JSON.stringify({
    version: TINYMIST_VERSION,
    sha256: await sha256File(destination),
  }));
  if (!(await isPinnedTinymist(destination))) {
    const probe = probeTinymistVersion(destination);
    throw new Error(
      `The downloaded Tinymist binary did not report v${TINYMIST_VERSION}. `
      + `Exit status: ${probe.status ?? "unavailable"}. Output: ${probe.output || probe.error || "none"}`,
    );
  }
  console.log(`Prepared Tinymist v${TINYMIST_VERSION} sidecar for ${target}.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function hostTarget() {
  return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
}

async function isPinnedTinymist(path) {
  const probe = probeTinymistVersion(path);
  if (probe.status !== 0) return false;
  if (reportsPinnedTinymistVersion(probe.output, TINYMIST_VERSION)) return true;
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    return matchesPinnedTinymistMarker(marker, TINYMIST_VERSION, await sha256File(path));
  } catch {
    return false;
  }
}

function probeTinymistVersion(path) {
  const result = spawnSync(path, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
    error: result.error?.message,
  };
}

async function download(url, destinationPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}.`);
  await copyFileFromResponse(response, destinationPath);
}

async function copyFileFromResponse(response, destinationPath) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destinationPath, bytes);
}

async function verifySha256(path, expected) {
  const digest = await sha256File(path);
  if (digest !== expected) {
    throw new Error(`Checksum mismatch for ${basename(path)}: expected ${expected}, received ${digest}.`);
  }
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function findExtractedBinary(root, extension) {
  const wanted = `tinymist${extension}`;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === wanted) return path;
    if (entry.isDirectory()) {
      const nested = await findExtractedBinary(path, extension).catch(() => null);
      if (nested) return nested;
    }
  }
  throw new Error(`The ${target} archive did not contain ${wanted}.`);
}
