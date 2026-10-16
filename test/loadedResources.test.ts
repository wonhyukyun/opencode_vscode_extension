import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  BUILT_IN_LOCATION, isKnownCommand, mcpNeedsAttention, mcpStatusLabel, mcpSummary,
  skillsSummary, summarizeMcpServers, summarizeSkills,
} from "../src/loadedResources"

describe("loaded skills", () => {
  it("sorts disk skills alphabetically and pushes built-ins to the end", () => {
    const skills = summarizeSkills([
      { name: "zebra", location: "/home/me/.config/opencode/skill/zebra/SKILL.md" },
      { name: "customize-opencode", location: BUILT_IN_LOCATION, content: "..." },
      { name: "alpha", location: "/repo/.opencode/skill/alpha/SKILL.md" },
    ])
    assert.deepEqual(skills.map((skill) => skill.name), ["alpha", "zebra", "customize-opencode"])
    assert.equal(skills[2]?.builtIn, true)
    assert.equal(skills[0]?.builtIn, false)
  })

  it("names the folder a skill came from rather than the SKILL.md file", () => {
    const skills = summarizeSkills([
      { name: "review", location: "C:\\Users\\me\\.claude\\skills\\gstack\\.agents\\skills\\gstack-review\\SKILL.md" },
    ])
    assert.equal(skills[0]?.origin, "gstack-review")
  })

  it("labels built-ins and handles a missing location", () => {
    const skills = summarizeSkills([
      { name: "built", location: BUILT_IN_LOCATION },
      { name: "empty", location: "" },
    ])
    assert.deepEqual(skills.map((skill) => skill.origin), ["Built-in", "Built-in"])
    assert.equal(skills.every((skill) => skill.builtIn), true)
  })

  it("trims a missing description to an empty string", () => {
    const skills = summarizeSkills([{ name: "a", location: "/x/a/SKILL.md" }])
    assert.equal(skills[0]?.description, "")
  })

  it("summarizes the count with the built-in share", () => {
    assert.equal(skillsSummary([]), "No skills loaded")
    assert.equal(skillsSummary(summarizeSkills([{ name: "a", location: "/x/a/SKILL.md" }])), "1 skill")
    assert.equal(
      skillsSummary(summarizeSkills([
        { name: "a", location: "/x/a/SKILL.md" },
        { name: "b", location: BUILT_IN_LOCATION },
      ])),
      "2 skills · 1 built-in",
    )
  })

  it("survives an absent listing", () => {
    assert.deepEqual(summarizeSkills(undefined), [])
  })
})

describe("MCP servers", () => {
  it("puts servers needing attention above healthy ones", () => {
    const servers = summarizeMcpServers({
      ok: { status: "connected" },
      off: { status: "disabled" },
      broken: { status: "failed", error: "Operation timed out after 30000ms" },
      login: { status: "needs_auth" },
    })
    assert.deepEqual(servers.map((server) => server.name), ["broken", "login", "ok", "off"])
    assert.equal(servers[0]?.error, "Operation timed out after 30000ms")
  })

  it("sorts servers of equal status by name", () => {
    const servers = summarizeMcpServers({ b: { status: "connected" }, a: { status: "connected" } })
    assert.deepEqual(servers.map((server) => server.name), ["a", "b"])
  })

  it("keeps an unrecognized status instead of hiding the server", () => {
    const servers = summarizeMcpServers({ odd: { status: "reticulating" } })
    assert.equal(servers[0]?.status, "reticulating")
    assert.equal(mcpStatusLabel("reticulating"), "reticulating")
    assert.equal(mcpNeedsAttention("reticulating"), false)
  })

  it("marks a server with no usable status as unknown", () => {
    const servers = summarizeMcpServers({ odd: {} as never })
    assert.equal(servers[0]?.status, "unknown")
  })

  it("drops a blank error rather than showing an empty tooltip line", () => {
    const servers = summarizeMcpServers({ a: { status: "failed", error: "   " } })
    assert.equal(servers[0]?.error, undefined)
  })

  it("flags exactly the states the user must act on", () => {
    assert.equal(mcpNeedsAttention("failed"), true)
    assert.equal(mcpNeedsAttention("needs_auth"), true)
    assert.equal(mcpNeedsAttention("needs_client_registration"), true)
    assert.equal(mcpNeedsAttention("connected"), false)
    assert.equal(mcpNeedsAttention("disabled"), false)
  })

  it("summarizes counts with problems first", () => {
    assert.equal(mcpSummary([]), "No servers configured")
    assert.equal(
      mcpSummary(summarizeMcpServers({
        a: { status: "connected" }, b: { status: "connected" }, c: { status: "failed" },
      })),
      "1 failed, 2 connected",
    )
  })

  it("survives an absent status map", () => {
    assert.deepEqual(summarizeMcpServers(undefined), [])
  })
})

describe("slash command routing", () => {
  const engine = [{ name: "review" }, { name: "Init" }]

  it("accepts a command the engine registered, ignoring case", () => {
    assert.equal(isKnownCommand("review", engine), true)
    assert.equal(isKnownCommand("init", engine), true)
    assert.equal(isKnownCommand("INIT", engine), true)
  })

  it("accepts the commands the webview answers itself", () => {
    for (const name of ["new", "clear", "help", "models", "model"]) {
      assert.equal(isKnownCommand(name, []), true, name)
    }
  })

  it("rejects a name the engine does not have, which would return HTTP 500", () => {
    assert.equal(isKnownCommand("nope", engine), false)
    assert.equal(isKnownCommand("", engine), false)
    assert.equal(isKnownCommand("   ", engine), false)
  })
})
