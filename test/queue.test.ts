import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { queuedMessageIDs, runningSubagents } from "../src/queue"
import type { MessageWithParts } from "../src/types"

function user(id: string): MessageWithParts {
  return { info: { id, sessionID: "s", role: "user", time: { created: 0 } }, parts: [] }
}

function reply(id: string, parentID: string, options: { completed?: boolean; finish?: string } = {}): MessageWithParts {
  return {
    info: { id, sessionID: "s", role: "assistant", parentID, finish: options.finish, time: { created: 0, completed: options.completed ? 1 : undefined } },
    parts: [],
  }
}

function task(status: string): MessageWithParts["parts"][number] {
  return { id: status, sessionID: "s", messageID: "a1", type: "tool", tool: "task", state: { status } }
}

describe("queued messages", () => {
  it("marks messages sent while a reply is running", () => {
    const messages = [user("u1"), reply("a1", "u1"), user("u2"), user("u3")]
    assert.deepEqual([...queuedMessageIDs(messages, true)], ["u2", "u3"])
  })
  it("keeps a message queued between tool-call steps", () => {
    const messages = [user("u1"), reply("a1", "u1", { completed: true, finish: "tool-calls" }), user("u2")]
    assert.deepEqual([...queuedMessageIDs(messages, true)], ["u2"])
  })
  it("does not mark a fresh prompt after a finished reply", () => {
    const messages = [user("u1"), reply("a1", "u1", { completed: true, finish: "stop" }), user("u2")]
    assert.equal(queuedMessageIDs(messages, true).size, 0)
  })
  it("unmarks a message once a reply answers it, and marks nothing when idle", () => {
    const messages = [user("u1"), reply("a1", "u1", { completed: true, finish: "tool-calls" }), user("u2"), reply("a2", "u2")]
    assert.equal(queuedMessageIDs(messages, true).size, 0)
    assert.equal(queuedMessageIDs([user("u1"), reply("a1", "u1"), user("u2")], false).size, 0)
  })
})

describe("running subagents", () => {
  it("counts task calls that are still running", () => {
    const message = reply("a1", "u1")
    message.parts = [task("running"), task("completed"), task("pending"), { id: "b", sessionID: "s", messageID: "a1", type: "tool", tool: "bash", state: { status: "running" } }]
    assert.equal(runningSubagents([message]), 2)
  })
})
