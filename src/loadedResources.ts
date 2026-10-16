import type { McpServerInfo, McpStatus, SkillInfo } from "./types"

export const BUILT_IN_LOCATION = "<built-in>"

export interface SkillEntry {
  name: string
  description: string
  location: string
  /** True for skills compiled into the engine rather than loaded from disk. */
  builtIn: boolean
  /** Folder the skill was loaded from, or "Built-in" for engine skills. */
  origin: string
}

function skillOrigin(location: string): string {
  if (!location || location === BUILT_IN_LOCATION) return "Built-in"
  const parts = location.replace(/\\/g, "/").split("/")
  // A skill lives at <folder>/SKILL.md, so the folder name identifies it better than the file.
  const file = parts.pop()
  const folder = file === "SKILL.md" ? parts.pop() : file
  return folder || location
}

/** Normalizes the engine's skill listing for display: built-ins last, alphabetical within a group. */
export function summarizeSkills(skills: readonly SkillInfo[] | undefined): SkillEntry[] {
  const entries = (skills ?? []).map((skill) => {
    const location = skill.location ?? ""
    const builtIn = !location || location === BUILT_IN_LOCATION
    return {
      name: skill.name,
      description: (skill.description ?? "").trim(),
      location,
      builtIn,
      origin: skillOrigin(location),
    }
  })
  return entries.sort((a, b) => {
    if (a.builtIn !== b.builtIn) return a.builtIn ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

/** Order that puts servers needing attention above healthy ones. */
const STATUS_RANK: Record<string, number> = {
  failed: 0,
  needs_client_registration: 1,
  needs_auth: 2,
  connected: 3,
  disabled: 4,
}

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  disabled: "Disabled",
  needs_auth: "Needs authentication",
  needs_client_registration: "Needs client registration",
  failed: "Failed",
}

export function mcpStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

/** True when the server is in a state the user should act on. */
export function mcpNeedsAttention(status: string): boolean {
  return status === "failed" || status === "needs_auth" || status === "needs_client_registration"
}

/**
 * Turns the engine's `{ name: status }` map into a display list. Servers needing attention come
 * first so a broken one is not buried below the working ones.
 */
export function summarizeMcpServers(statuses: Record<string, McpStatus> | undefined): McpServerInfo[] {
  const entries = Object.entries(statuses ?? {}).map(([name, value]) => ({
    name,
    status: typeof value?.status === "string" ? value.status : "unknown",
    error: typeof value?.error === "string" && value.error.trim() ? value.error.trim() : undefined,
  }))
  return entries.sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5)
    return rank !== 0 ? rank : a.name.localeCompare(b.name)
  })
}

/** One-line summary for the view title, e.g. "3 connected, 1 failed". */
export function mcpSummary(servers: readonly McpServerInfo[]): string {
  if (!servers.length) return "No servers configured"
  const counts = new Map<string, number>()
  for (const server of servers) counts.set(server.status, (counts.get(server.status) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => (STATUS_RANK[a[0]] ?? 5) - (STATUS_RANK[b[0]] ?? 5))
    .map(([status, count]) => `${count} ${mcpStatusLabel(status).toLowerCase()}`)
    .join(", ")
}

/** One-line summary for the skills view title, e.g. "12 skills · 1 built-in". */
export function skillsSummary(skills: readonly SkillEntry[]): string {
  if (!skills.length) return "No skills loaded"
  const builtIn = skills.filter((skill) => skill.builtIn).length
  const total = `${skills.length} skill${skills.length === 1 ? "" : "s"}`
  return builtIn ? `${total} · ${builtIn} built-in` : total
}

/** Commands the webview answers itself rather than forwarding to the engine. */
export const LOCAL_COMMAND_NAMES = ["new", "clear", "help", "models", "model"] as const

/**
 * True when a slash command can be sent to the engine. The engine answers an unknown command with
 * HTTP 500 ("Unexpected server error"), so an unknown name must never be forwarded.
 */
export function isKnownCommand(name: string, engineCommands: readonly { name: string }[]): boolean {
  const lower = name.trim().toLowerCase()
  if (!lower) return false
  if ((LOCAL_COMMAND_NAMES as readonly string[]).includes(lower)) return true
  return engineCommands.some((command) => command.name.toLowerCase() === lower)
}
