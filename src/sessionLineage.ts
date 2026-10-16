/**
 * Tracks which session each subagent (task) session was spawned from. The engine asks for
 * permissions in the child session, and a child session does not inherit its parent's permission
 * rules, so requests from children have to be traced back to the chat the user is looking at.
 */
export class SessionLineage {
  private readonly parents = new Map<string, string | null>()

  constructor(private readonly lookup: (sessionID: string) => Promise<{ parentID?: string } | undefined>) {}

  /** Records a parent link from session info carried by an event or response. */
  remember(info: { id?: string; parentID?: string } | undefined): void {
    if (info?.id) this.parents.set(info.id, info.parentID ?? null)
  }

  forget(sessionID: string): void {
    this.parents.delete(sessionID)
  }

  /** True when `sessionID` is `rootID` or one of its descendants. */
  async belongsTo(sessionID: string | undefined, rootID: string | undefined): Promise<boolean> {
    if (!sessionID || !rootID) return false
    const seen = new Set<string>()
    let current: string | null | undefined = sessionID
    while (current && !seen.has(current)) {
      if (current === rootID) return true
      seen.add(current)
      current = await this.parentOf(current)
    }
    return false
  }

  private async parentOf(sessionID: string): Promise<string | null> {
    if (this.parents.has(sessionID)) return this.parents.get(sessionID)!
    try {
      const info = await this.lookup(sessionID)
      if (!info) return null
      const parent = info.parentID ?? null
      this.parents.set(sessionID, parent)
      return parent
    } catch {
      return null
    }
  }
}
