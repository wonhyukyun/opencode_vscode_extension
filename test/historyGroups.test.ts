import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { groupSessionsByRepository, normalizeRepositoryPath } from "../src/historyGroups"
import type { GlobalSessionInfo, HistoryGroup } from "../src/types"

function session(
  id: string, directory: string, updated: number,
  project?: { id: string; name?: string; worktree: string },
): GlobalSessionInfo {
  return { id, title: id, directory, time: { created: updated, updated }, project: project ?? null }
}

function at(groups: HistoryGroup[], index: number): HistoryGroup {
  const group = groups[index]
  assert.ok(group, `expected a repository group at position ${index}`)
  return group
}

describe("history grouping by repository", () => {
  it("puts the current repository first even when another repository is more recent", () => {
    const groups = groupSessionsByRepository([
      session("b1", "C:\\work\\beta", 300),
      session("a1", "C:\\work\\alpha", 100),
    ], "C:\\work\\alpha")
    assert.deepEqual(groups.map((group) => group.name), ["alpha", "beta"])
    assert.equal(at(groups, 0).current, true)
    assert.equal(at(groups, 1).current, false)
  })

  it("lists the current repository even when it has no chats yet", () => {
    const groups = groupSessionsByRepository([session("b1", "C:\\work\\beta", 300)], "C:\\work\\alpha")
    assert.equal(at(groups, 0).name, "alpha")
    assert.deepEqual(at(groups, 0).sessions, [])
  })

  it("orders the remaining repositories by most recent activity and sorts chats within each", () => {
    const groups = groupSessionsByRepository([
      session("b1", "/work/beta", 100),
      session("c1", "/work/gamma", 500),
      session("b2", "/work/beta", 900),
    ], "/work/alpha")
    assert.deepEqual(groups.map((group) => group.name), ["alpha", "beta", "gamma"])
    assert.deepEqual(at(groups, 1).sessions.map((item) => item.id), ["b2", "b1"])
  })

  it("keeps a chat started in a subdirectory with its repository worktree", () => {
    const project = { id: "p1", name: "alpha", worktree: "C:\\work\\alpha" }
    const groups = groupSessionsByRepository([
      session("a1", "C:\\work\\alpha", 200, project),
      session("a2", "C:\\work\\alpha\\packages\\api", 100, project),
    ], "C:\\work\\alpha")
    assert.equal(groups.length, 1)
    assert.deepEqual(at(groups, 0).sessions.map((item) => item.id), ["a1", "a2"])
  })

  it("ignores a placeholder worktree that is not an ancestor of the chat directory", () => {
    const groups = groupSessionsByRepository([
      session("a1", "C:\\tmp\\projA", 200, { id: "global", worktree: "/" }),
      session("b1", "C:\\tmp\\projB", 100, { id: "global", worktree: "/" }),
    ], undefined)
    assert.deepEqual(groups.map((group) => group.name), ["projA", "projB"])
  })

  it("treats separator and drive-letter differences as the same repository", () => {
    const groups = groupSessionsByRepository([session("a1", "c:/work/alpha", 100)], "C:\\work\\alpha\\")
    assert.equal(groups.length, 1)
    assert.equal(at(groups, 0).current, true)
    assert.equal(at(groups, 0).sessions.length, 1)
  })

  it("prefers the project name over the folder name", () => {
    const groups = groupSessionsByRepository([
      session("a1", "/srv/checkout", 100, { id: "p1", name: "acme-web", worktree: "/srv/checkout" }),
    ], undefined)
    assert.equal(at(groups, 0).name, "acme-web")
  })

  it("normalizes trailing separators and drive letters", () => {
    assert.equal(normalizeRepositoryPath("C:\\work\\alpha\\"), "c:/work/alpha")
    assert.equal(normalizeRepositoryPath(undefined), "")
  })
})
