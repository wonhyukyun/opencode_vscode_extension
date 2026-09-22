import DOMPurify from "dompurify"
import { marked } from "marked"
import { applyOpenCodeEvent, type EventState } from "../src/eventReducer"
import type {
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

const vscode = acquireVsCodeApi<{ selectedModel?: string; selectedVariant?: string }>()

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
  busy: false,
  phase: "starting",
}

const app = document.getElementById("app")!
app.innerHTML = `
  <header class="topbar">
    <select id="sessions" class="session-select" aria-label="Chat session"></select>
    <button id="new-chat" class="icon-button" title="New chat" aria-label="New chat">＋</button>
    <button id="delete-chat" class="icon-button" title="Delete chat" aria-label="Delete chat">⌫</button>
  </header>
  <section id="notices" class="notices"></section>
  <section id="questions" class="questions"></section>
  <section id="messages" class="messages" tabindex="0">
    <div class="loading"><span class="spinner"></span> Starting OpenCode…</div>
  </section>
  <section id="permissions" class="permissions"></section>
  <footer class="composer-wrap">
    <button id="context" class="context-chip hidden" type="button"></button>
    <div id="attachments" class="attachments"></div>
    <div id="suggestions" class="suggest hidden" role="listbox"></div>
    <div class="composer">
      <textarea id="prompt" rows="1" placeholder="Ask OpenCode… (@ file, / command)" aria-label="Message OpenCode"></textarea>
      <button id="send" class="send-button" title="Send (Enter)" aria-label="Send">↑</button>
      <button id="stop" class="stop-button hidden" title="Stop" aria-label="Stop">■</button>
    </div>
    <div class="composer-footer">
      <select id="models" class="model-select" aria-label="AI model"></select>
      <select id="variants" class="variant-select" aria-label="Thinking effort" hidden></select>
      <button id="attach-image" class="link-button hidden" type="button" title="Attach image">Image</button>
      <input id="image-input" type="file" accept="image/*" multiple hidden>
      <button id="connect" class="link-button">Connect provider</button>
      <span id="status" class="status"></span>
    </div>
  </footer>`

const messagesElement = element("messages")
const sessionsElement = element<HTMLSelectElement>("sessions")
const modelsElement = element<HTMLSelectElement>("models")
const variantsElement = element<HTMLSelectElement>("variants")
const promptElement = element<HTMLTextAreaElement>("prompt")
const attachImageElement = element<HTMLButtonElement>("attach-image")
const imageInputElement = element<HTMLInputElement>("image-input")
const attachmentsElement = element("attachments")
const suggestionsElement = element("suggestions")
const contextElement = element<HTMLButtonElement>("context")

marked.setOptions({ gfm: true, breaks: true })

