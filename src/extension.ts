import * as vscode from "vscode"
import { ChatViewProvider } from "./chatView"
import { OpenCodeServer } from "./server"
import { HistoryViewProvider } from "./historyView"
import { McpViewProvider, SkillsViewProvider } from "./loadedView"

export function activate(context: vscode.ExtensionContext): void {
  const server = new OpenCodeServer(context)
  const chat = new ChatViewProvider(context, server)
  const history = new HistoryViewProvider(chat)
  const historyTree = vscode.window.createTreeView("opencodeIntegrated.history", {
    treeDataProvider: history, showCollapseAll: true, manageCheckboxStateManually: true,
  })

  const skills = new SkillsViewProvider(chat)
  const skillsTree = vscode.window.createTreeView("opencodeIntegrated.skills", { treeDataProvider: skills })
  skills.attach(skillsTree)
  const mcp = new McpViewProvider(chat)
  const mcpTree = vscode.window.createTreeView("opencodeIntegrated.mcp", { treeDataProvider: mcp })
  mcp.attach(mcpTree)

  context.subscriptions.push(
    server,
    chat,
    history,
    historyTree,
    skills,
    skillsTree,
    mcp,
    mcpTree,
    historyTree.onDidChangeCheckboxState((event) => void history.changeCheckboxes(event)),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("opencodeIntegrated.open", () => chat.reveal()),
    vscode.commands.registerCommand("opencodeIntegrated.openSidebar", () => chat.revealSidebar()),
    vscode.commands.registerCommand("opencodeIntegrated.newChat", () => chat.newChat()),
    vscode.commands.registerCommand("opencodeIntegrated.showHistory", () => chat.showHistory()),
    vscode.commands.registerCommand("opencodeIntegrated.searchHistory", () => chat.searchHistory()),
    vscode.commands.registerCommand("opencodeIntegrated.refreshHistory", () => history.refresh()),
    vscode.commands.registerCommand("opencodeIntegrated.refreshSkills", () => skills.refresh()),
    vscode.commands.registerCommand("opencodeIntegrated.refreshMcp", () => mcp.refresh()),
    vscode.commands.registerCommand("opencodeIntegrated.startHistorySelection", () => history.setSelectionMode(true)),
    vscode.commands.registerCommand("opencodeIntegrated.cancelHistorySelection", () => history.setSelectionMode(false)),
    vscode.commands.registerCommand("opencodeIntegrated.deleteSelectedHistory", () => history.deleteSelected()),
    vscode.commands.registerCommand("opencodeIntegrated.deleteHistoryItem", (item?: vscode.TreeItem) => history.deleteItem(item)),
    vscode.commands.registerCommand("opencodeIntegrated.loadOlderHistory", () => chat.loadOlderHistory()),
    vscode.commands.registerCommand("opencodeIntegrated.selectHistory", (sessionID: string) => chat.openSession(sessionID)),
    vscode.commands.registerCommand("opencodeIntegrated.attachSelection", () => chat.attachSelection()),
    vscode.commands.registerCommand("opencodeIntegrated.dumpDebug", () => chat.dumpDebug()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("opencodeIntegrated.defaultModel")) chat.notifyDefaultModel()
      // The engine reads agent definitions only when it starts.
      if (event.affectsConfiguration("opencodeIntegrated.harness") && server.isRunning) {
        void vscode.window
          .showInformationMessage("OpenCode: Reload the window to apply the Mini-SWE-V2 harness settings.", "Reload Window")
          .then((action) => {
            if (action === "Reload Window") void vscode.commands.executeCommand("workbench.action.reloadWindow")
          })
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => chat.notifyEditorContext()),
    vscode.window.onDidChangeTextEditorSelection(() => chat.notifyEditorContext()),
  )
}

export function deactivate(): void {}
