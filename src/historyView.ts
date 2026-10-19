import * as vscode from "vscode"
import type { ChatViewProvider } from "./chatView"
import type { GlobalSessionInfo, HistoryGroup } from "./types"

/** A repository row in the history tree. Session rows are plain TreeItems. */
class RepositoryItem extends vscode.TreeItem {
  constructor(readonly group: HistoryGroup, expanded: boolean) {
    super(group.name, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
    this.id = `repository:${group.key}`
    this.iconPath = new vscode.ThemeIcon(group.current ? "root-folder-opened" : "repo")
    const count = group.sessions.length
    this.description = group.current
      ? `Current repository · ${count} chat${count === 1 ? "" : "s"}`
      : `${count} chat${count === 1 ? "" : "s"}`
    this.tooltip = `${group.name}\n${group.path}`
    this.contextValue = group.current ? "opencodeRepositoryCurrent" : "opencodeRepository"
  }
}

export class HistoryViewProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  private readonly subscription: vscode.Disposable
  private selectionMode = false
  private deleting = false
  private readonly selected = new Map<string, string>()
  private activeSessionID: string | undefined

  constructor(private readonly chat: ChatViewProvider) {
    this.subscription = chat.onDidChangeSessions(() => this.refresh())
    void this.updateSelectionContext()
  }

  async setSelectionMode(enabled: boolean): Promise<void> {
    if (this.deleting) return
    this.selectionMode = enabled
    this.selected.clear()
    await this.updateSelectionContext()
    this.refresh()
  }

  async changeCheckboxes(event: vscode.TreeCheckboxChangeEvent<vscode.TreeItem>): Promise<void> {
    if (!this.selectionMode || this.deleting) { this.refresh(); return }
    for (const [item, state] of event.items) {
      if (!item.id || item instanceof RepositoryItem) continue
      if (state === vscode.TreeItemCheckboxState.Checked) {
        this.selected.set(item.id, typeof item.label === "string" ? item.label : item.label?.label ?? "New chat")
      } else this.selected.delete(item.id)
    }
    await this.updateSelectionContext()
    this.refresh()
  }

  async deleteSelected(): Promise<void> {
    if (!this.selectionMode || this.deleting || !this.selected.size) return
    this.deleting = true
    const selected = new Map(this.selected)
    await this.updateSelectionContext()
    this.refresh()
    try {
      const answer = await vscode.window.showWarningMessage(
        `Delete ${selected.size} selected chat(s)?`,
        { modal: true, detail: `${Array.from(selected.values()).join("\n")}\n\nThese conversations cannot be recovered.` },
        "Delete",
      )
      if (answer !== "Delete") return
      const result = await this.chat.deleteHistorySessions([...selected.keys()])
      for (const id of result.deleted) this.selected.delete(id)
      if (result.failed.length) {
        await vscode.window.showErrorMessage(
          `Deleted ${result.deleted.length} chat(s). ${result.failed.length} failed and remain selected for retry.`,
          { modal: true, detail: result.failed.map((item) => `${selected.get(item.id)}: ${item.message}`).join("\n") },
        )
      } else {
        this.selectionMode = false
        void vscode.window.showInformationMessage(`Deleted ${result.deleted.length} chat(s).`)
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not delete chats: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.deleting = false
      await this.updateSelectionContext()
      this.refresh()
    }
  }

  /** Deletes the one chat behind a tree row, after the same confirmation as bulk delete. */
  async deleteItem(item: vscode.TreeItem | undefined): Promise<void> {
    if (!item?.id || item instanceof RepositoryItem || this.deleting) return
    const title = typeof item.label === "string" ? item.label : item.label?.label ?? "New chat"
    const answer = await vscode.window.showWarningMessage(
      `Delete "${title}"?`,
      { modal: true, detail: "This conversation cannot be recovered." },
      "Delete",
    )
    if (answer !== "Delete") return
    this.deleting = true
    await this.updateSelectionContext()
    try {
      const result = await this.chat.deleteHistorySessions([item.id])
      if (result.failed.length) {
        void vscode.window.showErrorMessage(`Could not delete "${title}": ${result.failed[0]?.message}`)
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not delete chat: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.deleting = false
      await this.updateSelectionContext()
      this.refresh()
    }
  }

  private async updateSelectionContext(): Promise<void> {
    await Promise.all([
      vscode.commands.executeCommand("setContext", "opencodeIntegrated.historySelecting", this.selectionMode),
      vscode.commands.executeCommand("setContext", "opencodeIntegrated.historyHasSelection", this.selected.size > 0),
      vscode.commands.executeCommand("setContext", "opencodeIntegrated.historyDeleting", this.deleting),
    ])
  }

  refresh(): void { this.changed.fire() }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof RepositoryItem) return this.sessionItems(element.group)
    if (element) return []

    const create = this.action("New chat", "opencodeIntegrated.newChat", "add")
    if (!vscode.workspace.workspaceFolders?.length) {
      return [new vscode.TreeItem("Open a folder to view chat history")]
    }
    try {
      const { groups, activeSessionID, hasMore } = await this.chat.getGroupedHistory()
      this.activeSessionID = activeSessionID
      const rows: vscode.TreeItem[] = groups.map((group) => new RepositoryItem(group, group.current))
      if (!rows.length) rows.push(new vscode.TreeItem("No saved chats yet"))
      if (hasMore) rows.push(this.action("Load older chats...", "opencodeIntegrated.loadOlderHistory", "history"))
      if (this.selectionMode) {
        const remove = this.action(this.deleting ? "Deleting..." : `Delete (${this.selected.size})`, "opencodeIntegrated.deleteSelectedHistory", "trash")
        if (!this.selected.size || this.deleting) remove.command = undefined
        const cancel = this.action("Cancel selection", "opencodeIntegrated.cancelHistorySelection", "close")
        if (this.deleting) cancel.command = undefined
        return [remove, cancel, ...rows]
      }
      return [create, this.action("Select chats", "opencodeIntegrated.startHistorySelection", "checklist"), ...rows]
    } catch (error) {
      const retry = this.action("Could not load history — click to retry", "opencodeIntegrated.refreshHistory", "refresh")
      retry.tooltip = error instanceof Error ? error.message : String(error)
      return [create, retry]
    }
  }

  private sessionItems(group: HistoryGroup): vscode.TreeItem[] {
    if (!group.sessions.length) return [new vscode.TreeItem("No saved chats yet")]
    return group.sessions.map((session) => this.sessionItem(session, group))
  }

  private sessionItem(session: GlobalSessionInfo, group: HistoryGroup): vscode.TreeItem {
    const title = session.title || "New chat"
    const item = new vscode.TreeItem(title)
    item.id = session.id
    const active = group.current && session.id === this.activeSessionID
    item.iconPath = new vscode.ThemeIcon(active ? "comment-discussion" : "comment")
    item.description = active ? "Current chat" : new Date(session.time.updated).toLocaleDateString()
    item.tooltip = `${title}\n${new Date(session.time.updated).toLocaleString()}\n${session.directory}`
    if (this.selectionMode) {
      item.checkboxState = this.selected.has(session.id) ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked
    } else {
      item.contextValue = "opencodeSession"
      item.command = { command: "opencodeIntegrated.selectHistory", title: "Open chat", arguments: [session.id] }
    }
    return item
  }

  private action(label: string, command: string, icon: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label)
    item.id = command
    item.iconPath = new vscode.ThemeIcon(icon)
    item.command = { command, title: label }
    return item
  }

  dispose(): void {
    this.subscription.dispose()
    this.changed.dispose()
  }
}
