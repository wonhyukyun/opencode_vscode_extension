import * as vscode from "vscode"
import type { ChatViewProvider } from "./chatView"
import {
  mcpNeedsAttention, mcpStatusLabel, mcpSummary, skillsSummary, summarizeMcpServers, summarizeSkills,
} from "./loadedResources"

/** Shared plumbing for the two read-only panels below History. */
abstract class LoadedViewProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  private readonly subscription: vscode.Disposable
  protected view: vscode.TreeView<vscode.TreeItem> | undefined

  constructor(protected readonly chat: ChatViewProvider) {
    this.subscription = chat.onDidChangeSessions(() => this.refresh())
  }

  /** Lets the provider write a count into the view title once the data is in. */
  attach(view: vscode.TreeView<vscode.TreeItem>): void {
    this.view = view
  }

  refresh(): void { this.changed.fire() }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item }
  abstract getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]>

  protected message(text: string, tooltip?: string): vscode.TreeItem {
    const item = new vscode.TreeItem(text)
    if (tooltip) item.tooltip = tooltip
    return item
  }

  protected retry(error: unknown, command: string): vscode.TreeItem {
    const item = new vscode.TreeItem("Could not load — click to retry")
    item.iconPath = new vscode.ThemeIcon("refresh")
    item.tooltip = error instanceof Error ? error.message : String(error)
    item.command = { command, title: "Retry" }
    return item
  }

  protected setDescription(text: string): void {
    if (this.view) this.view.description = text
  }

  dispose(): void {
    this.subscription.dispose()
    this.changed.dispose()
  }
}

/** Lists the skills the engine has loaded for this workspace. */
export class SkillsViewProvider extends LoadedViewProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return []
    if (!vscode.workspace.workspaceFolders?.length) {
      this.setDescription("")
      return [this.message("Open a folder to see loaded skills")]
    }
    try {
      const skills = summarizeSkills(await this.chat.getSkills())
      this.setDescription(skillsSummary(skills))
      if (!skills.length) {
        return [this.message(
          "No skills loaded",
          "Add a SKILL.md under .opencode/skill or .opencode/skills, then restart OpenCode. Skills are read once at startup.",
        )]
      }
      return skills.map((skill) => {
        const item = new vscode.TreeItem(skill.name)
        item.id = `skill:${skill.location}:${skill.name}`
        item.iconPath = new vscode.ThemeIcon(skill.builtIn ? "verified-filled" : "lightbulb")
        item.description = skill.origin
        item.tooltip = new vscode.MarkdownString(
          `**${skill.name}**\n\n${skill.description || "_No description._"}\n\n\`${skill.location}\``,
        )
        if (!skill.builtIn) {
          item.resourceUri = vscode.Uri.file(skill.location)
          item.command = { command: "vscode.open", title: "Open SKILL.md", arguments: [vscode.Uri.file(skill.location)] }
          item.contextValue = "opencodeSkillFile"
        } else item.contextValue = "opencodeSkillBuiltIn"
        return item
      })
    } catch (error) {
      this.setDescription("")
      return [this.retry(error, "opencodeIntegrated.refreshSkills")]
    }
  }
}

/** Lists configured MCP servers and whether the engine could reach them. */
export class McpViewProvider extends LoadedViewProvider {
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return []
    if (!vscode.workspace.workspaceFolders?.length) {
      this.setDescription("")
      return [this.message("Open a folder to see MCP servers")]
    }
    try {
      const servers = summarizeMcpServers(await this.chat.getMcpServers())
      this.setDescription(mcpSummary(servers))
      if (!servers.length) {
        return [this.message(
          "No MCP servers configured",
          'Add servers under "mcp" in opencode.json, then restart OpenCode.',
        )]
      }
      return servers.map((server) => {
        const item = new vscode.TreeItem(server.name)
        item.id = `mcp:${server.name}`
        const attention = mcpNeedsAttention(server.status)
        const icon = server.status === "connected" ? "pass-filled"
          : server.status === "disabled" ? "circle-slash"
          : attention ? "error" : "question"
        const colour = server.status === "connected" ? "testing.iconPassed"
          : attention ? "testing.iconFailed" : undefined
        item.iconPath = new vscode.ThemeIcon(icon, colour ? new vscode.ThemeColor(colour) : undefined)
        item.description = mcpStatusLabel(server.status)
        item.tooltip = server.error
          ? `${server.name}\n${mcpStatusLabel(server.status)}\n\n${server.error}`
          : `${server.name}\n${mcpStatusLabel(server.status)}`
        item.contextValue = attention ? "opencodeMcpProblem" : "opencodeMcpServer"
        return item
      })
    } catch (error) {
      this.setDescription("")
      return [this.retry(error, "opencodeIntegrated.refreshMcp")]
    }
  }
}
