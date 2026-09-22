import * as vscode from "vscode"
import { ChatViewProvider } from "./chatView"
import { OpenCodeServer } from "./server"

export function activate(context: vscode.ExtensionContext): void {
  const server = new OpenCodeServer(context)
  const chat = new ChatViewProvider(context, server)

  context.subscriptions.push(
    server,
    chat,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("opencodeIntegrated.open", () => chat.reveal()),
    vscode.commands.registerCommand("opencodeIntegrated.newChat", () => chat.newChat()),
    vscode.commands.registerCommand("opencodeIntegrated.attachSelection", () => chat.attachSelection()),
    vscode.window.onDidChangeActiveTextEditor(() => chat.notifyEditorContext()),
    vscode.window.onDidChangeTextEditorSelection(() => chat.notifyEditorContext()),
  )
}

export function deactivate(): void {}
