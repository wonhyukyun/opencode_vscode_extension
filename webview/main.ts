import DOMPurify from "dompurify"
import { marked } from "marked"
import { applyOpenCodeEvent, type EventState } from "../src/eventReducer"
import { summarizeTokens } from "../src/tokens"
import { findModel, formatContextWindow, resolveContextWindow, type ModelRef, type ResolvedContextWindow } from "../src/contextWindow"
import { questionAnswers, type QuestionDraft } from "../src/questionState"
import { isKnownCommand } from "../src/loadedResources"
import { formatModelValue, normalizeModelValue, parseModelValue, resolveConfiguredDefault } from "../src/modelRef"
import type {
  AgentInfo,
  AgentModelPreference,
  PermissionMode,
  CommandInfo,
  EditorContext,
  MessagePart,
  MessageWithParts,
  ModelInfo,
  OpenCodeEvent,
  PermissionRequest,
  ProvidersResponse,
  QuestionRequest,
  SessionInfo,
} from "../src/types"

declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: unknown): void
  getState(): T | undefined
  setState(state: T): void
}

const vscode = acquireVsCodeApi<{ selectedModel?: string; selectedVariant?: string; selectedAgent?: string; questionDrafts?: Record<string, QuestionDraft> }>()
const questionDrafts = vscode.getState()?.questionDrafts ?? {}
const questionSubmissions = new Set<string>()
const questionErrors = new Map<string, string>()
let connected = true

interface ViewState extends EventState {
  sessions: SessionInfo[]
  activeSessionID?: string
  providers?: ProvidersResponse
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  context?: EditorContext
  contextEnabled: boolean
  images: ImageAttachment[]
  commands: CommandInfo[]
  agents: AgentInfo[]
  agentModels: Record<string, AgentModelPreference>
  permissionMode: PermissionMode
  /** The opencodeIntegrated.defaultModel setting, in provider/model form. */
  defaultModel: string
  phase: "starting" | "ready"
}

interface Suggestion {
  label: string
  detail?: string
  insert: string
}

interface ImageAttachment {
  filename: string
  mime: string
  url: string
}

const state: ViewState = {
  sessions: [],
  messages: [],
  permissions: [],
  questions: [],
  contextEnabled: true,
  images: [],
  commands: [],
  agents: [],
  agentModels: {},
  permissionMode: "manual",
  defaultModel: "",
  busy: false,
  phase: "starting",
}

const app = document.getElementById("app")!
app.innerHTML = `
  <header class="topbar">
    <span id="session-title" class="session-title">New chat</span>
    <button id="chat-history" class="link-button" title="Search and reopen previous chats" aria-label="Chat history">History</button>
    <button id="delete-chat" class="icon-button" title="Delete chat" aria-label="Delete chat">⌫</button>
  </header>
  <section id="notices" class="notices"></section>
  <section id="messages" class="messages" tabindex="0">
    <div class="loading"><span class="spinner"></span> Starting OpenCode…</div>
  </section>
  <footer class="composer-wrap">
    <div id="interrupts" class="interrupts">
      <section id="questions" class="questions" aria-live="polite"></section>
      <section id="permissions" class="permissions" aria-live="polite"></section>
    </div>
    <button id="context" class="context-chip hidden" type="button"></button>
    <div id="attachments" class="attachments"></div>
    <div id="suggestions" class="suggest hidden" role="listbox"></div>
    <div class="composer">
      <textarea id="prompt" rows="1" placeholder="Ask OpenCode… (@ file, / command)" aria-label="Message OpenCode"></textarea>
      <button id="send" class="send-button" title="Send (Enter)" aria-label="Send">↑</button>
      <button id="stop" class="stop-button hidden" title="Stop" aria-label="Stop">■</button>
    </div>
    <div class="composer-footer">
      <div class="footer-row">
      <select id="permission-mode" class="mode-select" aria-label="Permission mode" title="Permission mode">
        <option value="manual">Manual</option>
        <option value="acceptEdits">Edit automatically</option>
        <option value="plan">Plan</option>
        <option value="auto">Auto</option>
      </select>
      <select id="agents" class="agent-select" aria-label="Agent" hidden></select>
      <select id="models" class="model-select" aria-label="AI model"></select>
      </div>
      <div class="footer-row">
      <select id="variants" class="variant-select" aria-label="Thinking effort" hidden></select>
      <button id="attach-image" class="link-button hidden" type="button" title="Attach image">Image</button>
      <input id="image-input" type="file" accept="image/*" multiple hidden>
      <span id="tokens" class="tokens" hidden></span>
      <span id="status" class="status"></span>
      <button id="debug" class="link-button" type="button" title="Dump engine log and recent SSE events to the OpenCode Integrated output channel">Debug</button>
      </div>
    </div>
  </footer>`

const messagesElement = element("messages")
const modelsElement = element<HTMLSelectElement>("models")
const variantsElement = element<HTMLSelectElement>("variants")
const agentsElement = element<HTMLSelectElement>("agents")
const permissionModeElement = element<HTMLSelectElement>("permission-mode")
const PERMISSION_MODE_HINTS: Record<PermissionMode, string> = {
  manual: "Manual: ask before edits and shell commands",
  acceptEdits: "Edit automatically: apply file edits without asking",
  plan: "Plan: read-only, no file edits",
  auto: "Auto: allow everything without asking",
}
const promptElement = element<HTMLTextAreaElement>("prompt")
const attachImageElement = element<HTMLButtonElement>("attach-image")
const imageInputElement = element<HTMLInputElement>("image-input")
const attachmentsElement = element("attachments")
const suggestionsElement = element("suggestions")
const contextElement = element<HTMLButtonElement>("context")

marked.setOptions({ gfm: true, breaks: true })

