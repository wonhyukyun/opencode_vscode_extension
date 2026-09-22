import * as fs from "node:fs"
import * as path from "node:path"

export function platformTarget(platform = process.platform, arch = process.arch): string {
  if (platform === "win32" && arch === "x64") return "win32-x64"
  if (platform === "win32" && arch === "arm64") return "win32-arm64"
  if (platform === "darwin" && arch === "x64") return "darwin-x64"
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64"
  if (platform === "linux" && arch === "x64") return "linux-x64"
  if (platform === "linux" && arch === "arm64") return "linux-arm64"
  return `${platform}-${arch}`
}

export function executableName(platform = process.platform): string {
  return platform === "win32" ? "opencode.exe" : "opencode"
}

export function resolveBundledBinary(extensionPath: string, override = ""): string {
  const candidate = override.trim()
    ? path.resolve(override.trim())
    : path.join(extensionPath, "bin", platformTarget(), executableName())

  if (!fs.existsSync(candidate)) {
    throw new Error(
      candidate === override.trim()
        ? `The configured OpenCode executable does not exist: ${candidate}`
        : `This extension package does not contain an OpenCode engine for ${platformTarget()}. Install the VSIX built for your platform.`,
    )
  }
  return candidate
}
