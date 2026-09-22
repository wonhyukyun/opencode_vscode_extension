import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseEventStream } from "../src/client"

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
