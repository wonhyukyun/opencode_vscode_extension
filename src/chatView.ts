import * as path from "node:path"
import * as vscode from "vscode"
import { OpenCodeClient } from "./client"
import { OpenCodeServer } from "./server"
import { QuestionResponder } from "./questionResponder"
import { SessionLineage } from "./sessionLineage"
import { deleteHistory, type HistoryDeleteResult } from "./deleteHistory"
import { groupSessionsByRepository } from "./historyGroups"
import { PERMISSION_MODE_RULES } from "./types"
import type {
  AgentInfo,
  AgentModelPreference,
  PermissionMode,
  CommandInfo,
  ImageAttachment,
  EditorContext,
  GlobalSessionInfo,
  HistoryGroup,
  McpStatus,
  SkillInfo,
  OpenCodeEvent,
  PermissionRequest,
  PromptPart,
  QuestionRequest,
  SelectedModel,
  SessionInfo,
} from "./types"

type WebviewMessage =
  | { type: "ready" }
  | { type: "newSession" }
  | { type: "showHistory" }
  | { type: "agentModel"; agent: string; preference: AgentModelPreference }
  | { type: "selectSession"; sessionID: string }
  | { type: "deleteSession"; sessionID: string }
  | { type: "send"; text: string; attachContext: boolean; model?: SelectedModel; images?: ImageAttachment[]; files?: string[] }
  | { type: "command"; command: string; arguments: string; model?: SelectedModel }
  | { type: "findFiles"; query: string; requestID: number }
  | { type: "questionReply"; requestID: string; answers: string[][] }
  | { type: "questionReject"; requestID: string }
  | { type: "permissionMode"; mode: PermissionMode }
  | { type: "abort" }
  | { type: "permissionReply"; requestID: string; reply: "once" | "always" | "reject" }
  | { type: "openLink"; href: string }
  | { type: "debug"; snapshot?: unknown }

/** Reads the workspace default-model setting in provider/model form. */
function configuredDefaultModel(): string {
  return vscode.workspace.getConfiguration("opencodeIntegrated").get<string>("defaultModel", "").trim()
}

const EVENT_LOG_LIMIT = 500
const EVENT_LOG_STRING_LIMIT = 300
const EVENT_LOG_ENTRY_LIMIT = 4000

/**
 * Serializes an event for the debug log with long strings cut short. Part updates repeat the whole
 * part (streamed text, tool output, image data URLs), so keeping raw events exhausts the heap.
 */
