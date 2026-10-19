import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomBytes } from "node:crypto"
import * as fs from "node:fs"
import * as net from "node:net"
import * as path from "node:path"
import * as vscode from "vscode"
import { resolveBundledBinary } from "./binary"
import { engineConfigContent, type HarnessShellSetting } from "./harness"

const START_TIMEOUT_MS = 20_000

export class OpenCodeServer implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | undefined
  private startPromise: Promise<string> | undefined
  private baseUrlValue: string | undefined
  private authorizationValue: string | undefined
  private readonly output = vscode.window.createOutputChannel("OpenCode Integrated")

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(this.output)
  }

  get baseUrl(): string {
    if (!this.baseUrlValue) throw new Error("OpenCode engine has not started")
    return this.baseUrlValue
  }

  get authorization(): string {
    if (!this.authorizationValue) throw new Error("OpenCode engine has not started")
    return this.authorizationValue
  }

  async start(): Promise<string> {
    if (this.baseUrlValue && this.child && !this.child.killed) return this.baseUrlValue
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startOnce().finally(() => {
      this.startPromise = undefined
    })
    return this.startPromise
  }

  private async startOnce(): Promise<string> {
    const override = vscode.workspace.getConfiguration("opencodeIntegrated").get<string>("binaryPath", "")
    const binary = resolveBundledBinary(this.context.extensionPath, override)
    const port = await getFreePort()
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.context.globalStorageUri.fsPath
    const baseUrl = `http://127.0.0.1:${port}`
    const password = randomBytes(32).toString("base64url")
    const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    const settings = vscode.workspace.getConfiguration("opencodeIntegrated")
    const shellSetting = settings.get<HarnessShellSetting>("harness.miniSweV2.shell", "auto")
    const engineConfig = engineConfigContent(
      process.env.OPENCODE_CONFIG_CONTENT,
      {
        enabled: settings.get<boolean>("harness.miniSweV2.enabled", true),
        stepLimit: settings.get<number>("harness.miniSweV2.stepLimit", 0),
        shell: shellSetting,
      },
      { platform: process.platform, shellEnv: process.env.SHELL, find: onPath },
    )
    const configContent = engineConfig.content

    this.output.appendLine(`Starting bundled OpenCode engine (${binary})`)
    if (engineConfig.shell) {
      this.output.appendLine(`Mini-SWE-V2 harness registered for ${engineConfig.shell}`)
      if (shellSetting !== "auto" && shellSetting !== engineConfig.shell) {
        this.output.appendLine(`Mini-SWE-V2 shell "${shellSetting}" was not found or was overridden; the engine will use ${engineConfig.shell}.`)
      }
    }
    const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--log-level", "WARN"], {
      cwd: workspace,
      env: {
        ...process.env,
        OPENCODE_CALLER: "vscode-integrated",
        OPENCODE_SERVER_USERNAME: "opencode",
        OPENCODE_SERVER_PASSWORD: password,
        ...(configContent === undefined ? {} : { OPENCODE_CONFIG_CONTENT: configContent }),
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child = child
    child.stdin.end()
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (text: string) => this.output.append(text))
    child.stderr.on("data", (text: string) => this.output.append(text))
    child.once("exit", (code, signal) => {
      this.output.appendLine(`OpenCode engine stopped (code=${code}, signal=${signal})`)
      if (this.child === child) {
        this.child = undefined
        this.baseUrlValue = undefined
        this.authorizationValue = undefined
      }
    })

    try {
      await waitForHealth(baseUrl, child, authorization)
      this.baseUrlValue = baseUrl
      this.authorizationValue = authorization
      this.output.appendLine(`OpenCode engine ready at ${baseUrl}`)
      return baseUrl
    } catch (error) {
      child.kill()
      throw error
    }
  }

  get isRunning(): boolean {
    return Boolean(this.baseUrlValue && this.child && !this.child.killed)
  }

  log(text: string): void {
    this.output.appendLine(text)
  }

  showLogs(): void {
    this.output.show(true)
  }

  dispose(): void {
    this.child?.kill()
    this.child = undefined
    this.baseUrlValue = undefined
    this.authorizationValue = undefined
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Could not allocate a local port"))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcessWithoutNullStreams,
  authorization: string,
): Promise<void> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`Bundled OpenCode engine exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/global/health`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
      lastError = new Error(`Health check returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Bundled OpenCode engine did not become ready: ${errorText(lastError)}`)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True when `command` resolves to a file on PATH, honoring PATHEXT on Windows. */
function onPath(command: string): boolean {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      try {
        if (fs.statSync(path.join(directory, command + extension)).isFile()) return true
      } catch {}
    }
  }
  return false
}
