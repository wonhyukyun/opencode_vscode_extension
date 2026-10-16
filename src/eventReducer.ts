import type { MessagePart, MessageWithParts, OpenCodeEvent } from "./types"

export interface EventState {
  messages: MessageWithParts[]
  busy: boolean
  error?: string
}

export function applyOpenCodeEvent(state: EventState, event: OpenCodeEvent): EventState {
  const properties = event.properties
  switch (event.type) {
    case "message.updated": {
      const info = properties.info
      if (!info?.id) return state
      const existing = state.messages.find((message) => message.info.id === info.id)
      if (existing) existing.info = info
      else state.messages.push({ info, parts: [] })
      sortMessages(state.messages)
      return { ...state, messages: [...state.messages] }
    }
    case "message.removed":
      return { ...state, messages: state.messages.filter((message) => message.info.id !== properties.messageID) }
    case "message.part.updated": {
      const part = properties.part as MessagePart | undefined
      if (!part) return state
      const message = state.messages.find((item) => item.info.id === part.messageID)
      if (!message) return state
      const index = message.parts.findIndex((item) => item.id === part.id)
      if (index >= 0) message.parts[index] = part
      else message.parts.push(part)
      return { ...state, messages: [...state.messages] }
    }
    case "message.part.delta": {
      const message = state.messages.find((item) => item.info.id === properties.messageID)
      const part = message?.parts.find((item) => item.id === properties.partID)
      if (!part || typeof properties.field !== "string" || typeof properties.delta !== "string") return state
      const current = part[properties.field]
      part[properties.field] = `${typeof current === "string" ? current : ""}${properties.delta}`
      return { ...state, messages: [...state.messages] }
    }
    case "message.part.removed": {
      const message = state.messages.find((item) => item.info.id === properties.messageID)
      if (!message) return state
      message.parts = message.parts.filter((part) => part.id !== properties.partID)
      return { ...state, messages: [...state.messages] }
    }
    case "session.status":
      return { ...state, busy: ["busy", "retry"].includes(properties.status?.type) }
    case "session.idle":
      return { ...state, busy: false }
    case "session.error":
      return { ...state, busy: false, error: describeError(properties.error) }
    default:
      return state
  }
}

function sortMessages(messages: MessageWithParts[]): void {
  messages.sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))
}

function describeError(error: unknown): string {
  if (!error) return "OpenCode stopped because of an unknown error."
  if (typeof error === "string") return error
  if (typeof error === "object") {
    const value = error as { message?: string; data?: { message?: string }; name?: string }
    return value.data?.message ?? value.message ?? value.name ?? JSON.stringify(error)
  }
  return String(error)
}
