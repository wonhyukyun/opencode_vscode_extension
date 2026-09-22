# OpenCode Integrated

OpenCode Integrated is a terminal-free VS Code client for OpenCode. It packages the OpenCode engine inside the extension and presents chat, streaming responses, sessions, models, editor context, tool activity, permissions, and provider sign-in in the VS Code UI.

## Install

Install the VSIX that matches the VS Code extension host. The current build target is Windows x64:

```powershell
code --install-extension artifacts/opencode-integrated-win32-x64.vsix
```

You do not need to install `opencode` separately. After installation, open a folder and select the OpenCode icon in the activity bar.

## Use

- `Ctrl+Esc` opens the OpenCode sidebar.
- `Ctrl+Shift+Esc` starts a new chat.
- **OpenCode: Add Selection to Chat** attaches the selected editor text.
- **Connect provider** uses VS Code's password input or browser OAuth flow. Credentials remain in the extension host and OpenCode's own credential store; they are never sent to the webview.
- Tool permissions appear above the composer and can be allowed once, always allowed, or denied.

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