// Questions and permission requests float over the bottom of the transcript, right above the
// composer. Pad the transcript by the overlay's height so its last lines stay reachable.
new ResizeObserver(() => {
  const height = element("interrupts").offsetHeight
  messagesElement.style.paddingBottom = height ? `${height + 20}px` : ""
}).observe(element("interrupts"))

element("chat-history").addEventListener("click", () => vscode.postMessage({ type: "showHistory" }))
element("delete-chat").addEventListener("click", () => {
  if (state.activeSessionID && confirm("Delete this OpenCode chat?")) {
    vscode.postMessage({ type: "deleteSession", sessionID: state.activeSessionID })
  }
})
element("send").addEventListener("click", send)
element("stop").addEventListener("click", () => vscode.postMessage({ type: "abort" }))
element("debug").addEventListener("click", () => vscode.postMessage({ type: "debug", snapshot: debugSnapshot() }))
contextElement.addEventListener("click", () => {
  state.contextEnabled = !state.contextEnabled
  renderContext()
})
modelsElement.addEventListener("change", () => {
  vscode.setState({ ...vscode.getState(), selectedModel: modelsElement.value })
  renderVariants()
  saveAgentModel()
  renderTokens()
})
variantsElement.addEventListener("change", () => {
  vscode.setState({ ...vscode.getState(), selectedVariant: variantsElement.value })
  saveAgentModel()
  renderTokens()
})
permissionModeElement.addEventListener("change", () => {
  state.permissionMode = permissionModeElement.value as PermissionMode
  renderPermissionMode()
  vscode.postMessage({ type: "permissionMode", mode: state.permissionMode })
})
agentsElement.addEventListener("change", () => {
  vscode.setState({ ...vscode.getState(), selectedAgent: agentsElement.value })
  renderModels()
})
promptElement.addEventListener("input", resizePrompt)
attachImageElement.addEventListener("click", () => imageInputElement.click())
imageInputElement.addEventListener("change", () => {
  void addImages(Array.from(imageInputElement.files ?? []))
  imageInputElement.value = ""
})
promptElement.addEventListener("paste", (event) => {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  if (!files.length) return
  event.preventDefault()
  void addImages(files)
})
promptElement.addEventListener("dragover", (event) => {
  if (supportsAttachments()) event.preventDefault()
})
promptElement.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"))
  if (!files.length) return
  event.preventDefault()
  void addImages(files)
})

function supportsAttachments(): boolean {
  return selectedModelInfo()?.capabilities?.attachment === true
}

async function addImages(files: File[]): Promise<void> {
  if (!supportsAttachments()) {
    state.error = "The selected model does not accept image attachments."
    renderNotices()
    return
  }
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    state.images.push({ filename: file.name || `image-${Date.now()}.png`, mime: file.type, url })
  }
  renderAttachments()
}

function renderAttachments(): void {
  attachmentsElement.innerHTML = state.images
    .map(
      (image, index) => `<span class="attachment">
        <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.filename)}">
        <button type="button" data-remove="${index}" title="Remove" aria-label="Remove image">x</button>
      </span>`,
    )
    .join("")
  attachmentsElement.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.images.splice(Number(button.dataset.remove), 1)
      renderAttachments()
    })
  })
}
promptElement.addEventListener("keydown", (event) => {
  if (event.isComposing) return
  if (suggest.items.length) {
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault()
      suggest.index = (suggest.index + 1) % suggest.items.length
      renderSuggestions()
      return
    }
    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault()
      suggest.index = (suggest.index - 1 + suggest.items.length) % suggest.items.length
      renderSuggestions()
      return
    }
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault()
      applySuggestion(suggest.items[suggest.index])
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      closeSuggestions()
      return
    }
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    send()
  }
})
promptElement.addEventListener("input", updateSuggestions)
promptElement.addEventListener("click", updateSuggestions)
promptElement.addEventListener("keyup", (event) => {
  if (event.key.startsWith("Arrow") && !suggest.items.length) updateSuggestions()
})
promptElement.addEventListener("blur", () => setTimeout(closeSuggestions, 150))

const BUILTIN_COMMANDS: Suggestion[] = [
  { label: "/new", detail: "Start a new chat", insert: "/new " },
  { label: "/clear", detail: "Clear conversation and start fresh", insert: "/clear " },
  { label: "/help", detail: "Show input shortcuts", insert: "/help " },
  { label: "/models", detail: "Open the model picker", insert: "/models " },
]

const suggest: { items: Suggestion[]; index: number; trigger?: { kind: "@" | "/"; start: number; end: number }; requestID: number } = {
  items: [],
  index: 0,
  requestID: 0,
}

function currentTrigger(): { kind: "@" | "/"; start: number; end: number; query: string } | undefined {
  const cursor = promptElement.selectionStart ?? promptElement.value.length
  const before = promptElement.value.slice(0, cursor)
  const slash = /^\/(\S*)$/.exec(before)
  if (slash) return { kind: "/", start: 0, end: cursor, query: slash[1] ?? "" }
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (at) {
    const query = at[1] ?? ""
    return { kind: "@", start: cursor - query.length - 1, end: cursor, query }
  }
  return undefined
}

function updateSuggestions(): void {
  const trigger = currentTrigger()
  if (!trigger) {
    closeSuggestions()
    return
  }
  suggest.trigger = trigger
  if (trigger.kind === "/") {
    const query = trigger.query.toLowerCase()
    const server = state.commands.map((command) => ({
      label: `/${command.name}`,
      detail: command.description ?? (command.source ? `${command.source} command` : undefined),
      insert: `/${command.name} `,
    }))
    const seen = new Set<string>()
    suggest.items = [...BUILTIN_COMMANDS, ...server]
      .filter((item) => item.label.slice(1).toLowerCase().includes(query))
      .filter((item) => (seen.has(item.label) ? false : (seen.add(item.label), true)))
      .slice(0, 12)
    suggest.index = 0
    renderSuggestions()
    return
  }
  const requestID = ++suggest.requestID
  vscode.postMessage({ type: "findFiles", query: trigger.query, requestID })
}

