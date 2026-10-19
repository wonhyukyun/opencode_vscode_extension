import { PERMISSION_MODE_RULES, type PermissionMode, type PermissionRule } from "./types"

/**
 * Mini-SWE-V2 harness: the mini-swe-agent loop (github.com/SWE-agent/mini-swe-agent) mapped onto
 * the engine. The agent works through the shell alone, one command per turn, and every command
 * runs in a fresh process. It is registered as an engine agent so it can be picked as the primary
 * agent or delegated to as a subagent.
 */
export const MINI_SWE_AGENT = "mini-swe-v2"

/** Shell families the harness has a prompt for. */
export type HarnessShell = "bash" | "powershell" | "pwsh"
/** `auto` follows the shell the engine picks; any other value also sets the engine's shell. */
export type HarnessShellSetting = "auto" | HarnessShell

export interface HarnessOptions {
  enabled: boolean
  /** Maximum agent steps per prompt; 0 or less means no limit. */
  stepLimit: number
  shell: HarnessShellSetting
}

/** Where the engine looks when it picks a shell. `find` reports whether a command is on PATH. */
export interface ShellEnvironment {
  platform: NodeJS.Platform
  shellEnv?: string
  find: (command: string) => boolean
}

function shellName(shell: string): string {
  return shell.replaceAll("\\", "/").split("/").pop()!.toLowerCase().replace(/\.exe$/, "")
}

/** Maps a shell name or path to the prompt family that matches it. */
export function shellFamily(shell: string): HarnessShell {
  const name = shellName(shell)
  return name === "pwsh" || name === "powershell" ? name : "bash"
}

/**
 * The shell the engine's bash tool will run, mirroring its own choice: the configured shell, then
 * $SHELL, then on Windows pwsh, Windows PowerShell and Git Bash in that order.
 */
export function resolveHarnessShell(configured: string | undefined, env: ShellEnvironment): HarnessShell {
  for (const candidate of [configured, env.shellEnv]) {
    // The engine skips shells it cannot drive or find and falls through to its defaults.
    if (!candidate?.trim() || ["fish", "nu"].includes(shellName(candidate))) continue
    if (env.platform === "win32" && !/[\\/]/.test(candidate)) {
      const name = shellName(candidate)
      // On Windows a bare "bash" means Git Bash, found next to git.
      if (!(name === "bash" ? env.find("bash") || env.find("git") : env.find(name))) continue
    }
    return shellFamily(candidate)
  }
  if (env.platform !== "win32") return "bash"
  if (env.find("pwsh")) return "pwsh"
  if (env.find("powershell")) return "powershell"
  return "bash"
}

const RESPONSE_FORMAT = `## Response format
Every response must contain:
1. A THOUGHT section explaining your reasoning and what you are trying to accomplish.
2. Exactly ONE bash tool call with ONE command.`

const WORKFLOW = `## Recommended workflow
1. Analyze the codebase by finding and reading the relevant files.
2. Create a script that reproduces the issue.
3. Edit the source code to resolve the issue.
4. Verify the fix by running the reproduction script again.
5. Test edge cases to make sure the fix is robust.
6. When the task is complete, reply with a short summary of what you changed and make no tool call.`

const BASH_PROMPT = `You are a helpful assistant that interacts with a computer shell to solve programming tasks.
You are running inside the Mini-SWE-V2 harness: the bash tool is the only tool you have, and it runs bash.

${RESPONSE_FORMAT} Chain dependent steps with && or ||.

## Rules
- Each command runs in a new subshell. Directory and environment changes do not persist, so
  prefix commands with \`cd /path/to/dir && ...\` or write scripts to files when needed.
- Never run interactive commands (editors, pagers, prompts). Pass non-interactive flags.
- Keep output small and targeted: use head, tail, grep, and line ranges instead of dumping whole files.

${WORKFLOW}

## Useful commands
Create a file:
cat <<'EOF' > newfile.py
print("hello")
EOF

Edit a file with sed:
sed -i 's/old_string/new_string/g' filename.py

View specific lines with numbers:
nl -ba filename.py | sed -n '10,20p'`

