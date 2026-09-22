import * as path from "node:path"
import * as vscode from "vscode"
import { OpenCodeClient } from "./client"
import { OpenCodeServer } from "./server"
import type {
  CommandInfo,
  ImageAttachment,
  EditorContext,
  OpenCodeEvent,
  PromptPart,
  QuestionRequest,
  SelectedModel,
  SessionInfo,
} from "./types"

type WebviewMessage =
  | { type: "ready" }
  | { type: "newSession" }
  | { type: "selectSession"; sessionID: string }
  | { type: "deleteSession"; sessionID: string }
  | { type: "send"; text: string; attachContext: boolean; model?: SelectedModel; images?: ImageAttachment[]; files?: string[] }
  | { type: "command"; command: string; arguments: string; model?: SelectedModel }
  | { type: "findFiles"; query: string; requestID: number }
  | { type: "questionReply"; requestID: string; answers: string[][] }
  | { type: "questionReject"; requestID: string }
  | { type: "abort" }
  | { type: "permissionReply"; requestID: string; reply: "once" | "always" | "reject" }
  | { type: "connectProvider" }
  | { type: "openLink"; href: string }

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "opencodeIntegrated.chat"

  private view: vscode.WebviewView | undefined
  private client: OpenCodeClient | undefined
  private activeSessionID: string | undefined
  private eventController: AbortController | undefined
  private initialization: Promise<void> | undefined
  private refreshTimer: NodeJS.Timeout | undefined
  private forceContext = false

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: OpenCodeServer,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    }
    view.webview.html = this.html(view.webview)
    view.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handleMessage(message), undefined, this.context.subscriptions)
    view.onDidDispose(() => {
      this.view = undefined
    })
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.opencodeIntegrated")
    this.view?.show?.(true)
  }

  async newChat(): Promise<void> {
    await this.reveal()
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

  notifyEditorContext(): void {
    this.post({ type: "context", context: this.editorContext(), enabled: this.forceContext })
  }

  async connectProvider(): Promise<void> {
    try {
      const client = await this.ensureClient()
      const [catalog, methods] = await Promise.all([client.providerCatalog(), client.providerAuthMethods()])
      const choices = catalog.all
        .filter((provider) => !catalog.connected.includes(provider.id))
        .map((provider) => ({ label: provider.name, description: provider.id, provider }))
        .sort((a, b) => a.label.localeCompare(b.label))
      const selected = await vscode.window.showQuickPick(choices, {
        title: "Connect an AI provider",
        placeHolder: "Choose a provider",
        matchOnDescription: true,
      })
      if (!selected) return

      const available = methods[selected.provider.id] ?? [{ type: "api" as const, label: "API key" }]
      const method = await vscode.window.showQuickPick(
        available.map((item, index) => ({ label: item.label, description: item.type, item, index })),
        { title: `Connect ${selected.provider.name}` },
      )
      if (!method) return

      if (method.item.type === "api") {
        const key = await vscode.window.showInputBox({
          title: `${selected.provider.name} API key`,
          prompt: "The key is sent only to the local OpenCode engine and is never exposed to the webview.",
          password: true,
          ignoreFocusOut: true,
        })
        if (!key) return
        await client.setApiKey(selected.provider.id, key)
      } else {
        const authorization = await client.authorizeOAuth(selected.provider.id, method.index)
        await vscode.env.openExternal(vscode.Uri.parse(authorization.url))
        let code: string | undefined
        if (authorization.method === "code") {
          code = await vscode.window.showInputBox({
            title: `Finish ${selected.provider.name} sign-in`,
            prompt: authorization.instructions || "Paste the authorization code from your browser.",
            ignoreFocusOut: true,
          })
          if (!code) return
        }
        await client.finishOAuth(selected.provider.id, method.index, code)
      }
      vscode.window.showInformationMessage(`${selected.provider.name} connected to OpenCode.`)
      await this.refreshProviders()
    } catch (error) {
      this.reportError(error)
    }
  }

  dispose(): void {
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
        case "connectProvider":
          await this.connectProvider()
          return
        case "openLink":
          if (/^https?:\/\//i.test(message.href)) await vscode.env.openExternal(vscode.Uri.parse(message.href))
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
    const [sessions, providers, permissions, questions, commands] = await Promise.all([
      client.listSessions(),
      client.providers(),
      client.permissions(),
      client.questions(),
      client.commands().catch((): CommandInfo[] => []),
    ])
    const remembered = this.context.workspaceState.get<string>("activeSessionID")
    const session = sessions.find((item) => item.id === remembered) ?? sessions[0]
    this.activeSessionID = session?.id
    const messages = session ? await client.getMessages(session.id) : []
    this.post({
      type: "initialize",
      sessions,
      activeSessionID: this.activeSessionID,
      messages,
      providers,
      permissions: permissions.filter((item) => item.sessionID === this.activeSessionID),
      context: this.editorContext(),
      commands,
    })
    for (const question of questions) {
      if (question.sessionID === this.activeSessionID) this.handleQuestion(question)
    }
  }

  private async ensureClient(): Promise<OpenCodeClient> {
    if (this.client) return this.client
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) throw new Error("Open a folder or workspace before starting OpenCode.")
    const baseUrl = await this.server.start()
    this.client = new OpenCodeClient(baseUrl, folder.uri.fsPath, this.server.authorization)
    this.eventController = new AbortController()
    void this.client.subscribe((event) => this.onEvent(event), this.eventController.signal)
    return this.client
  }

  private async selectSession(sessionID: string): Promise<void> {
    const client = await this.ensureClient()
    this.activeSessionID = sessionID
    await this.context.workspaceState.update("activeSessionID", sessionID)
    const messages = await client.getMessages(sessionID)
    this.post({ type: "sessionSelected", sessionID, messages })
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

  private async ensureSession(): Promise<string> {
    const client = await this.ensureClient()
    if (!this.activeSessionID) {
      const session = await client.createSession()
      this.activeSessionID = session.id
      await this.context.workspaceState.update("activeSessionID", session.id)
      await this.refreshSessions()
      this.post({ type: "sessionSelected", sessionID: session.id, messages: [] })
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
    const editor = vscode.window.activeTextEditor
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

  private onEvent(event: OpenCodeEvent): void {
    const sessionID = event.properties.sessionID ?? event.properties.info?.sessionID ?? event.properties.info?.id
    if (event.type.startsWith("session.")) this.scheduleSessionRefresh()
    if (sessionID === this.activeSessionID || (!sessionID && event.type === "server.connected")) {
      this.post({ type: "event", event })
    }
    if (event.type === "permission.asked" && sessionID === this.activeSessionID) {
      this.post({ type: "permission", permission: event.properties })
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
    const client = await this.ensureClient()
    try {
      if (answers) await client.replyQuestion(requestID, answers)
      else await client.rejectQuestion(requestID)
    } finally {
      this.post({ type: "questionResolved", requestID })
    }
  }

  private scheduleSessionRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => void this.refreshSessions(), 250)
  }

  private async refreshSessions(loadFallback = false): Promise<void> {
    const sessions = await (await this.ensureClient()).listSessions()
    if (loadFallback && !this.activeSessionID) {
      const fallback = sessions[0]
      if (fallback) await this.selectSession(fallback.id)
      else this.post({ type: "sessionSelected", messages: [] })
    }
    this.post({ type: "sessions", sessions, activeSessionID: this.activeSessionID })
  }

  private async refreshProviders(): Promise<void> {
    const providers = await (await this.ensureClient()).providers()
    this.post({ type: "providers", providers })
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