function receiveFileResults(requestID: number, files: string[]): void {
  if (requestID !== suggest.requestID || suggest.trigger?.kind !== "@") return
  suggest.items = files.slice(0, 12).map((file) => ({ label: file, insert: `@${file} ` }))
  suggest.index = 0
  renderSuggestions()
}

function applySuggestion(item: Suggestion | undefined): void {
  const trigger = suggest.trigger
  if (!item || !trigger) return
  const value = promptElement.value
  promptElement.value = value.slice(0, trigger.start) + item.insert + value.slice(trigger.end)
  const cursor = trigger.start + item.insert.length
  promptElement.setSelectionRange(cursor, cursor)
  closeSuggestions()
  resizePrompt()
  promptElement.focus()
}

function closeSuggestions(): void {
  suggest.items = []
  suggest.trigger = undefined
  suggestionsElement.classList.add("hidden")
  suggestionsElement.innerHTML = ""
}

function renderSuggestions(): void {
  if (!suggest.items.length) {
    closeSuggestions()
    return
  }
  suggestionsElement.innerHTML = suggest.items
    .map(
      (item, index) => `<div class="suggest-item${index === suggest.index ? " active" : ""}" role="option" data-index="${index}">
        <span class="suggest-label">${escapeHtml(item.label)}</span>
        ${item.detail ? `<span class="suggest-detail">${escapeHtml(item.detail)}</span>` : ""}
      </div>`,
    )
    .join("")
  suggestionsElement.classList.remove("hidden")
  suggestionsElement.querySelectorAll<HTMLElement>("[data-index]").forEach((node) => {
    node.addEventListener("mousedown", (event) => {
      event.preventDefault()
      applySuggestion(suggest.items[Number(node.dataset.index)])
    })
  })
  suggestionsElement.querySelector(".active")?.scrollIntoView({ block: "nearest" })
}

function extractMentions(text: string): string[] {
  const files: string[] = []
  const pattern = /(?:^|\s)@([^\s@]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const file = (match[1] ?? "").replace(/[.,;:!?)]+$/, "")
    if (file) files.push(file)
  }
  return files
}
messagesElement.addEventListener("click", (event) => {
  const target = event.target as HTMLElement
  const link = target.closest("a") as HTMLAnchorElement | null
  if (link?.href) {
    event.preventDefault()
    vscode.postMessage({ type: "openLink", href: link.href })
    return
  }
  const copy = target.closest<HTMLButtonElement>("[data-copy]")
  if (copy) {
    const text = decodeURIComponent(copy.dataset.copy ?? "")
    void navigator.clipboard.writeText(text).then(() => {
      const previous = copy.textContent
      copy.textContent = "Copied"
      setTimeout(() => (copy.textContent = previous), 900)
    })
  }
})
element("permissions").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-permission]")
  if (!button) return
  vscode.postMessage({
    type: "permissionReply",
    requestID: button.dataset.request,
    reply: button.dataset.permission,
  })
})

window.addEventListener("message", ({ data }) => {
  switch (data.type) {
    case "initialize":
      state.phase = "ready"
      state.sessions = data.sessions
      state.commands = data.commands ?? []
      state.agents = data.agents ?? []
      state.agentModels = data.agentModels ?? {}
      state.permissionMode = data.permissionMode ?? "manual"
      state.defaultModel = data.defaultModel ?? ""
      renderAgents()
      renderPermissionMode()
      state.activeSessionID = data.activeSessionID
      state.messages = data.messages
      state.providers = data.providers
      state.permissions = data.permissions
      state.questions = data.questions ?? []
      state.busy = data.busy ?? false
      state.context = data.context
      renderAll()
      // Surface a misconfigured default-model setting at startup, not only when it is edited.
      state.error = resolveConfiguredDefault(state.defaultModel, state.providers).problem
      renderNotices()
      break
    case "sessionSelected":
      state.questions = data.questions ?? []
      state.permissions = data.permissions ?? []
      renderQuestions()
      follow.enabled = true
      state.activeSessionID = data.sessionID
      state.messages = data.messages ?? []
      state.busy = data.busy ?? false
      state.error = undefined
      renderAll()
      promptElement.focus()
      break
    case "sessions":
      state.sessions = data.sessions
      state.activeSessionID = data.activeSessionID
      renderSessions()
      break
    case "providers":
      state.providers = data.providers
      renderModels()
      break
    case "agentModels":
      state.agentModels = data.preferences
      renderModels()
      break
    case "defaultModel":
      state.defaultModel = data.defaultModel ?? ""
      applyConfiguredDefault()
      break
    case "fileResults":
      receiveFileResults(data.requestID, data.files)
      break
    case "context":
      state.context = data.context
      if (data.enabled) state.contextEnabled = true
      renderContext()
      break
    case "permission":
      if (!state.permissions.some((item) => item.id === data.permission.id)) state.permissions.push(data.permission)
      renderPermissions()
      break
    case "question":
      if (!state.questions.some((item) => item.id === data.question.id)) state.questions.push(data.question)
      renderQuestions()
      break
    case "questionResolved":
      state.questions = state.questions.filter((item) => item.id !== data.requestID)
      questionSubmissions.delete(data.requestID)
      questionErrors.delete(data.requestID)
      delete questionDrafts[data.requestID]
      persistQuestionDrafts()
      renderQuestions()
      break
    case "questionSubmitting":
      questionSubmissions.add(data.requestID)
      questionErrors.delete(data.requestID)
      renderQuestions()
      break
    case "questionFailed":
      questionSubmissions.delete(data.requestID)
      questionErrors.set(data.requestID, `Could not send your response: ${data.message}. Your answer is saved. Try again.`)
      renderQuestions()
      break
    case "connection":
      connected = data.connected
      renderQuestions()
      renderBusy()
      break
    case "pendingSnapshot":
      if (data.sessionID !== state.activeSessionID) break
      state.questions = data.questions
      state.permissions = data.permissions
      state.busy = data.busy
      renderQuestions()
      renderPermissions()
      renderBusy()
      break
    case "permissionResolved":
      state.permissions = state.permissions.filter((item) => item.id !== data.requestID)
      renderPermissions()
      break
    case "event": {
      const next = applyOpenCodeEvent(state, data.event as OpenCodeEvent)
      state.messages = next.messages
      state.busy = next.busy
      state.error = next.error
      scheduleMessageRender()
      renderBusy()
      renderNotices()
      break
    }
    case "status":
      if (data.status === "busy") state.busy = true
      renderBusy(data.message)
      break
    case "error":
      state.error = data.message
      state.busy = false
      renderNotices()
      renderBusy()
      break
  }
})

