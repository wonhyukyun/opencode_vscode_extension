import type { MessageWithParts } from "./types"

/**
 * User messages the engine has not started answering yet because they were sent while a reply was
 * running. A message is queued while no reply points at it and the reply before it is still going:
 * incomplete, or finished a step only to call more tools.
 */
export function queuedMessageIDs(messages: readonly MessageWithParts[], busy: boolean): Set<string> {
  const queued = new Set<string>()
  if (!busy) return queued
  const answered = new Set<string>()
  for (const message of messages) {
    if (message.info.role === "assistant" && typeof message.info.parentID === "string") answered.add(message.info.parentID)
  }
  let lastReply: MessageWithParts | undefined
  for (const message of messages) {
    if (message.info.role === "assistant") {
      lastReply = message
      continue
    }
    if (!lastReply || answered.has(message.info.id)) continue
    const running = !lastReply.info.time?.completed || lastReply.info.finish === "tool-calls"
    if (running || queued.size) queued.add(message.info.id)
  }
  return queued
}

/** Subagent (task tool) calls that are still running. */
export function runningSubagents(messages: readonly MessageWithParts[]): number {
  let count = 0
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== "task") continue
      const status = (part.state as { status?: string } | undefined)?.status
      if (status === "running" || status === "pending") count++
    }
  }
  return count
}
