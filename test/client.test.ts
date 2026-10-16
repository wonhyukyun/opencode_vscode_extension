import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createServer } from "node:http"
import { OpenCodeClient, parseEventStream } from "../src/client"

describe("OpenCode SSE parser", () => {
  it("parses fragmented direct and global events", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"session.status","properties":{"status":{"type":"bu'))
        controller.enqueue(encoder.encode('sy"}}}\n\ndata: {"payload":{"type":"session.idle","properties":{}}}\n\n'))
        controller.close()
      },
    })
    const events: string[] = []
    await parseEventStream(stream, (event) => events.push(event.type))
    assert.deepEqual(events, ["session.status", "session.idle"])
  })
})

describe("event reconnection", () => {
  it("refreshes the pending snapshot before delivering events on every connection", async () => {
    let connections = 0
    const server = createServer((_request, response) => {
      const index = ++connections
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(`data: ${JSON.stringify({ type: "question.asked", properties: { id: `q${index}` } })}\n\n`)
      if (index === 1) response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    const calls: string[] = []
    const client = new OpenCodeClient(`http://127.0.0.1:${address.port}`, "test")
    try {
      await client.subscribe((event) => {
        if (event.type === "question.asked") {
          calls.push(event.properties.id)
          if (event.properties.id === "q2") controller.abort()
        }
      }, controller.signal, async () => { calls.push("snapshot") })
      assert.deepEqual(calls, ["snapshot", "q1", "snapshot", "q2"])
    } finally {
      clearTimeout(timeout)
      controller.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
