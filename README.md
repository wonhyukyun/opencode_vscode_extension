# OpenCode Integrated

OpenCode Integrated is a terminal-free VS Code client for OpenCode. It packages the OpenCode engine inside the extension and presents chat, streaming responses, sessions, models, editor context, tool activity, permissions, and provider sign-in in the VS Code UI.

## Install

Requires VS Code 1.106 or newer for the Secondary Side Bar contribution. Install the VSIX that matches the VS Code extension host. The current build target is Windows x64:

```powershell
code --install-extension artifacts/opencode-integrated-0.3.1-win32-x64.vsix
```

You do not need to install `opencode` separately. After installation, open a folder and select the OpenCode icon in the activity bar.

## Use

- The left **OpenCode > History** view lists saved conversations, newest first. Click a conversation to open it in the right **OpenCode Chat** sidebar.
- Click **New chat** in the history list, its **+** toolbar button, or press `Ctrl+Shift+Esc` to start a chat on the right.
- `Ctrl+Esc` or the editor title chat icon opens the left history and right chat views. Chat no longer opens an editor tab.
- **History** in the chat header focuses the left history list. Its search button opens **OpenCode: Search Chat History**; the refresh button reloads the list.
- **Load older chats...** expands the list beyond the first 50. Each opened chat currently loads its latest 200 messages.
- To delete conversations from the left History view, click **Select chats** (or the checklist toolbar icon), check the conversations, then click **Delete (N)** (or the trash icon) and confirm. **Cancel selection** exits without deleting anything. Failed deletions remain selected for retry; successfully deleted chats are removed from the list.
- Views use VS Code's default left/right sidebar placement. If you manually relocate them, VS Code remembers your layout.
- **OpenCode: Add Selection to Chat** attaches the selected editor text.
- Models come from your OpenCode configuration (`opencode.json` and OpenCode's credential store). Configure providers with the OpenCode CLI or config file; the extension does not manage credentials.
- Select an agent and then choose its model and thinking effort. The assignment is saved per workspace and restored when you switch back to that agent, including after reopening the chat. These assignments apply to directly selected agents; configure internally invoked subagent models separately in OpenCode's agent configuration.
- Tool permissions appear above the composer and can be allowed once, always allowed, or denied.
- Agent questions show an explicit **Waiting for your answer** status. Select an answer or use **Other**, then **Send answer**; single-choice questions have no preselected answer. **Skip without answering** rejects the question.
- Question drafts survive incoming events and switching conversations in the same chat view. Failed submissions retain the question and answer for retry. Reconnecting reloads pending questions, permissions and execution status.
- Question tool messages display readable questions and responses in the conversation history, using the engine's saved tool output.

## Development

```powershell
npm install
npm run prepare-binary
npm run check-types
npm test
npm run compile
```

Press `F5` from VS Code after preparing the binary. `opencodeIntegrated.binaryPath` is available only as a development override; normal installations always use the bundled engine.

## Packaging model

Native executables cannot be shared between operating systems, so releases are target-specific VSIX files. This keeps each installed extension self-contained without shipping every platform's executable in one very large package.
