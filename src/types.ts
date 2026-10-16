export interface SessionInfo {
  id: string
  /** Set on sessions the engine spawned for a subagent (task tool) call. */
  parentID?: string
  title: string
  directory: string
  model?: { id: string; providerID: string; variant?: string }
  time: { created: number; updated: number; archived?: number }
}

/** A skill the engine has loaded and can offer to the agent. */
export interface SkillInfo {
  name: string
  description?: string
  /** Absolute path to the SKILL.md file, or `<built-in>` for skills compiled into the engine. */
  location: string
  content?: string
}

export type McpState = "connected" | "disabled" | "needs_auth" | "needs_client_registration" | "failed"

/** Status of one configured MCP server, keyed by server name in the engine response. */
export interface McpStatus {
  status: McpState | string
  error?: string
  [key: string]: unknown
}

export interface McpServerInfo {
  name: string
  status: McpState | string
  error?: string
}

export interface ProjectSummary {
  id: string
  name?: string
  worktree: string
}

/** A session as returned by the cross-project session listing. */
export interface GlobalSessionInfo extends SessionInfo {
  project?: ProjectSummary | null
}

/** Sessions belonging to one repository, ready for display in the history tree. */
export interface HistoryGroup {
  key: string
  name: string
  path: string
  current: boolean
  updated: number
  sessions: GlobalSessionInfo[]
}

export interface MessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  error?: unknown
  [key: string]: unknown
}

export interface MessagePart {
  id: string
  sessionID: string
  messageID: string
  type: string
  [key: string]: unknown
}

export interface MessageWithParts {
  info: MessageInfo
  parts: MessagePart[]
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  variants?: Record<string, unknown>
  capabilities?: { attachment?: boolean; toolcall?: boolean }
  limit?: { context: number; input?: number; output: number }
}

export interface ProviderInfo {
  id: string
  name: string
  models: Record<string, ModelInfo>
}

export interface ProvidersResponse {
  providers: ProviderInfo[]
  default: Record<string, string>
}

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
}

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
}

export interface OpenCodeEvent {
  id?: string
  type: string
  properties: Record<string, any>
}

export interface EditorContext {
  label: string
  path: string
  startLine?: number
  endLine?: number
  selectedText?: string
  uri: string
}

export type PromptPart =
  | { type: "text"; text: string }
  | {
      type: "file"
      mime: string
      filename: string
      url: string
      source?: {
        type: "file"
        path: string
        text: { value: string; start: number; end: number }
      }
    }

export type PermissionMode = "manual" | "acceptEdits" | "plan" | "auto"

export interface PermissionRule {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

// The engine appends session rules on every update and the last matching rule wins, so each
// mode must restate every permission it cares about (including "*") to override earlier modes.
function rules(edit: "allow" | "deny" | "ask", bash: "allow" | "ask", webfetch: "allow" | "ask"): PermissionRule[] {
  const list: PermissionRule[] = [
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "edit", pattern: "*", action: edit },
    { permission: "bash", pattern: "*", action: bash },
    { permission: "webfetch", pattern: "*", action: webfetch },
    { permission: "doom_loop", pattern: "*", action: "ask" },
  ]
  if (edit !== "allow" || bash !== "allow") {
    list.push(
      { permission: "read", pattern: "*.env", action: "ask" },
      { permission: "read", pattern: "*.env.*", action: "ask" },
      { permission: "read", pattern: "*.env.example", action: "allow" },
    )
  }
  return list
}

export const PERMISSION_MODE_RULES: Record<PermissionMode, PermissionRule[]> = {
  // Ask before file edits, shell commands and web fetches.
  manual: rules("ask", "ask", "ask"),
  // File edits are applied without asking; shell commands and web fetches still ask.
  acceptEdits: rules("allow", "ask", "ask"),
  // Read-only: file edits are denied, shell commands still need confirmation.
  plan: rules("deny", "ask", "allow"),
  // Everything is allowed without prompting. Some requests ignore session rules (doom_loop is
  // evaluated against the agent's rules only, subagent sessions don't inherit these), so the
  // extension also answers any request that still reaches it while this mode is active.
  auto: [{ permission: "*", pattern: "*", action: "allow" }, ...rules("allow", "allow", "allow")],
}

export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden?: boolean
  native?: boolean
  color?: string
}

export interface CommandInfo {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: "command" | "mcp" | "skill"
  hints?: string[]
}

export interface ImageAttachment {
  filename: string
  mime: string
  url: string
}

export interface SelectedModel {
  providerID: string
  modelID: string
  variant?: string
  agent?: string
}

export interface AgentModelPreference {
  model: string
  variant: string
}