let renderFrame: number | undefined
function scheduleMessageRender(): void {
  if (renderFrame !== undefined) return
  renderFrame = requestAnimationFrame(() => {
    renderFrame = undefined
    renderMessages()
  })
}

/**
 * Runs a command the webview owns. `/models` and `/model` open the picker instead of reaching the
 * engine, which has no such command. Returns true when the command was handled here.
 */
function handleLocalCommand(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower !== "models" && lower !== "model") return false
  state.error = undefined
  if (modelsElement.disabled || !modelsElement.options.length) {
    state.error = "No models are available. Sign in to a provider or configure one in opencode.json."
    renderNotices()
    return true
  }
  modelsElement.focus()
  modelsElement.showPicker?.()
  const model = selectedModelInfo()
  const window = model?.limit?.context
  element("status").textContent = model
    ? `Model: ${model.name}${window ? ` · ${formatContextWindow(window)} context` : ""}`
    : "Pick a model below"
  renderNotices()
  return true
}

function send(): void {
  const text = promptElement.value.trim()
  if (state.questions.length) {
    element("questions").querySelector<HTMLInputElement>("input:not(:disabled)")?.focus()
    return
  }
  if (!connected) return
  if ((!text && !state.images.length) || state.busy) return
  closeSuggestions()
  const { providerID, modelID } = parseModelValue(modelsElement.value)
  const variant = variantsElement.hidden ? "" : variantsElement.value
  const agent = agentsElement.hidden ? "" : agentsElement.value
  const model = providerID && modelID ? { providerID, modelID, variant: variant || undefined, agent: agent || undefined } : undefined
  const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
  if (slash) {
    const name = slash[1] ?? ""
    // The engine answers an unknown command with HTTP 500, so only forward names it knows.
    if (!handleLocalCommand(name)) {
      if (!isKnownCommand(name, state.commands)) {
        state.error = `Unknown command /${name}. Type / to see the commands this workspace has.`
        renderNotices()
        return
      }
      vscode.postMessage({ type: "command", command: name, arguments: (slash[2] ?? "").trim(), model })
    }
    promptElement.value = ""
    resizePrompt()
    return
  }
  vscode.postMessage({
    type: "send",
    text,
    attachContext: Boolean(state.context && state.contextEnabled),
    model,
    images: state.images.map((image) => ({ filename: image.filename, mime: image.mime, url: image.url })),
    files: extractMentions(text),
  })
  state.images = []
  renderAttachments()
  promptElement.value = ""
  resizePrompt()
  state.busy = true
  renderBusy()
}

function renderAll(): void {
  renderSessions()
  renderModels()
  renderMessages()
  renderContext()
  renderPermissions()
  renderQuestions()
  renderNotices()
  renderBusy()
}

function renderSessions(): void {
  element("session-title").textContent = state.sessions.find((session) => session.id === state.activeSessionID)?.title || "New chat"
  element<HTMLButtonElement>("delete-chat").disabled = !state.activeSessionID
}

function renderModels(): void {
  const preference = state.agentModels[agentsElement.value]
  // Older builds saved a value whose separator HTML had mangled; repair it rather than
  // silently falling back to the default model on every render.
  const previous = normalizeModelValue(
    preference?.model ?? (modelsElement.value || vscode.getState()?.selectedModel),
  )
  const providers = state.providers?.providers ?? []
  const options: string[] = []
  for (const provider of providers) {
    const models = Object.values(provider.models).filter((model) => model.capabilities?.toolcall !== false)
    for (const model of models) {
      options.push(modelOption(provider.name, model))
    }
  }
  modelsElement.innerHTML = options.length ? options.join("") : '<option value="">No model configured in opencode.json</option>'
  if (previous && Array.from(modelsElement.options).some((option) => option.value === previous)) {
    modelsElement.value = previous
  } else {
    selectDefaultModel()
  }
  modelsElement.disabled = options.length === 0
  modelsElement.title = "Model for the selected agent (saved for this workspace)"
  renderVariants()
  // Write back when there is no stored preference, and also when the stored one used the old
  // mangled separator, so the workspace stops carrying a value nothing can match.
  if (!preference || preference.model !== modelsElement.value) saveAgentModel()
}

function saveAgentModel(): void {
  const agent = agentsElement.value
  if (!agent || !modelsElement.value) return
  const preference = { model: modelsElement.value, variant: variantsElement.value }
  state.agentModels[agent] = preference
  vscode.postMessage({ type: "agentModel", agent, preference })
}

/** Provider, model, and variant currently chosen in the picker. */
function selectedModelRef(): ModelRef {
  const { providerID, modelID } = parseModelValue(modelsElement.value)
  return { providerID, modelID, variant: variantsElement.hidden ? undefined : variantsElement.value || undefined }
}

function selectedModelInfo(): ModelInfo | undefined {
  const { providerID, modelID } = parseModelValue(modelsElement.value)
  const provider = (state.providers?.providers ?? []).find((item) => item.id === providerID)
  return modelID ? provider?.models[modelID] : undefined
}

