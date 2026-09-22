import { mkdir, readFile, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"

const target = process.argv.find((value) => value.startsWith("--target="))?.split("=")[1] ?? "win32-x64"
const manifest = JSON.parse(await readFile("package.json", "utf8"))
const output = path.join("artifacts", `${manifest.name}-${manifest.version}-${target}.vsix`)

await mkdir("artifacts", { recursive: true })
await rm(output, { force: true })

const vsce = path.join("node_modules", ".bin", process.platform === "win32" ? "vsce.cmd" : "vsce")
const result = spawnSync(
  vsce,
  ["package", "--allow-missing-repository", "--target", target, "--out", output],
  { stdio: "inherit", shell: process.platform === "win32" },
)
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Packaged ${output}`)
