import type {
  CommandInfo,
  MessageWithParts,
  OpenCodeEvent,
  PermissionRequest,
  PromptPart,
  ProviderCatalogResponse,
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

  listSessions(): Promise<SessionInfo[]> {
    return this.request("/session?scope=project&roots=true&limit=50")
  }

  createSession(): Promise<SessionInfo> {
    return this.request("/session", { method: "POST", body: "{}" })
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
    return this.request(`/session/${encodeURIComponent(sessionID)}/prompt_async`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  sendCommand(sessionID: string, command: string, args: string, model?: SelectedModel): Promise<MessageWithParts> {
    const body: Record<string, unknown> = { command, arguments: args }
    if (model) body.model = `${model.providerID}/${model.modelID}`
    if (model?.variant) body.variant = model.variant
    return this.request(`/session/${encodeURIComponent(sessionID)}/command`, {
      method: "POST",
      body: JSON.stringify(body),
    })
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

  providerCatalog(): Promise<ProviderCatalogResponse> {
    return this.request("/provider")
  }

  providerAuthMethods(): Promise<Record<string, Array<{ type: "api" | "oauth"; label: string }>>> {
    return this.request("/provider/auth")
  }

  setApiKey(providerID: string, key: string): Promise<boolean> {
    return this.request(`/auth/${encodeURIComponent(providerID)}`, {
      method: "PUT",
      body: JSON.stringify({ type: "api", key }),
    })
  }

  authorizeOAuth(providerID: string, method: number): Promise<{ url: string; method: "auto" | "code"; instructions: string }> {
    return this.request(`/provider/${encodeURIComponent(providerID)}/oauth/authorize`, {
      method: "POST",
      body: JSON.stringify({ method, inputs: {} }),
    })
  }

  finishOAuth(providerID: string, method: number, code?: string): Promise<boolean> {
    return this.request(`/provider/${encodeURIComponent(providerID)}/oauth/callback`, {
      method: "POST",
      body: JSON.stringify({ method, code }),
    })
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

  replyQuestion(requestID: string, answers: string[][]): Promise<boolean> {
    return this.request(`/question/${encodeURIComponent(requestID)}/reply`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    })
  }

  rejectQuestion(requestID: string): Promise<boolean> {
    return this.request(`/question/${encodeURIComponent(requestID)}/reject`, { method: "POST" })
  }

  async subscribe(onEvent: (event: OpenCodeEvent) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(`${this.baseUrl}/event`, {
          headers: this.headers({ Accept: "text/event-stream" }),
          signal,
        })
        if (!response.ok || !response.body) throw new Error(`Event stream failed with HTTP ${response.status}`)
        await parseEventStream(response.body, onEvent, signal)
      } catch (error) {
        if (signal.aborted) return
        await new Promise((resolve) => setTimeout(resolve, 750))
      }
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
