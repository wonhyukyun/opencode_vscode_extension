import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

const root = await mkdtemp(path.join(tmpdir(), "opencode-integrated-smoke-"))
const binary = path.resolve("bin", "win32-x64", "opencode.exe")
const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
const password = "smoke-test-only"
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--log-level", "ERROR"], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
    OPENCODE_CONFIG_CONTENT: '{"plugin":[]}',
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_SERVER_PASSWORD: password,
  },
})

let stderr = ""
child.stderr.setEncoding("utf8")
child.stderr.on("data", (chunk) => (stderr += chunk))

try {
  await waitForServer()
  const headers = {
    "content-type": "application/json",
    "x-opencode-directory": encodeURIComponent(root),
    authorization,
  }
  const created = await json("/session", { method: "POST", headers, body: "{}" })
  if (!created.id) throw new Error("Session creation did not return an id")
  const [questions, permissions, statuses] = await Promise.all([
    json("/question", { headers }), json("/permission", { headers }), json("/session/status", { headers }),
  ])
  if (!Array.isArray(questions) || !Array.isArray(permissions) || typeof statuses !== "object" || statuses === null) {
    throw new Error("Pending interaction snapshot returned an unexpected shape")
  }
  const sessions = await json("/session?scope=project&roots=true&limit=5", { headers })
  if (!Array.isArray(sessions) || !sessions.some((session) => session.id === created.id)) {
    throw new Error("Created session was not returned by the project session API")
  }
  const [skills, mcp] = await Promise.all([json("/skill", { headers }), json("/mcp", { headers })])
  if (!Array.isArray(skills) || !skills.every((skill) => typeof skill.name === "string" && typeof skill.location === "string")) {
    throw new Error("The skill API returned an unexpected shape")
  }
  if (typeof mcp !== "object" || mcp === null || Array.isArray(mcp)) {
    throw new Error("The MCP status API returned an unexpected shape")
  }
  const global = await json("/experimental/session?roots=true&limit=5", { headers })
  if (!Array.isArray(global) || !global.some((session) => session.id === created.id)) {
    throw new Error("Created session was not returned by the cross-project session API")
  }
  await json(`/session/${encodeURIComponent(created.id)}`, { method: "DELETE", headers })
  console.log(`Smoke test passed with bundled engine ${created.version ?? "unknown version"}`)
} finally {
  child.kill()
  await new Promise((resolve) => child.once("exit", resolve))
  const resolvedRoot = path.resolve(root)
  if (!resolvedRoot.startsWith(path.resolve(tmpdir()))) throw new Error(`Refusing to remove unexpected path: ${resolvedRoot}`)
  await rm(resolvedRoot, { recursive: true, force: true })
}

async function json(url, init = {}) {
  const headers = { authorization, ...(init.headers ?? {}) }
  const response = await fetch(`${baseUrl}${url}`, { ...init, headers, signal: AbortSignal.timeout(20_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`)
  return text ? JSON.parse(text) : true
}

async function waitForServer() {
  for (let index = 0; index < 100; index++) {
    if (child.exitCode !== null) throw new Error(`Engine exited early: ${stderr}`)
    try {
      const health = await json("/global/health")
      if (health.healthy) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Engine did not start: ${stderr}`)
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Could not allocate port"))
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}