element("new-chat").addEventListener("click", () => vscode.postMessage({ type: "newSession" }))
element("delete-chat").addEventListener("click", () => {
  if (state.activeSessionID && confirm("Delete this OpenCode chat?")) {
    vscode.postMessage({ type: "deleteSession", sessionID: state.activeSessionID })
  }
})
element("connect").addEventListener("click", () => vscode.postMessage({ type: "connectProvider" }))
element("send").addEventListener("click", send)
element("stop").addEventListener("click", () => vscode.postMessage({ type: "abort" }))
contextElement.addEventListener("click", () => {
  state.contextEnabled = !state.contextEnabled
  renderContext()
})
sessionsElement.addEventListener("change", () => {
  if (sessionsElement.value) vscode.postMessage({ type: "selectSession", sessionID: sessionsElement.value })
})
modelsElement.addEventListener("change", () => {
  vscode.setState({ ...vscode.getState(), selectedModel: modelsElement.value })
  renderVariants()
})
variantsElement.addEventListener("change", () => {
  vscode.setState({ ...vscode.getState(), selectedVariant: variantsElement.value })
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
      state.activeSessionID = data.activeSessionID
      state.messages = data.messages
      state.providers = data.providers
      state.permissions = data.permissions
      state.context = data.context
      renderAll()
      break
    case "sessionSelected":
      state.questions = []
      renderQuestions()
      follow.enabled = true
      state.activeSessionID = data.sessionID
      state.messages = data.messages ?? []
      state.busy = false
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
      renderQuestions()
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

function send(): void {
  const text = promptElement.value.trim()
  if ((!text && !state.images.length) || state.busy) return
  closeSuggestions()
  const [providerID, modelID] = modelsElement.value.split("\u0000")
  const variant = variantsElement.hidden ? "" : variantsElement.value
  const model = providerID && modelID ? { providerID, modelID, variant: variant || undefined } : undefined
  const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
  if (slash) {
    vscode.postMessage({ type: "command", command: slash[1] ?? "", arguments: (slash[2] ?? "").trim(), model })
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
  sessionsElement.innerHTML = state.sessions.length
    ? state.sessions
        .map((session) => `<option value="${escapeAttribute(session.id)}">${escapeHtml(session.title || "New chat")}</option>`)
        .join("")
    : '<option value="">New chat</option>'
  sessionsElement.value = state.activeSessionID ?? ""
  element<HTMLButtonElement>("delete-chat").disabled = !state.activeSessionID
}

function renderModels(): void {
  const previous = modelsElement.value || vscode.getState()?.selectedModel
  const providers = state.providers?.providers ?? []
  const options: string[] = []
  for (const provider of providers) {
    const models = Object.values(provider.models).filter((model) => model.capabilities?.toolcall !== false)
    for (const model of models) {
      options.push(modelOption(provider.name, model))
    }
  }
  modelsElement.innerHTML = options.length ? options.join("") : '<option value="">No connected model</option>'
  if (previous && Array.from(modelsElement.options).some((option) => option.value === previous)) {
    modelsElement.value = previous
  } else {
    selectDefaultModel()
  }
  modelsElement.disabled = options.length === 0
  renderVariants()
}

function selectedModelInfo(): ModelInfo | undefined {
  const [providerID, modelID] = modelsElement.value.split(" ")
  const provider = (state.providers?.providers ?? []).find((item) => item.id === providerID)
  return modelID ? provider?.models[modelID] : undefined
}

function renderVariants(): void {
  renderAttachmentControls()
  const variants = Object.keys(selectedModelInfo()?.variants ?? {})
  if (!variants.length) {
    variantsElement.hidden = true
    variantsElement.innerHTML = ""
    return
  }
  const previous = variantsElement.value || vscode.getState()?.selectedVariant || ""
  variantsElement.innerHTML = ['<option value="">Default effort</option>']
    .concat(variants.map((name) => `<option value="${escapeAttribute(name)}">${escapeHtml(name)}</option>`))
    .join("")
  variantsElement.value = variants.includes(previous) ? previous : ""
  variantsElement.hidden = false
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
  const value = `${model.providerID}\u0000${model.id}`
  return `<option value="${escapeAttribute(value)}">${escapeHtml(providerName)} · ${escapeHtml(model.name)}</option>`
}

function selectDefaultModel(): void {
  const defaults = state.providers?.default ?? {}
  for (const [providerID, modelID] of Object.entries(defaults)) {
    const value = `${providerID}\u0000${modelID}`
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
}

function renderMessage(message: MessageWithParts): string {
  const role = message.info.role
  const content = message.parts.map((part) => renderPart(part, role)).join("")
  const plainText = message.parts
    .filter((part) => part.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n")
  return `<article class="message ${role}">
    <div class="message-header"><span>${role === "user" ? "You" : "OpenCode"}</span>${
      plainText ? `<button class="copy-button" data-copy="${encodeURIComponent(plainText)}">Copy</button>` : ""
    }</div>
    <div class="message-body">${content || '<span class="thinking">Thinking…</span>'}</div>
  </article>`
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
        <strong>Permission required</strong>
        <p>${escapeHtml(permission.permission)} ${permission.patterns.map(escapeHtml).join(", ")}</p>
        <div class="permission-actions">
          <button data-request="${escapeAttribute(permission.id)}" data-permission="reject">Deny</button>
          <button data-request="${escapeAttribute(permission.id)}" data-permission="always">Always allow</button>
          <button class="primary" data-request="${escapeAttribute(permission.id)}" data-permission="once">Allow once</button>
        </div>
      </div>`,
    )
    .join("")
}

function renderQuestions(): void {
  const container = element("questions")
  container.innerHTML = state.questions.map(renderQuestionCard).join("")
  container.querySelectorAll<HTMLFormElement>("form[data-question]").forEach((form) => {
    const requestID = form.dataset.question ?? ""
    form.querySelectorAll<HTMLInputElement>("input[data-custom-toggle]").forEach((toggle) => {
      toggle.addEventListener("change", () => {
        const text = form.querySelector<HTMLInputElement>(`input[data-custom-text="${toggle.dataset.customToggle}"]`)
        if (text) {
          text.classList.toggle("hidden", !toggle.checked)
          if (toggle.checked) text.focus()
        }
      })
    })
    form.querySelectorAll<HTMLInputElement>("input[data-custom-text]").forEach((text) => {
      text.addEventListener("input", () => {
        const toggle = form.querySelector<HTMLInputElement>(`input[data-custom-toggle="${text.dataset.customText}"]`)
        if (toggle && text.value) toggle.checked = true
      })
    })
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      const request = state.questions.find((item) => item.id === requestID)
      if (!request) return
      const answers: string[][] = []
      for (let index = 0; index < request.questions.length; index++) {
        const picked = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="q${index}"]:checked`))
        const values: string[] = []
        for (const input of picked) {
          if (input.dataset.customToggle !== undefined) {
            const text = form.querySelector<HTMLInputElement>(`input[data-custom-text="${input.dataset.customToggle}"]`)
            const custom = text?.value.trim()
            if (custom) values.push(custom)
          } else {
            values.push(input.value)
          }
        }
        if (!values.length) {
          form.querySelector<HTMLElement>(`[data-block="${index}"]`)?.classList.add("invalid")
          return
        }
        answers.push(values)
      }
      form.querySelectorAll("button").forEach((button) => (button.disabled = true))
      vscode.postMessage({ type: "questionReply", requestID, answers })
    })
    form.querySelector<HTMLButtonElement>("[data-dismiss]")?.addEventListener("click", () => {
      form.querySelectorAll("button").forEach((button) => (button.disabled = true))
      vscode.postMessage({ type: "questionReject", requestID })
    })
  })
}

function renderQuestionCard(request: QuestionRequest): string {
  const blocks = request.questions
    .map((question, index) => {
      const type = question.multiple ? "checkbox" : "radio"
      const options = question.options
        .map(
          (option, optionIndex) => `<label class="question-option">
            <input type="${type}" name="q${index}" value="${escapeAttribute(option.label)}"${optionIndex === 0 && !question.multiple ? " checked" : ""}>
            <span class="question-option-label">${escapeHtml(option.label)}</span>
            ${option.description ? `<span class="question-option-desc">${escapeHtml(option.description)}</span>` : ""}
          </label>`,
        )
        .join("")
      const custom = question.custom
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
    <div class="permission-actions">
      <button type="button" data-dismiss>Dismiss</button>
      <button type="submit" class="primary">Answer</button>
    </div>
  </form>`
}

function renderNotices(): void {
  element("notices").innerHTML = state.error ? `<div class="error-notice">${escapeHtml(state.error)}</div>` : ""
}

function renderBusy(message?: string): void {
  element("send").classList.toggle("hidden", state.busy)
  element("stop").classList.toggle("hidden", !state.busy)
  element("status").textContent = message ?? (state.busy ? "Working…" : "")
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