function summarizeEvent(event: OpenCodeEvent): string {
  const json = JSON.stringify(event, (_key, value: unknown) =>
    typeof value === "string" && value.length > EVENT_LOG_STRING_LIMIT
      ? `${value.slice(0, EVENT_LOG_STRING_LIMIT)}…(${value.length} chars)`
      : value,
  )
  return json.length > EVENT_LOG_ENTRY_LIMIT ? `${json.slice(0, EVENT_LOG_ENTRY_LIMIT)}…(truncated)` : json
}

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "opencodeIntegrated.rightChat"
  private readonly sessionsChanged = new vscode.EventEmitter<void>()
  readonly onDidChangeSessions = this.sessionsChanged.event

  private view: vscode.WebviewView | undefined
  private lastEditor: vscode.TextEditor | undefined
  private client: OpenCodeClient | undefined
  private clientInitialization: Promise<OpenCodeClient> | undefined
  private selectionGeneration = 0
  private activeSessionID: string | undefined
  private eventController: AbortController | undefined
  private initialization: Promise<void> | undefined
  private permissionMode: PermissionMode = "manual"
  private readonly appliedPermissionMode = new Map<string, PermissionMode>()
  private refreshTimer: NodeJS.Timeout | undefined
  private forceContext = false
  private sessionLimit = 50
  private historyOpen = false
  private readonly questionResponder = new QuestionResponder(() => this.ensureClient(), (message) => this.post(message))
  private readonly eventLog: { at: number; event: string }[] = []
  private readonly lineage = new SessionLineage(async (id) => (await this.ensureClient()).getSession(id))
  private readonly autoApproving = new Set<string>()

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: OpenCodeServer,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.configureWebview(view.webview)
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
  }

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    }
    webview.onDidReceiveMessage((message: WebviewMessage) => void this.handleMessage(message), undefined, this.context.subscriptions)
    webview.html = this.html(webview)
  }

  async reveal(): Promise<void> {
    this.rememberEditor()
    await vscode.commands.executeCommand("workbench.view.extension.opencodeIntegrated")
    await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`)
    this.view?.show(false)
  }

  async revealSidebar(): Promise<void> {
    await this.reveal()
  }

  async newChat(): Promise<void> {
    await this.reveal()
    await this.initialize()
    const client = await this.ensureClient()
    const session = await client.createSession()
    await this.selectSession(session.id)
    await this.refreshSessions()
  }

  async attachSelection(): Promise<void> {
    this.forceContext = true
    await this.reveal()
    this.post({ type: "context", context: this.editorContext(), enabled: true })
  }

  async showHistory(): Promise<void> {
    await vscode.commands.executeCommand("opencodeIntegrated.history.focus")
  }

  async getHistory(): Promise<{ sessions: SessionInfo[]; activeSessionID?: string; hasMore: boolean }> {
    const sessions = await (await this.ensureClient()).listSessions(this.sessionLimit)
    sessions.sort((a, b) => b.time.updated - a.time.updated)
    return { sessions, activeSessionID: this.activeSessionID ?? this.context.workspaceState.get<string>("activeSessionID"), hasMore: sessions.length >= this.sessionLimit }
  }

  /**
   * Returns chat history bucketed by repository, with the workspace repository first. Falls back
   * to the current project's sessions when the engine has no cross-project listing.
   */
  async getGroupedHistory(): Promise<{ groups: HistoryGroup[]; activeSessionID?: string; hasMore: boolean }> {
    const client = await this.ensureClient()
    const directory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    let sessions: GlobalSessionInfo[]
    try {
      sessions = await client.listGlobalSessions(this.sessionLimit)
    } catch {
      sessions = await client.listSessions(this.sessionLimit)
    }
    const activeSessionID = this.activeSessionID ?? this.context.workspaceState.get<string>("activeSessionID")
    return { groups: groupSessionsByRepository(sessions, directory), activeSessionID, hasMore: sessions.length >= this.sessionLimit }
  }

  /** Tells the webview the default-model setting changed so it can apply it. */
  notifyDefaultModel(): void {
    this.post({ type: "defaultModel", defaultModel: configuredDefaultModel() })
  }

  /** Skills the engine loaded for this workspace. */
  async getSkills(): Promise<SkillInfo[]> {
    return (await this.ensureClient()).listSkills()
  }

  /** Configured MCP servers and their connection status, keyed by name. */
  async getMcpServers(): Promise<Record<string, McpStatus>> {
    return (await this.ensureClient()).mcpStatus()
  }

  loadOlderHistory(): void {
    this.sessionLimit += 50
    this.sessionsChanged.fire()
  }

  async openSession(sessionID: string): Promise<void> {
    await this.reveal()
    await this.initialize()
    await this.selectSession(sessionID)
    await this.refreshSessions()
  }

  async searchHistory(): Promise<void> {
    if (this.historyOpen) return
    this.historyOpen = true
    try {
      const client = await this.ensureClient()
      while (true) {
        const sessions = await client.listSessions(this.sessionLimit)
        sessions.sort((a, b) => b.time.updated - a.time.updated)
        if (!sessions.length) {
          await vscode.window.showInformationMessage("OpenCode: No chat history for this project yet.")
          return
        }
        const items: (vscode.QuickPickItem & { sessionID?: string })[] = sessions.map((session) => ({
          label: session.title || "New chat",
          description: session.id === this.activeSessionID ? "Current chat" : undefined,
          detail: `${new Date(session.time.updated).toLocaleString()} · ${session.directory}`,
          sessionID: session.id,
        }))
        if (sessions.length >= this.sessionLimit) {
          items.push({ label: "$(history) Load older chats…", detail: `Showing ${sessions.length} chats` })
        }
        const selected = await vscode.window.showQuickPick(items, {
          title: "OpenCode Chat History",
          placeHolder: "Search loaded chats by title, date or folder",
          matchOnDetail: true,
        })
        if (!selected) return
        if (!selected.sessionID) {
          this.sessionLimit += 50
          continue
        }
        await this.openSession(selected.sessionID)
        return
      }
    } catch (error) {
      this.reportError(error)
    } finally {
      this.historyOpen = false
    }
  }

  notifyEditorContext(): void {
    this.rememberEditor()
    this.post({ type: "context", context: this.editorContext(), enabled: this.forceContext })
  }

  private rememberEditor(): void {
    if (vscode.window.activeTextEditor) this.lastEditor = vscode.window.activeTextEditor
  }

  dispose(): void {
    this.sessionsChanged.dispose()
    this.eventController?.abort()
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          await this.initialize()
          return
        case "newSession":
          await this.newChat()
          return
        case "showHistory":
          await this.showHistory()
          return
        case "agentModel": {
          const preferences = { ...this.context.workspaceState.get<Record<string, AgentModelPreference>>("agentModels", {}) }
          preferences[message.agent] = message.preference
          await this.context.workspaceState.update("agentModels", preferences)
          this.post({ type: "agentModels", preferences })
          return
        }
        case "selectSession":
          await this.selectSession(message.sessionID)
          return
        case "deleteSession":
          await this.deleteSession(message.sessionID)
          return
        case "send":
          await this.send(message.text, message.attachContext, message.model, message.images ?? [], message.files ?? [])
          return
        case "command":
          await this.runCommand(message.command, message.arguments, message.model)
          return
        case "questionReply":
          await this.replyQuestion(message.requestID, message.answers)
          return
        case "permissionMode":
          await this.setPermissionMode(message.mode)
          return
        case "questionReject":
          await this.replyQuestion(message.requestID)
          return
        case "findFiles": {
          let files: string[] = []
          try {
            files = await (await this.ensureClient()).findFiles(message.query, 25)
          } catch {}
          this.post({ type: "fileResults", requestID: message.requestID, files })
          return
        }
        case "abort":
          if (this.activeSessionID) await (await this.ensureClient()).abort(this.activeSessionID)
          return
        case "permissionReply":
          await (await this.ensureClient()).replyPermission(message.requestID, message.reply)
          this.post({ type: "permissionResolved", requestID: message.requestID })
          return
        case "openLink":
          if (/^https?:\/\//i.test(message.href)) await vscode.env.openExternal(vscode.Uri.parse(message.href))
          return
        case "debug":
          this.dumpDebug(message.snapshot)
          return
      }
    } catch (error) {
      this.reportError(error)
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    this.initialization = this.initializeOnce().finally(() => {
      this.initialization = undefined
    })
    return this.initialization
  }

  private async initializeOnce(): Promise<void> {
    this.post({ type: "status", status: "starting", message: "Starting bundled OpenCode engine…" })
    const client = await this.ensureClient()
    const [sessions, providers, permissions, questions, commands, agents, statuses] = await Promise.all([
      client.listSessions(this.sessionLimit),
      client.providers(),
      client.permissions(),
      client.questions(),
      client.commands().catch((): CommandInfo[] => []),
      client.agents().catch((): AgentInfo[] => []),
      client.sessionStatuses(),
    ])
    const remembered = this.activeSessionID ?? this.context.workspaceState.get<string>("activeSessionID")
    this.permissionMode = this.context.workspaceState.get<PermissionMode>("permissionMode") ?? "manual"
    const session = sessions.find((item) => item.id === remembered) ?? sessions[0]
    this.activeSessionID = session?.id
    this.sessionsChanged.fire()
    const messages = session ? await client.getMessages(session.id) : []
    this.post({
      type: "initialize",
      sessions,
      activeSessionID: this.activeSessionID,
      messages,
      providers,
      permissions: await this.pendingPermissions(permissions, this.activeSessionID),
      questions: questions.filter((item) => item.sessionID === this.activeSessionID),
      busy: !!this.activeSessionID && ["busy", "retry"].includes(statuses[this.activeSessionID]?.type ?? ""),
      context: this.editorContext(),
      commands,
      agents,
      agentModels: this.context.workspaceState.get<Record<string, AgentModelPreference>>("agentModels", {}),
      permissionMode: this.permissionMode,
      defaultModel: configuredDefaultModel(),
    })
    this.post({ type: "context", context: this.editorContext(), enabled: this.forceContext })
    if (this.activeSessionID) await this.applyPermissionMode(this.activeSessionID)
  }

  private async ensureClient(): Promise<OpenCodeClient> {
    if (this.client) return this.client
    if (!this.clientInitialization) {
      this.clientInitialization = this.createClient().finally(() => { this.clientInitialization = undefined })
    }
    return this.clientInitialization
  }

  private async createClient(): Promise<OpenCodeClient> {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) throw new Error("Open a folder or workspace before starting OpenCode.")
    const baseUrl = await this.server.start()
    this.client = new OpenCodeClient(baseUrl, folder.uri.fsPath, this.server.authorization)
    this.eventController = new AbortController()
    void this.client.subscribe((event) => this.onEvent(event), this.eventController.signal, () => this.syncPending())
    return this.client
  }

  private async selectSession(sessionID: string): Promise<void> {
    const generation = ++this.selectionGeneration
    const client = await this.ensureClient()
    const [messages, permissions, questions, statuses] = await Promise.all([
      client.getMessages(sessionID), client.permissions(), client.questions(), client.sessionStatuses(),
    ])
    const pending = await this.pendingPermissions(permissions, sessionID)
    if (generation !== this.selectionGeneration) return
    this.activeSessionID = sessionID
    await this.context.workspaceState.update("activeSessionID", sessionID)
    this.post({
      type: "sessionSelected", sessionID, messages,
      permissions: pending,
      questions: questions.filter((item) => item.sessionID === sessionID),
      busy: ["busy", "retry"].includes(statuses[sessionID]?.type ?? ""),
    })
    await this.applyPermissionMode(sessionID)
    this.sessionsChanged.fire()
  }

  private async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode
    await this.context.workspaceState.update("permissionMode", mode)
    if (this.activeSessionID) await this.applyPermissionMode(this.activeSessionID)
    if (mode === "auto" && this.activeSessionID && this.client) {
      await this.pendingPermissions(await this.client.permissions(), this.activeSessionID)
    }
  }

  /**
   * Keeps the requests raised by `sessionID` or its subagent sessions. In auto mode they are
   * approved on the spot instead, because some requests bypass the session rules entirely.
   */
  private async pendingPermissions(permissions: PermissionRequest[], sessionID: string | undefined): Promise<PermissionRequest[]> {
    const pending: PermissionRequest[] = []
    for (const request of permissions) {
      if (!(await this.lineage.belongsTo(request.sessionID, sessionID))) continue
      if (this.permissionMode === "auto") void this.autoApprove(request)
      else pending.push(request)
    }
    return pending
  }

  private async handlePermission(request: PermissionRequest): Promise<void> {
    const active = this.activeSessionID
    if (!(await this.lineage.belongsTo(request.sessionID, active)) || active !== this.activeSessionID) return
    if (this.permissionMode === "auto") await this.autoApprove(request)
    else this.post({ type: "permission", permission: request })
  }

  private async autoApprove(request: PermissionRequest): Promise<void> {
    if (this.autoApproving.has(request.id)) return
    this.autoApproving.add(request.id)
    try {
      await (await this.ensureClient()).replyPermission(request.id, "once")
      this.post({ type: "permissionResolved", requestID: request.id })
    } catch (error) {
      // Fall back to asking so the run doesn't stall on a request nobody can see.
      this.server.log(`Auto-approve failed for ${request.permission} (${request.id}): ${error instanceof Error ? error.message : String(error)}`)
      this.post({ type: "permission", permission: request })
    } finally {
      this.autoApproving.delete(request.id)
    }
  }

  private async applyPermissionMode(sessionID: string): Promise<void> {
    if (this.appliedPermissionMode.get(sessionID) === this.permissionMode) return
    try {
      const client = await this.ensureClient()
      await client.updateSessionPermission(sessionID, PERMISSION_MODE_RULES[this.permissionMode])
      this.appliedPermissionMode.set(sessionID, this.permissionMode)
    } catch (error) {
      this.reportError(error)
    }
  }

  private async deleteSession(sessionID: string): Promise<void> {
    const client = await this.ensureClient()
    await client.deleteSession(sessionID)
    if (this.activeSessionID === sessionID) {
      this.activeSessionID = undefined
      await this.context.workspaceState.update("activeSessionID", undefined)
    }
    await this.refreshSessions(true)
  }

  async deleteHistorySessions(ids: readonly string[]): Promise<HistoryDeleteResult> {
    const client = await this.ensureClient()
    const result = await deleteHistory(ids, (id) => client.deleteSession(id))
    if (this.activeSessionID && result.deleted.includes(this.activeSessionID)) {
      ++this.selectionGeneration
      this.activeSessionID = undefined
      await this.context.workspaceState.update("activeSessionID", undefined)
      this.post({ type: "sessionSelected", messages: [] })
    }
    for (const id of result.deleted) {
      this.appliedPermissionMode.delete(id)
      this.lineage.forget(id)
    }
    try {
      await this.refreshSessions(true)
    } catch (error) {
      this.reportError(error)
    } finally {
      this.sessionsChanged.fire()
    }
    return result
  }

  private async ensureSession(): Promise<string> {
    const client = await this.ensureClient()
    if (!this.activeSessionID) {
      const session = await client.createSession()
      this.activeSessionID = session.id
      await this.context.workspaceState.update("activeSessionID", session.id)
      await this.refreshSessions()
      this.post({ type: "sessionSelected", sessionID: session.id, messages: [] })
      await this.applyPermissionMode(session.id)
    }
    return this.activeSessionID!
  }

  private async runCommand(command: string, args: string, model?: SelectedModel): Promise<void> {
    const name = command.replace(/^\//, "").trim()
    if (!name) return
    switch (name) {
      case "new":
      case "clear":
        await this.newChat()
        return
      case "help":
        this.post({ type: "status", status: "idle", message: "Type / for commands, @ to attach files" })
        return
    }
    const client = await this.ensureClient()
    // The engine answers an unknown command with HTTP 500, which reads as a server fault rather
    // than a typo, so check the registered commands first and say what actually went wrong.
    const known = await client.commands().catch(() => undefined)
    if (known && !known.some((command) => command.name.toLowerCase() === name.toLowerCase())) {
      this.post({
        type: "error",
        message: `Unknown command /${name}. Type / in the message box to see the commands this workspace has.`,
      })
      this.post({ type: "status", status: "idle" })
      return
    }
    const sessionID = await this.ensureSession()
    this.post({ type: "status", status: "busy" })
    await client.sendCommand(sessionID, name, args, model)
  }

  private mentionPart(relative: string): PromptPart {
    const folder = vscode.workspace.workspaceFolders?.[0]
    const uri = folder ? vscode.Uri.joinPath(folder.uri, relative) : vscode.Uri.file(relative)
    return { type: "file", mime: "text/plain", filename: relative, url: uri.toString(true) }
  }

  private async send(
    text: string,
    attachContext: boolean,
    model?: SelectedModel,
    images: ImageAttachment[] = [],
    files: string[] = [],
  ): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed && !images.length && !files.length) return
    const client = await this.ensureClient()
    await this.ensureSession()
    const parts: PromptPart[] = trimmed ? [{ type: "text", text: trimmed }] : []
    for (const file of new Set(files)) parts.push(this.mentionPart(file))
    for (const image of images) {
      if (!image.mime.startsWith("image/") || !image.url.startsWith("data:")) continue
      parts.push({ type: "file", mime: image.mime, filename: image.filename, url: image.url })
    }
    if (attachContext) {
      const file = this.editorContext()
      if (file) parts.unshift(this.contextPart(file))
    }
    this.forceContext = false
    this.post({ type: "status", status: "busy" })
    await client.sendPrompt(this.activeSessionID!, parts, model)
  }

  private contextPart(context: EditorContext): PromptPart {
    if (context.selectedText !== undefined) {
      return {
        type: "file",
        mime: "text/plain",
        filename: context.label,
        url: `data:text/plain;base64,${Buffer.from(context.selectedText, "utf8").toString("base64")}`,
        source: {
          type: "file",
          path: context.path,
          text: { value: context.selectedText, start: 0, end: context.selectedText.length },
        },
      }
    }
    return { type: "file", mime: "text/plain", filename: context.label, url: context.uri }
  }

  private editorContext(): EditorContext | undefined {
    const editor = vscode.window.activeTextEditor ?? this.lastEditor
    if (editor?.document.isClosed) return undefined
    if (!editor || editor.document.uri.scheme !== "file") return undefined
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri)
    if (!folder) return undefined
    const relative = vscode.workspace.asRelativePath(editor.document.uri, false)
    const selection = editor.selection
    if (!selection.isEmpty) {
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1
      return {
        label: `${relative}#L${startLine}${endLine === startLine ? "" : `-${endLine}`}`,
        path: relative,
        startLine,
        endLine,
        selectedText: editor.document.getText(selection),
        uri: editor.document.uri.toString(true),
      }
    }
    return { label: relative, path: relative, uri: editor.document.uri.toString(true) }
  }

  /** Write recent SSE events and the webview state snapshot to the output channel. */
  dumpDebug(snapshot?: unknown): void {
    const lines = [
      "",
      `===== OpenCode Integrated debug dump ${new Date().toISOString()} =====`,
      `activeSessionID: ${this.activeSessionID ?? "(none)"}`,
      `permissionMode: ${this.permissionMode}`,
      `workspace: ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "(none)"}`,
      `engine: ${this.server.isRunning ? this.server.baseUrl : "(not running)"}`,
      `--- webview state ---`,
      snapshot === undefined ? "(no snapshot)" : JSON.stringify(snapshot, null, 2),
      `--- last ${this.eventLog.length} SSE events (oldest first) ---`,
      ...this.eventLog.map(({ at, event }) => `${new Date(at).toISOString()} ${event}`),
      "===== end of debug dump =====",
    ]
    this.server.log(lines.join("\n"))
    this.server.showLogs()
  }

  private onEvent(event: OpenCodeEvent): void {
    if (event.type === "client.connected" || event.type === "client.disconnected") {
      this.post({ type: "connection", connected: event.type === "client.connected" })
      return
    }
    this.eventLog.push({ at: Date.now(), event: summarizeEvent(event) })
    if (this.eventLog.length > EVENT_LOG_LIMIT) this.eventLog.splice(0, this.eventLog.length - EVENT_LOG_LIMIT)
    const sessionID = event.properties.sessionID ?? event.properties.part?.sessionID ?? event.properties.info?.sessionID ?? event.properties.info?.id
    if (event.type.startsWith("session.")) {
      if (event.properties.info?.id) this.lineage.remember(event.properties.info)
      this.scheduleSessionRefresh()
    }
    if (sessionID === this.activeSessionID || (!sessionID && event.type === "server.connected")) {
      this.post({ type: "event", event })
    }
    if (event.type === "permission.asked") {
      void this.handlePermission(event.properties as PermissionRequest).catch((error) => this.reportError(error))
    }
    if (event.type === "question.replied" || event.type === "question.rejected") {
      const requestID = event.properties.requestID ?? event.properties.id
      if (requestID) this.post({ type: "questionResolved", requestID })
    }
    if (event.type === "question.asked" && sessionID === this.activeSessionID) {
      this.handleQuestion(event.properties as QuestionRequest)
    }
  }

  private handleQuestion(request: QuestionRequest): void {
    this.post({ type: "question", question: request })
  }

  private async replyQuestion(requestID: string, answers?: string[][]): Promise<void> {
    await this.questionResponder.reply(requestID, answers)
  }

  private async syncPending(): Promise<void> {
    const sessionID = this.activeSessionID
    const client = this.client
    if (!sessionID || !client) return
    const [questions, permissions, statuses] = await Promise.all([
      client.questions(), client.permissions(), client.sessionStatuses(),
    ])
    const pending = await this.pendingPermissions(permissions, sessionID)
    if (sessionID !== this.activeSessionID) return
    this.post({
      type: "pendingSnapshot", sessionID,
      questions: questions.filter((item) => item.sessionID === sessionID),
      permissions: pending,
      busy: ["busy", "retry"].includes(statuses[sessionID]?.type ?? ""),
    })
  }

  private scheduleSessionRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => void this.refreshSessions(), 250)
  }

  private async refreshSessions(loadFallback = false): Promise<void> {
    const sessions = await (await this.ensureClient()).listSessions(this.sessionLimit)
    if (loadFallback && !this.activeSessionID) {
      const fallback = sessions[0]
      if (fallback) await this.selectSession(fallback.id)
      else this.post({ type: "sessionSelected", messages: [] })
    }
    this.post({ type: "sessions", sessions, activeSessionID: this.activeSessionID })
    this.sessionsChanged.fire()
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.post({ type: "error", message })
    vscode.window.showErrorMessage(`OpenCode: ${message}`, "Show Logs").then((action) => {
      if (action === "Show Logs") this.server.showLogs()
    })
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message)
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomNonce()
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"))
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style}">
  <title>OpenCode</title>
</head>
<body>
  <main id="app" aria-live="polite"></main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
  }
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}
