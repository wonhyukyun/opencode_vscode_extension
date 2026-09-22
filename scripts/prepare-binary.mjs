import { access, chmod, copyFile, mkdir, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import process from "node:process"

const target = process.argv.find((value) => value.startsWith("--target="))?.split("=")[1] ?? "win32-x64"
const packages = {
  "win32-x64": ["opencode-windows-x64-baseline", "opencode.exe"],
}

const selected = packages[target]
if (!selected) {
  throw new Error(`Unsupported target ${target}. Add its native package mapping to scripts/prepare-binary.mjs.`)
}

const [packageName, executable] = selected
const source = path.join("node_modules", packageName, "bin", executable)
const destinationDir = path.join("bin", target)
const destination = path.join(destinationDir, executable)

try {
  await access(source, constants.R_OK)
} catch {
  const manifest = JSON.parse(await readFile("package.json", "utf8"))
  const version = manifest.optionalDependencies?.[packageName] ?? "the configured version"
  throw new Error(`Missing ${packageName}@${version}. Run npm install on a compatible build host.`)
}

await mkdir(destinationDir, { recursive: true })
await copyFile(source, destination)
if (process.platform !== "win32") await chmod(destination, 0o755)
console.log(`Bundled ${packageName} as ${destination}`)