function renderVariants(): void {
  renderAttachmentControls()
  const model = selectedModelInfo()
  const variants = Object.keys(model?.variants ?? {})
  variantsElement.hidden = !model
  if (!model) {
    variantsElement.innerHTML = ""
    return
  }
  if (!variants.length) {
    variantsElement.innerHTML = '<option value="">Effort: not configured</option>'
    variantsElement.value = ""
    variantsElement.disabled = true
    variantsElement.title =
      `No thinking-effort variants are defined for ${model.providerID}/${model.id}.
` +
      `Add them in opencode.json under provider.${model.providerID}.models["${model.id}"].variants, e.g.
` +
      `"variants": { "low": { "reasoningEffort": "low" }, "high": { "reasoningEffort": "high" } }`
    return
  }
  const preference = state.agentModels[agentsElement.value]
  const previous = (normalizeModelValue(preference?.model) === modelsElement.value
    ? preference?.variant
    : variantsElement.value || vscode.getState()?.selectedVariant) ?? ""
  variantsElement.innerHTML = ['<option value="">Default effort</option>']
    .concat(variants.map((name) => `<option value="${escapeAttribute(name)}">${escapeHtml(name)}</option>`))
    .join("")
  variantsElement.value = variants.includes(previous) ? previous : ""
  variantsElement.disabled = false
  variantsElement.title = "Thinking effort (opencode.json variants)"
}

function renderPermissionMode(): void {
  permissionModeElement.value = state.permissionMode
  permissionModeElement.title = PERMISSION_MODE_HINTS[state.permissionMode]
  permissionModeElement.dataset.mode = state.permissionMode
}

function renderAgents(): void {
  const agents = state.agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  if (!agents.length) {
    agentsElement.hidden = true
    agentsElement.innerHTML = ""
    return
  }
  const previous = agentsElement.value || vscode.getState()?.selectedAgent || ""
  agentsElement.innerHTML = agents
    .map(
      (agent) =>
        `<option value="${escapeAttribute(agent.name)}" title="${escapeAttribute(agent.description ?? "")}">${escapeHtml(agent.name)}</option>`,
    )
    .join("")
  const names = agents.map((agent) => agent.name)
  agentsElement.value = names.includes(previous) ? previous : names.includes("build") ? "build" : names[0] ?? ""
  agentsElement.hidden = false
}

function renderAttachmentControls(): void {
  const supported = supportsAttachments()
  attachImageElement.classList.toggle("hidden", !supported)
  if (!supported && state.images.length) {
    state.images = []
    renderAttachments()
  }
}

function modelOption(providerName: string, model: ModelInfo): string {
  const value = formatModelValue(model.providerID, model.id)
  const limit = model.limit?.context
  const window = limit ? ` (${formatContextWindow(limit)})` : ""
  const title = limit
    ? `${model.providerID}/${model.id} · context window ${limit.toLocaleString()} tokens`
    : `${model.providerID}/${model.id} · context window not reported`
  return `<option value="${escapeAttribute(value)}" title="${escapeAttribute(title)}">${escapeHtml(providerName)} · ${escapeHtml(model.name)}${escapeHtml(window)}</option>`
}

function hasModelOption(value: string): boolean {
  return Array.from(modelsElement.options).some((option) => option.value === value)
}

/**
 * Applies the default-model setting after the user edits it. Editing a setting is deliberate, so
 * it takes effect at once and becomes the saved preference rather than waiting for a fresh agent.
 */
function applyConfiguredDefault(): void {
  const configured = resolveConfiguredDefault(state.defaultModel, state.providers)
  state.error = configured.problem
  if (configured.value && hasModelOption(configured.value)) {
    modelsElement.value = configured.value
    renderVariants()
    saveAgentModel()
    renderTokens()
  }
  renderNotices()
}

function selectDefaultModel(): void {
  const configured = resolveConfiguredDefault(state.defaultModel, state.providers)
  if (configured.value && hasModelOption(configured.value)) {
    modelsElement.value = configured.value
    return
  }
  const defaults = state.providers?.default ?? {}
  for (const [providerID, modelID] of Object.entries(defaults)) {
    const value = formatModelValue(providerID, modelID)
    if (Array.from(modelsElement.options).some((option) => option.value === value)) {
      modelsElement.value = value
      return
    }
  }
}

// Auto-scroll: follow the newest content unless the user deliberately scrolled up.
const follow = { enabled: true, programmatic: false, userIntent: false }

function distanceFromBottom(): number {
  return messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight
}

function scrollToBottom(): void {
  follow.programmatic = true
  messagesElement.scrollTop = messagesElement.scrollHeight
  requestAnimationFrame(() => {
    follow.programmatic = false
  })
}

function markUserScrollIntent(): void {
  follow.userIntent = true
}

messagesElement.addEventListener("wheel", markUserScrollIntent, { passive: true })
messagesElement.addEventListener("touchstart", markUserScrollIntent, { passive: true })
messagesElement.addEventListener("mousedown", markUserScrollIntent)
messagesElement.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) markUserScrollIntent()
})
messagesElement.addEventListener("scroll", () => {
  if (follow.programmatic) return
  const atBottom = distanceFromBottom() < 24
  if (atBottom) {
    follow.enabled = true
  } else if (follow.userIntent) {
    follow.enabled = false
  }
  follow.userIntent = false
})
new ResizeObserver(() => {
  if (follow.enabled) scrollToBottom()
}).observe(messagesElement)
new MutationObserver(() => {
  if (follow.enabled) scrollToBottom()
}).observe(messagesElement, { childList: true, subtree: true, characterData: true })
messagesElement.addEventListener(
  "load",
  () => {
    if (follow.enabled) scrollToBottom()
  },
  true,
)

