import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { applyOpenCodeEvent, type EventState } from "../src/eventReducer"

function emptyState(): EventState {
  return { messages: [], busy: false }
}

describe("OpenCode event reducer", () => {
  it("builds a streaming assistant message from events", () => {
    let state = applyOpenCodeEvent(emptyState(), {
      type: "message.updated",
      properties: {
        info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 } },
      },
    })
    state = applyOpenCodeEvent(state, {
      type: "message.part.updated",
      properties: { part: { id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "Hel" } },
    })
    state = applyOpenCodeEvent(state, {
      type: "message.part.delta",
      properties: { messageID: "m1", partID: "p1", field: "text", delta: "lo" },
    })
    assert.equal(state.messages[0]?.parts[0]?.text, "Hello")
  })

  it("tracks busy, idle, and errors", () => {
    let state = applyOpenCodeEvent(emptyState(), {
      type: "session.status",
      properties: { status: { type: "busy" } },
    })
    assert.equal(state.busy, true)
    state = applyOpenCodeEvent(state, { type: "session.error", properties: { error: { data: { message: "No key" } } } })
    assert.equal(state.busy, false)
    assert.equal(state.error, "No key")
  })
})
