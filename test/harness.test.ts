import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MINI_SWE_AGENT, engineConfigContent, miniSweAgentConfig, resolveHarnessShell, sessionPermissionRules, type ShellEnvironment } from "../src/harness"
import { PERMISSION_MODE_RULES, type PermissionRule } from "../src/types"

/** Last matching rule wins, as in the engine. */
function decide(rules: PermissionRule[], permission: string): string | undefined {
  return [...rules].reverse().find((rule) => (rule.permission === permission || rule.permission === "*") && rule.pattern === "*")?.action
}

const linux: ShellEnvironment = { platform: "linux", find: () => true }
const windows = (...installed: string[]): ShellEnvironment => ({ platform: "win32", find: (name) => installed.includes(name) })
const options = { enabled: true, stepLimit: 0, shell: "auto" as const }

describe("Mini-SWE-V2 harness", () => {
  it("registers a bash-only agent usable as primary and subagent", () => {
    const content = JSON.parse(engineConfigContent(undefined, options, linux).content!)
    const agent = content.agent[MINI_SWE_AGENT]
    assert.equal(agent.mode, "all")
    assert.deepEqual(agent.permission, { "*": "deny", bash: "ask", doom_loop: "ask" })
    assert.match(agent.prompt, /exactly ONE bash tool call/i)
    assert.equal(agent.steps, undefined)
  })
  it("sets the step limit only when positive", () => {
    assert.equal(miniSweAgentConfig(40.7).steps, 40)
    assert.equal(miniSweAgentConfig(-1).steps, undefined)
  })
  it("keeps existing config content and a user-defined agent of the same name", () => {
    const existing = JSON.stringify({ theme: "x", agent: { [MINI_SWE_AGENT]: { prompt: "mine" }, other: {} } })
    const content = JSON.parse(engineConfigContent(existing, options, linux).content!)
    assert.equal(content.theme, "x")
    assert.deepEqual(content.agent[MINI_SWE_AGENT], { prompt: "mine" })
    assert.ok(content.agent.other)
  })
  it("leaves the environment alone when disabled or unparseable", () => {
    assert.equal(engineConfigContent(undefined, { ...options, enabled: false }, linux).content, undefined)
    assert.equal(engineConfigContent("{oops", options, linux).content, "{oops")
    assert.equal(engineConfigContent("[1]", options, linux).content, "[1]")
  })
  it("uses plain mode rules for other agents", () => {
    assert.deepEqual(sessionPermissionRules("auto", "build"), PERMISSION_MODE_RULES.auto)
  })
  it("denies every tool but bash for the harness, with bash following the mode", () => {
    for (const [mode, bash] of [["manual", "ask"], ["auto", "allow"], ["acceptEdits", "ask"], ["plan", "ask"]] as const) {
      const rules = sessionPermissionRules(mode, MINI_SWE_AGENT)
      assert.equal(decide(rules, "bash"), bash, mode)
      for (const tool of ["edit", "read", "webfetch", "task", "glob"]) assert.equal(decide(rules, tool), "deny", `${mode} ${tool}`)
    }
  })
  it("restores the other tools when switching back to a normal agent", () => {
    const rules = [...sessionPermissionRules("auto", MINI_SWE_AGENT), ...sessionPermissionRules("auto", "build")]
    assert.equal(decide(rules, "edit"), "allow")
    assert.equal(decide(rules, "read"), "allow")
  })
})

describe("Mini-SWE-V2 shell", () => {
  it("follows the engine's Windows order when nothing is configured", () => {
    assert.equal(resolveHarnessShell(undefined, windows("pwsh", "powershell", "git")), "pwsh")
    assert.equal(resolveHarnessShell(undefined, windows("powershell", "git")), "powershell")
    assert.equal(resolveHarnessShell(undefined, windows("git")), "bash")
  })
  it("prefers the configured shell, then $SHELL", () => {
    assert.equal(resolveHarnessShell("powershell", windows("pwsh", "powershell")), "powershell")
    assert.equal(resolveHarnessShell(undefined, { ...windows("pwsh"), shellEnv: "C:\\Program Files\\Git\\bin\\bash.exe" }), "bash")
    assert.equal(resolveHarnessShell(undefined, { ...linux, shellEnv: "/usr/bin/pwsh" }), "pwsh")
  })
  it("falls back like the engine when the chosen shell is missing or unusable", () => {
    assert.equal(resolveHarnessShell("pwsh", windows("powershell")), "powershell")
    assert.equal(resolveHarnessShell("bash", windows("powershell")), "powershell")
    assert.equal(resolveHarnessShell("bash", windows("powershell", "git")), "bash")
    assert.equal(resolveHarnessShell(undefined, { ...linux, shellEnv: "/usr/bin/fish" }), "bash")
  })
  it("writes a PowerShell prompt and leaves the engine shell alone in auto mode", () => {
    const config = engineConfigContent(undefined, options, windows("powershell"))
    const content = JSON.parse(config.content!)
    assert.equal(config.shell, "powershell")
    assert.equal(content.shell, undefined)
    assert.match(content.agent[MINI_SWE_AGENT].prompt, /Windows PowerShell 5\.1/)
    assert.match(content.agent[MINI_SWE_AGENT].prompt, /if \(\$\?\)/)
    assert.doesNotMatch(content.agent[MINI_SWE_AGENT].prompt, /sed -i/)
  })
  it("sets the engine shell for an explicit choice", () => {
    const config = engineConfigContent(undefined, { ...options, shell: "pwsh" }, windows("pwsh", "powershell"))
    const content = JSON.parse(config.content!)
    assert.equal(content.shell, "pwsh")
    assert.match(content.agent[MINI_SWE_AGENT].prompt, /PowerShell 7\+/)
    assert.match(content.agent[MINI_SWE_AGENT].prompt, /&& or \|\|/)
  })
  it("keeps a shell already set in OPENCODE_CONFIG_CONTENT", () => {
    const config = engineConfigContent(JSON.stringify({ shell: "bash" }), { ...options, shell: "pwsh" }, windows("pwsh", "git"))
    assert.equal(JSON.parse(config.content!).shell, "bash")
    assert.equal(config.shell, "bash")
  })
  it("keeps the bash prompt for bash", () => {
    assert.match(miniSweAgentConfig(0, "bash").prompt as string, /cat <<'EOF'/)
  })
})