function renderMessages(): void {
  renderTokens()
  if (!state.messages.length) {
    messagesElement.innerHTML = `
      <div class="empty-state">
        <div class="logo-mark">▣</div>
        <h2>Build with OpenCode</h2>
        <p>Ask about your code, make changes, or attach the current selection. The engine runs inside this extension.</p>
        <div class="suggestions">
          <button data-suggestion="Explain the current file">Explain the current file</button>
          <button data-suggestion="Find and fix a bug in this project">Find and fix a bug</button>
          <button data-suggestion="Add tests for the current selection">Add tests</button>
        </div>
      </div>`
    messagesElement.querySelectorAll<HTMLButtonElement>("[data-suggestion]").forEach((button) => {
      button.addEventListener("click", () => {
        promptElement.value = button.dataset.suggestion ?? ""
        promptElement.focus()
        resizePrompt()
      })
    })
    return
  }
  messagesElement.innerHTML = state.messages.map(renderMessage).join("")
  if (follow.enabled) scrollToBottom()
  renderTokens()
}

function renderMessage(message: MessageWithParts): string {
  const role = message.info.role
  const content = message.parts.map((part) => renderPart(part, role)).join("")
  const plainText = message.parts
    .filter((part) => part.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n")
  return `<article class="message ${role}">
    <div class="message-header"><span>${role === "user" ? "You" : "OpenCode"}</span>${messageModelBadge(message)}${
      plainText ? `<button class="copy-button" data-copy="${encodeURIComponent(plainText)}">Copy</button>` : ""
    }</div>
    <div class="message-body">${content || '<span class="thinking">Thinking…</span>'}</div>
  </article>`
}

/**
 * Names the model that produced an assistant reply. Without this the model picker is the only
 * clue about which model answered, so a mid-session switch cannot be confirmed from the transcript.
 */
function messageModelBadge(message: MessageWithParts): string {
  if (message.info.role !== "assistant") return ""
  const providerID = typeof message.info.providerID === "string" ? message.info.providerID : undefined
  const modelID = typeof message.info.modelID === "string" ? message.info.modelID : undefined
  if (!providerID || !modelID) return ""
  const label = findModel(state.providers, providerID, modelID)?.name || modelID
  return `<span class="message-model" title="${escapeAttribute(`${providerID}/${modelID}`)}">${escapeHtml(label)}</span>`
}

function renderPart(part: MessagePart, role: string): string {
  switch (part.type) {
    case "text":
      return `<div class="markdown">${safeMarkdown(String(part.text ?? ""))}</div>`
    case "reasoning":
      return `<details class="reasoning"><summary>Reasoning</summary><div class="markdown">${safeMarkdown(String(part.text ?? ""))}</div></details>`
    case "file": {
      const mime = String(part.mime ?? "")
      const url = String(part.url ?? "")
      if (mime.startsWith("image/") && url.startsWith("data:")) {
        return `<img class="message-image" src="${escapeAttribute(url)}" alt="${escapeAttribute(String(part.filename ?? "image"))}">`
      }
      return `<span class="file-pill">${escapeHtml(String(part.filename ?? "Attached file"))}</span>`
    }
    case "tool":
      return renderTool(part)
    case "patch": {
      const files = Array.isArray(part.files) ? part.files : []
      return `<details class="tool"><summary><span class="tool-dot complete"></span>Changed ${files.length} file${files.length === 1 ? "" : "s"}</summary><div class="tool-content">${files.map((file) => `<div>${escapeHtml(String(file))}</div>`).join("")}</div></details>`
    }
    case "retry":
      return `<div class="retry">Retrying request (attempt ${escapeHtml(String(part.attempt ?? ""))})…</div>`
    default:
      return role === "user" ? "" : ""
  }
}

function renderTool(part: MessagePart): string {
  const stateValue = (part.state ?? {}) as Record<string, unknown>
  const status = String(stateValue.status ?? "pending")
  if (part.tool === "question") {
    const input = stateValue.input as { questions?: { question?: string }[] } | undefined
    const questions = Array.isArray(input?.questions) ? input.questions : []
    const output = String(stateValue.output ?? stateValue.error ?? "")
    return `<section class="question-transcript" aria-label="Question and answer">
      <strong>OpenCode asked</strong>
      ${questions.map((question) => `<p>${escapeHtml(String(question.question ?? ""))}</p>`).join("")}
      <strong>${status === "completed" ? "Your response" : status === "error" ? "Question ended" : "Waiting for your answer"}</strong>
      ${output ? `<div class="question-transcript-answer">${escapeHtml(output)}</div>` : ""}
    </section>`
  }
  const title = String(stateValue.title ?? part.tool ?? "Tool")
  const input = stateValue.input ? JSON.stringify(stateValue.input, null, 2) : ""
  const output = String(stateValue.output ?? stateValue.error ?? "")
  return `<details class="tool" ${status === "running" ? "open" : ""}>
    <summary><span class="tool-dot ${escapeAttribute(status)}"></span>${escapeHtml(title)}<span class="tool-status">${escapeHtml(status)}</span></summary>
    <div class="tool-content">
      ${input ? `<pre>${escapeHtml(input)}</pre>` : ""}
      ${output ? `<pre>${escapeHtml(output)}</pre>` : ""}
    </div>
  </details>`
}

function renderContext(): void {
  if (!state.context) {
    contextElement.classList.add("hidden")
    return
  }
  contextElement.classList.remove("hidden")
  contextElement.classList.toggle("disabled", !state.contextEnabled)
  contextElement.textContent = `${state.contextEnabled ? "✓" : "+"} ${state.context.label}`
  contextElement.title = state.contextEnabled ? "Click to exclude this context" : "Click to include this context"
}

function renderPermissions(): void {
  element("permissions").innerHTML = state.permissions
    .map(
      (permission) => `<div class="permission-card">
        <strong>Permission required · ${escapeHtml(permission.permission)}</strong>
        ${renderPermissionDetail(permission)}
        <div class="permission-actions">
          <button data-request="${escapeAttribute(permission.id)}" data-permission="reject">Deny</button>
          <button data-request="${escapeAttribute(permission.id)}" data-permission="always">Always allow</button>
          <button class="primary" data-request="${escapeAttribute(permission.id)}" data-permission="once">Allow once</button>
        </div>
      </div>`,
    )
    .join("")
}

/** Shows what the engine is actually asking to do, so the request can be judged without scrolling. */
function renderPermissionDetail(permission: PermissionRequest): string {
  const meta = permission.metadata ?? {}
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : "")
  const block = (value: string, className = "") => `<pre class="permission-detail ${className}">${escapeHtml(value)}</pre>`
  const patterns = permission.patterns.length
    ? `<p class="permission-patterns">${permission.patterns.map(escapeHtml).join(", ")}</p>`
    : ""
  const command = text(meta.command)
  if (command) return `${block(command)}${permission.permission === "bash" ? "" : patterns}`
  const diff = text(meta.diff)
  if (diff) return `<p class="permission-patterns">${escapeHtml(text(meta.filepath) || permission.patterns.join(", "))}</p>${block(diff, "diff")}`
  const url = text(meta.url)
  if (url) return block(url)
  if (permission.permission === "doom_loop") {
    const input = meta.input === undefined ? "" : JSON.stringify(meta.input, null, 2)
    return `<p class="permission-patterns">The agent repeated the same ${escapeHtml(text(meta.tool) || "tool")} call several times. Continue anyway?</p>${input ? block(input) : ""}`
  }
  return patterns
}