function powershellPrompt(shell: "powershell" | "pwsh"): string {
  const name = shell === "pwsh" ? "PowerShell 7+ (pwsh)" : "Windows PowerShell 5.1"
  const chain = shell === "pwsh"
    ? "Chain dependent steps with && or ||."
    : "Chain dependent steps with `cmd1; if ($?) { cmd2 }`. Windows PowerShell 5.1 has no && or ||."
  const encoding = shell === "pwsh"
    ? "Set-Content -Encoding utf8 writes UTF-8 without a BOM."
    : "Set-Content -Encoding utf8 adds a BOM in 5.1; use [IO.File]::WriteAllText($path, $text) when a BOM would break the file."
  return `You are a helpful assistant that interacts with a computer shell to solve programming tasks.
You are running inside the Mini-SWE-V2 harness: the bash tool is the only tool you have, and it runs ${name}, not bash.
Write every command in PowerShell syntax.

${RESPONSE_FORMAT} ${chain}

## Rules
- Each command runs in a new PowerShell process. Location and variable changes do not persist, so
  start commands with \`Set-Location 'C:\\path\\to\\dir'; ...\` or write scripts to .ps1 files when needed.
- Never run interactive commands (Read-Host, editors, pagers, prompts). Add -Confirm:$false and -Force where needed.
- Keep output small and targeted: use Select-Object -First/-Last, Select-String, and line ranges instead of dumping whole files.
- Quote paths that contain spaces, and call native executables with spaces in their path as & "path\\to\\exe" args.
- ${encoding}

${WORKFLOW}

## Useful commands
Create a file (the closing '@ must start its line):
@'
print("hello")
'@ | Set-Content -Encoding utf8 newfile.py

Edit a file:
$f = 'filename.py'; (Get-Content $f -Raw).Replace('old_string', 'new_string') | Set-Content -NoNewline -Encoding utf8 $f

View specific lines with numbers:
$i = 0; Get-Content filename.py | ForEach-Object { $i++; if ($i -ge 10 -and $i -le 20) { '{0,6}  {1}' -f $i, $_ } }

Search:
Get-ChildItem -Recurse -File -Filter *.py | Select-String -Pattern 'old_string'`
}

/** The harness system prompt for a shell family. */
export function miniSwePrompt(shell: HarnessShell): string {
  return shell === "bash" ? BASH_PROMPT : powershellPrompt(shell)
}

/** The engine agent definition for the harness. */
export function miniSweAgentConfig(stepLimit: number, shell: HarnessShell = "bash"): Record<string, unknown> {
  const label = shell === "bash" ? "bash" : shell === "pwsh" ? "PowerShell 7+" : "Windows PowerShell"
  const agent: Record<string, unknown> = {
    description: `Mini-SWE-V2 harness: solves tasks through the shell only (${label}), one command per step in a fresh process.`,
    mode: "all",
    prompt: miniSwePrompt(shell),
    // Shell only. Bash asks by default; the session's permission mode decides beyond that.
    permission: { "*": "deny", bash: "ask", doom_loop: "ask" },
  }
  if (Number.isFinite(stepLimit) && stepLimit > 0) agent.steps = Math.floor(stepLimit)
  return agent
}

export interface EngineConfig {
  /** Value for OPENCODE_CONFIG_CONTENT, or undefined to leave it unset. */
  content: string | undefined
  /** Shell the harness prompt was written for, when the harness is registered. */
  shell?: HarnessShell
}

/**
 * Builds the OPENCODE_CONFIG_CONTENT value for the engine. Content the user already set is kept:
 * an agent of the same name defined there wins, and so does a `shell` set there. An explicit shell
 * setting becomes the engine's shell, because the engine has one shell for every agent. Leaves
 * `existing` unchanged when the harness is off or the existing value is not a JSON object.
 */
export function engineConfigContent(existing: string | undefined, options: HarnessOptions, env: ShellEnvironment): EngineConfig {
  if (!options.enabled) return { content: existing }
  let base: Record<string, unknown> = {}
  if (existing?.trim()) {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { content: existing }
      base = parsed as Record<string, unknown>
    } catch {
      return { content: existing }
    }
  }
  const configured = typeof base.shell === "string" && base.shell.trim()
    ? base.shell
    : options.shell === "auto" ? undefined : options.shell
  const shell = resolveHarnessShell(configured, env)
  const agents = base.agent && typeof base.agent === "object" ? (base.agent as Record<string, unknown>) : {}
  const content: Record<string, unknown> = {
    ...base,
    agent: { [MINI_SWE_AGENT]: miniSweAgentConfig(options.stepLimit, shell), ...agents },
  }
  if (configured) content.shell = configured
  return { content: JSON.stringify(content), shell }
}

/**
 * Session rules for a permission mode. The mode rules start with an allow-all that would turn the
 * harness's other tools back on, so for the harness agent every tool except bash is denied again
 * after them, while bash keeps the mode's own action.
 */
export function sessionPermissionRules(mode: PermissionMode, agent: string | undefined): PermissionRule[] {
  const base = PERMISSION_MODE_RULES[mode]
  if (agent !== MINI_SWE_AGENT) return base
  const bash = [...base].reverse().find((rule) => rule.permission === "bash" && rule.pattern === "*")?.action ?? "ask"
  return [
    ...base,
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: bash },
    { permission: "doom_loop", pattern: "*", action: "ask" },
  ]
}
