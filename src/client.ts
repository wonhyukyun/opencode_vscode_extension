import type {
  AgentInfo,
  PermissionRule,
  CommandInfo,
  GlobalSessionInfo,
  McpStatus,
  SkillInfo,
  MessageWithParts,
  OpenCodeEvent,
  PermissionRequest,
  PromptPart,
  ProvidersResponse,
  QuestionRequest,
  SelectedModel,
  SessionInfo,
} from "./types"

export class OpenCodeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly directory: string,
    private readonly authorization?: string,
  ) {}

  listSessions(limit = 50): Promise<SessionInfo[]> {
    return this.request(`/session?scope=project&roots=true&limit=${limit}`)
  }

  /** Lists root sessions across every project so history can be grouped by repository. */
  listGlobalSessions(limit = 50): Promise<GlobalSessionInfo[]> {
    return this.request(`/experimental/session?roots=true&limit=${limit}`)
  }

  /** Skills the engine has loaded for this workspace, including built-ins. */
  listSkills(): Promise<SkillInfo[]> {
    return this.request("/skill")
  }

  /** Status of every configured MCP server, keyed by server name. */
  mcpStatus(): Promise<Record<string, McpStatus>> {
    return this.request("/mcp")
  }

  createSession(): Promise<SessionInfo> {
    return this.request("/session", { method: "POST", body: "{}" })
  }

  getSession(sessionID: string): Promise<SessionInfo> {
    return this.request(`/session/${encodeURIComponent(sessionID)}`)
  }

  updateSessionPermission(sessionID: string, permission: PermissionRule[]): Promise<SessionInfo> {
    return this.request(`/session/${encodeURIComponent(sessionID)}`, {
      method: "PATCH",
      body: JSON.stringify({ permission }),
    })
  }

  deleteSession(sessionID: string): Promise<boolean> {
    return this.request(`/session/${encodeURIComponent(sessionID)}`, { method: "DELETE" })
  }

  getMessages(sessionID: string): Promise<MessageWithParts[]> {
    return this.request(`/session/${encodeURIComponent(sessionID)}/message?limit=200`)
  }

  sendPrompt(sessionID: string, parts: PromptPart[], model?: SelectedModel): Promise<void> {
    const body: Record<string, unknown> = { parts }
    if (model) body.model = { providerID: model.providerID, modelID: model.modelID }
    if (model?.variant) body.variant = model.variant
    if (model?.agent) body.agent = model.agent
    return this.request(`/session/${encodeURIComponent(sessionID)}/prompt_async`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  sendCommand(sessionID: string, command: string, args: string, model?: SelectedModel): Promise<MessageWithParts> {
    const body: Record<string, unknown> = { command, arguments: args }
    if (model) body.model = `${model.providerID}/${model.modelID}`
    if (model?.variant) body.variant = model.variant
    if (model?.agent) body.agent = model.agent
    return this.request(`/session/${encodeURIComponent(sessionID)}/command`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  agents(): Promise<AgentInfo[]> {
    return this.request("/agent")
  }

  commands(): Promise<CommandInfo[]> {
    return this.request("/command")
  }

  findFiles(query: string, limit = 20): Promise<string[]> {
    const params = new URLSearchParams({ query, limit: String(limit) })
    return this.request(`/find/file?${params.toString()}`)
  }

  abort(sessionID: string): Promise<boolean> {
    return this.request(`/session/${encodeURIComponent(sessionID)}/abort`, { method: "POST" })
  }

  providers(): Promise<ProvidersResponse> {
    return this.request("/config/providers")
  }

  permissions(): Promise<PermissionRequest[]> {
    return this.request("/permission")
  }

  replyPermission(requestID: string, reply: "once" | "always" | "reject"): Promise<boolean> {
    return this.request(`/permission/${encodeURIComponent(requestID)}/reply`, {
      method: "POST",
      body: JSON.stringify({ reply }),
    })
  }

  questions(): Promise<QuestionRequest[]> {
    return this.request("/question")
  }

  sessionStatuses(): Promise<Record<string, { type: string }>> {
    return this.request("/session/status")
  }

  replyQuestion(requestID: string, answers: string[][]): Promise<boolean> {
    return this.request(`/question/${encodeURIComponent(requestID)}/reply`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    })
  }

  rejectQuestion(requestID: string): Promise<boolean> {
    return this.request(`/question/${encodeURIComponent(requestID)}/reject`, { method: "POST" })
  }

  async subscribe(onEvent: (event: OpenCodeEvent) => void, signal: AbortSignal, onConnected?: () => Promise<void>): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(`${this.baseUrl}/event`, {
          headers: this.headers({ Accept: "text/event-stream" }),
          signal,
        })
        if (!response.ok || !response.body) throw new Error(`Event stream failed with HTTP ${response.status}`)
        try {
          await onConnected?.()
          onEvent({ type: "client.connected", properties: {} })
          await parseEventStream(response.body, onEvent, signal)
        } finally {
          await response.body.cancel().catch(() => {})
        }
      } catch (error) {
        if (signal.aborted) return
      }
      if (signal.aborted) return
      onEvent({ type: "client.disconnected", properties: {} })
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve() }
        const timer = setTimeout(finish, 750)
        signal.addEventListener("abort", finish, { once: true })
        if (signal.aborted) finish()
      })
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init.headers),
      signal: AbortSignal.timeout(60_000),
    })
    const text = await response.text()
    if (!response.ok) {
      let detail = text
      try {
        const parsed = JSON.parse(text) as { message?: string; data?: { message?: string } }
        detail = parsed.data?.message ?? parsed.message ?? text
      } catch {}
      throw new Error(detail || `OpenCode API returned HTTP ${response.status}`)
    }
    if (!text) return true as T
    return JSON.parse(text) as T
  }

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(extra)
    headers.set("x-opencode-directory", encodeURIComponent(this.directory))
    if (this.authorization) headers.set("Authorization", this.authorization)
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    return headers
  }
}

export async function parseEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: OpenCodeEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n")
      let boundary: number
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data || data === "[DONE]") continue
        try {
          const parsed = JSON.parse(data) as OpenCodeEvent | { payload: OpenCodeEvent }
          onEvent("payload" in parsed ? parsed.payload : parsed)
        } catch {}
      }
    }
  } finally {
    reader.releaseLock()
  }
}