function persistQuestionDrafts(): void {
  vscode.setState({ ...vscode.getState(), questionDrafts })
}

function readQuestionDraft(form: HTMLFormElement, request: QuestionRequest): QuestionDraft {
  const draft: QuestionDraft = { selected: [], custom: [], customSelected: [] }
  request.questions.forEach((_, index) => {
    draft.selected[index] = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="q${index}"]:checked`))
      .filter((input) => input.dataset.customToggle === undefined).map((input) => input.value)
    draft.custom[index] = form.querySelector<HTMLInputElement>(`[data-custom-text="${index}"]`)?.value ?? ""
    draft.customSelected[index] = form.querySelector<HTMLInputElement>(`[data-custom-toggle="${index}"]`)?.checked ?? false
  })
  return draft
}

function renderQuestions(): void {
  const container = element("questions")
  // Keep existing forms intact: incoming events must not reset drafts or keyboard focus.
  for (const form of container.querySelectorAll<HTMLFormElement>("form[data-question]")) {
    if (!state.questions.some((request) => request.id === form.dataset.question)) form.remove()
  }
  for (const request of state.questions) {
    const requestID = request.id
    let form = Array.from(container.querySelectorAll<HTMLFormElement>("form[data-question]"))
      .find((item) => item.dataset.question === requestID)
    if (!form) {
      container.insertAdjacentHTML("beforeend", renderQuestionCard(request))
      form = container.lastElementChild as HTMLFormElement
      bindQuestionForm(form, request)
    }
    const submitting = questionSubmissions.has(requestID)
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
      .forEach((control) => { control.disabled = submitting || !connected })
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    submit.textContent = submitting ? "Sending..." : questionErrors.has(requestID) ? "Retry answer" : "Send answer"
    form.querySelector<HTMLElement>("[data-question-error]")!.textContent = questionErrors.get(requestID) ?? ""
    form.setAttribute("aria-busy", String(submitting))
  }
  renderBusy()
}

function bindQuestionForm(form: HTMLFormElement, request: QuestionRequest): void {
  const requestID = request.id
  const draft = questionDrafts[requestID]
  if (draft) {
    request.questions.forEach((_, index) => {
      form.querySelectorAll<HTMLInputElement>(`input[name="q${index}"]`).forEach((input) => {
        input.checked = input.dataset.customToggle !== undefined
          ? !!draft.customSelected[index] : (draft.selected[index] ?? []).includes(input.value)
      })
      const text = form.querySelector<HTMLInputElement>(`[data-custom-text="${index}"]`)
      if (text) {
        text.value = draft.custom[index] ?? ""
        text.classList.toggle("hidden", !draft.customSelected[index])
      }
    })
  }
  const remember = () => {
    questionDrafts[requestID] = readQuestionDraft(form, request)
    persistQuestionDrafts()
  }
  form.addEventListener("input", remember)
  form.addEventListener("change", (event) => {
    request.questions.forEach((_, index) => {
      const toggle = form.querySelector<HTMLInputElement>(`[data-custom-toggle="${index}"]`)
      const text = form.querySelector<HTMLInputElement>(`[data-custom-text="${index}"]`)
      if (toggle && text) {
        text.classList.toggle("hidden", !toggle.checked)
        if (event.target === toggle && toggle.checked) text.focus()
      }
    })
    form.querySelectorAll(".invalid").forEach((block) => block.classList.remove("invalid"))
    questionErrors.delete(requestID)
    remember()
    renderQuestions()
  })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    if (!connected || questionSubmissions.has(requestID)) return
    remember()
    const { answers, missing } = questionAnswers(request, questionDrafts[requestID]!)
    if (missing.length) {
      missing.forEach((index) => form.querySelector(`[data-block="${index}"]`)?.classList.add("invalid"))
      questionErrors.set(requestID, "Answer each question. Select an option or enter your own answer.")
      renderQuestions()
      form.querySelector<HTMLInputElement>(".invalid input")?.focus()
      return
    }
    questionSubmissions.add(requestID)
    questionErrors.delete(requestID)
    renderQuestions()
    vscode.postMessage({ type: "questionReply", requestID, answers })
  })
  form.querySelector<HTMLButtonElement>("[data-dismiss]")?.addEventListener("click", () => {
    if (!connected || questionSubmissions.has(requestID)) return
    remember()
    questionSubmissions.add(requestID)
    questionErrors.delete(requestID)
    renderQuestions()
    vscode.postMessage({ type: "questionReject", requestID })
  })
}

function renderQuestionCard(request: QuestionRequest): string {
  const blocks = request.questions
    .map((question, index) => {
      const type = question.multiple ? "checkbox" : "radio"
      const options = question.options
        .map(
          (option) => `<label class="question-option">
            <input type="${type}" name="q${index}" value="${escapeAttribute(option.label)}">
            <span class="question-option-label">${escapeHtml(option.label)}</span>
            ${option.description ? `<span class="question-option-desc">${escapeHtml(option.description)}</span>` : ""}
          </label>`,
        )
        .join("")
      const custom = question.custom !== false
        ? `<label class="question-option">
            <input type="${type}" name="q${index}" value="" data-custom-toggle="${index}">
            <span class="question-option-label">Other</span>
            <input type="text" class="question-custom hidden" data-custom-text="${index}" placeholder="Type your answer">
          </label>`
        : ""
      return `<div class="question-block" data-block="${index}">
        <div class="question-header">${escapeHtml(question.header)}</div>
        <div class="question-text">${escapeHtml(question.question)}</div>
        <div class="question-options">${options}${custom}</div>
      </div>`
    })
    .join("")
  return `<form class="question-card" data-question="${escapeAttribute(request.id)}">
    ${blocks}
    <p data-question-error class="question-error" role="alert"></p>
    <div class="permission-actions">
      <button type="button" data-dismiss title="Reject this question without sending an answer">Skip without answering</button>
      <button type="submit" class="primary">Answer</button>
    </div>
  </form>`
}

function renderNotices(): void {
  element("notices").innerHTML = state.error ? `<div class="error-notice">${escapeHtml(state.error)}</div>` : ""
}

function debugSnapshot(): unknown {
  return {
    phase: state.phase,
    busy: state.busy,
    error: state.error,
    activeSessionID: state.activeSessionID,
    selectedModel: parseModelValue(modelsElement.value),
    selectedVariant: variantsElement.hidden ? null : variantsElement.value,
    variantsAvailable: Object.keys(selectedModelInfo()?.variants ?? {}),
    selectedAgent: agentsElement.hidden ? null : agentsElement.value,
    permissionMode: state.permissionMode,
    tokens: summarizeTokens(state.messages) ?? null,
    messages: state.messages.map((message) => ({
      id: message.info.id,
      role: message.info.role,
      time: message.info.time,
      providerID: message.info.providerID,
      modelID: message.info.modelID,
      tokens: message.info.tokens,
      parts: message.parts.map((part) => ({ id: part.id, type: part.type, tokens: part.tokens })),
    })),
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`
  return String(value)
}

function renderTokens(): void {
  const tokensElement = element("tokens")
  const summary = summarizeTokens(state.messages)
  const selected = selectedModelRef()
  const window = resolveContextWindow({
    providers: state.providers,
    selected,
    turn: { providerID: summary?.providerID, modelID: summary?.modelID },
  })
  if (!summary) {
    // With no usage yet, still report the window so the model's capacity is visible up front.
    if (!window.limit) {
      tokensElement.hidden = true
      tokensElement.textContent = ""
      return
    }
    tokensElement.classList.remove("warn")
    tokensElement.textContent = `Context 0 / ${formatContextWindow(window.limit)}`
    tokensElement.title = describeWindow(window)
    tokensElement.hidden = false
    return
  }
  const { context, sessionTotal, pending } = summary
  const approx = pending > 0 ? "~" : ""
  const limit = window.limit
  let text = `Context ${approx}${formatTokens(context)}`
  let title = `Current context: ${context.toLocaleString()} tokens${pending > 0 ? ` (includes ~${pending.toLocaleString()} estimated for the streaming reply)` : ""}
Session total: ${sessionTotal.toLocaleString()} tokens`
  if (limit) {
    const remaining = Math.max(limit - context, 0)
    const percent = Math.min(Math.round((context / limit) * 100), 100)
    text = `Context ${approx}${formatTokens(context)} / ${formatContextWindow(limit)} (${percent}%) · ${formatTokens(remaining)} left`
    title += `
${describeWindow(window)}
Remaining: ${remaining.toLocaleString()} tokens`
    tokensElement.classList.toggle("warn", percent >= 80)
  } else {
    title += `
Context window: not reported for ${window.modelName ?? "the selected model"}`
    tokensElement.classList.remove("warn")
  }
  tokensElement.textContent = text
  tokensElement.title = title
  tokensElement.hidden = false
}

/** Spells out whose context window is on screen, so a shared number is never ambiguous. */
function describeWindow(window: ResolvedContextWindow): string {
  if (!window.limit) return `Context window: not reported for ${window.modelName ?? "the selected model"}`
  const name = window.modelName ?? "current model"
  const variant = window.variant ? ` (${window.variant} variant)` : ""
  const origin = window.fromPreviousTurn ? " — the model that produced the last reply" : ""
  return `Context window: ${window.limit.toLocaleString()} tokens · ${name}${variant}${origin}`
}

function renderBusy(message?: string): void {
  const waiting = state.questions.length > 0
  element("send").classList.toggle("hidden", state.busy || waiting)
  element("stop").classList.toggle("hidden", !state.busy && !waiting)
  element("status").textContent = !connected ? "Reconnecting... Your answers are saved."
    : waiting ? `Waiting for your answer (${state.questions.length})` : message ?? (state.busy ? "Working…" : "")
  promptElement.placeholder = waiting ? "Answer the question above to continue" : "Ask OpenCode (@ file, / command)"
  element<HTMLButtonElement>("send").disabled = !connected
  promptElement.disabled = state.phase === "starting"
}

function resizePrompt(): void {
  promptElement.style.height = "auto"
  promptElement.style.height = `${Math.min(promptElement.scrollHeight, 180)}px`
}

function safeMarkdown(text: string): string {
  const rendered = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;")
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

vscode.postMessage({ type: "ready" })
