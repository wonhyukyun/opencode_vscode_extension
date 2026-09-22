export interface SessionInfo {
  id: string
  title: string
  directory: string
  model?: { id: string; providerID: string; variant?: string }
  time: { created: number; updated: number; archived?: number }
}

export interface MessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  error?: unknown
  [key: string]: unknown
}

export interface MessagePart {
  id: string
  sessionID: string
  messageID: string
  type: string
  [key: string]: unknown
}

export interface MessageWithParts {
  info: MessageInfo
  parts: MessagePart[]
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  variants?: Record<string, unknown>
  capabilities?: { attachment?: boolean; toolcall?: boolean }
}

export interface ProviderInfo {
  id: string
  name: string
  models: Record<string, ModelInfo>
}

export interface ProvidersResponse {
  providers: ProviderInfo[]
  default: Record<string, string>
}

export interface ProviderCatalogResponse {
  all: ProviderInfo[]
  connected: string[]
  default: Record<string, string>
}

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
}

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
}

export interface OpenCodeEvent {
  id?: string
  type: string
  properties: Record<string, any>
}

export interface EditorContext {
  label: string
  path: string
  startLine?: number
  endLine?: number
  selectedText?: string
  uri: string
}

export type PromptPart =
  | { type: "text"; text: string }
  | {
      type: "file"
      mime: string
      filename: string
      url: string
      source?: {
        type: "file"
        path: string
        text: { value: string; start: number; end: number }
      }
    }

export interface CommandInfo {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: "command" | "mcp" | "skill"
  hints?: string[]
}

export interface ImageAttachment {
  filename: string
  mime: string
  url: string
}

export interface SelectedModel {
  providerID: string
  modelID: string
  variant?: string
}
