import type { MessageWithParts } from "./types"

export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface TokenSummary {
  /** Tokens used by the most recent completed assistant turn. */
  context: number
  /** Sum of every assistant turn in the session. */
  sessionTotal: number
  providerID?: string
  modelID?: string
  /** Rough token estimate for assistant output still streaming (no usage reported yet). */
  pending: number
}

const CHARS_PER_TOKEN = 4

function partText(part: { type: string; [key: string]: unknown }): string {
  switch (part.type) {
    case "text":
    case "reasoning":
      return typeof part.text === "string" ? part.text : ""
    case "tool": {
      const state = part.state as { input?: unknown; output?: unknown } | undefined
      const input = state?.input === undefined ? "" : JSON.stringify(state.input)
      const output = typeof state?.output === "string" ? state.output : ""
      return input + output
    }
    default:
      return ""
  }
}

/** Estimate tokens for assistant messages that have no reported usage yet (still streaming). */
export function estimatePendingTokens(messages: MessageWithParts[]): number {
  let characters = 0
  for (const message of messages) {
    if (message.info.role !== "assistant" || messageTokens(message)) continue
    for (const part of message.parts) characters += partText(part).length
  }
  return Math.round(characters / CHARS_PER_TOKEN)
}

export function totalTokens(usage: TokenUsage | undefined): number {
  if (!usage) return 0
  return (
    (usage.input ?? 0) +
    (usage.output ?? 0) +
    (usage.reasoning ?? 0) +
    (usage.cache?.read ?? 0) +
    (usage.cache?.write ?? 0)
  )
}

/**
 * Resolve the usage for one assistant message. The engine creates assistant messages with
 * all-zero counters and fills `info.tokens` when the turn completes; some builds only report
 * usage on `step-finish` parts. Prefer the message-level value, then the last step-finish part.
 */
export function messageTokens(message: MessageWithParts): TokenUsage | undefined {
  if (message.info.role !== "assistant") return undefined
  const info = message.info.tokens as TokenUsage | undefined
  if (info && totalTokens(info) > 0) return info
  for (let index = message.parts.length - 1; index >= 0; index--) {
    const part = message.parts[index]
    if (!part || part.type !== "step-finish") continue
    const usage = part.tokens as TokenUsage | undefined
    if (usage && totalTokens(usage) > 0) return usage
  }
  return undefined
}

export function summarizeTokens(messages: MessageWithParts[]): TokenSummary | undefined {
  let last: { message: MessageWithParts; usage: TokenUsage } | undefined
  let sessionTotal = 0
  for (const message of messages) {
    const usage = messageTokens(message)
    if (!usage) continue
    sessionTotal += totalTokens(usage)
    last = { message, usage }
  }
  const pending = estimatePendingTokens(messages)
  if (!last) {
    if (!pending) return undefined
    return { context: pending, sessionTotal: 0, pending }
  }
  return {
    context: totalTokens(last.usage) + pending,
    sessionTotal,
    pending,
    providerID: typeof last.message.info.providerID === "string" ? last.message.info.providerID : undefined,
    modelID: typeof last.message.info.modelID === "string" ? last.message.info.modelID : undefined,
  }
}
