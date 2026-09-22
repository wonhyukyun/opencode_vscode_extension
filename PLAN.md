# OpenCode Integrated implementation plan

## Goal

Run OpenCode as a self-contained VS Code experience: no separately installed CLI and no terminal/TUI. The extension owns a hidden, loopback-only OpenCode server and exposes its capabilities through a VS Code sidebar.

## Architecture

1. Package the platform-specific OpenCode executable inside the VSIX.
2. Start it with `serve --hostname 127.0.0.1` on an ephemeral port and stop it with the extension.
3. Use the documented local HTTP/SSE API for sessions, messages, models, permissions, questions, and authentication.
4. Render a CSP-protected webview using VS Code theme variables. Keep secrets and filesystem access in the extension host.
5. Build target-specific VSIX files so each installer contains exactly one native engine.

## Delivery stages

- [x] Audit the official extension and OpenCode server API.
- [x] Define a terminal-free architecture.
- [x] Implement engine lifecycle and API client.
- [x] Implement integrated chat UI and editor context attachment.
- [x] Implement sessions, model selection, permissions, questions, and provider connection.
- [x] Add unit tests and package the Windows x64 VSIX.
- [x] Smoke-test the bundled engine and document remaining platform release work.
