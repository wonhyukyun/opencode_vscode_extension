import { spawnSync } from "node:child_process"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { build } from "esbuild"

const output = await mkdtemp(path.join(tmpdir(), "opencode-integrated-tests-"))
try {
  const entries = (await readdir("test"))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => path.join("test", name))
  await build({
    entryPoints: entries,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outdir: output,
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
  })
  const compiled = (await readdir(output))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => path.join(output, name))
  const result = spawnSync(process.execPath, ["--test", ...compiled], { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await rm(output, { recursive: true, force: true })
}
