import type { GlobalSessionInfo, HistoryGroup } from "./types"

/** Normalizes a filesystem path so Windows drive-letter and separator differences compare equal. */
export function normalizeRepositoryPath(value: string | undefined): string {
  if (!value) return ""
  const unified = value.replace(/\\/g, "/").replace(/\/+$/, "")
  return /^[a-zA-Z]:/.test(unified) ? unified.charAt(0).toLowerCase() + unified.slice(1) : unified
}

function basename(value: string): string {
  const normalized = normalizeRepositoryPath(value)
  const index = normalized.lastIndexOf("/")
  return normalized.slice(index + 1) || normalized || "Unknown repository"
}

/**
 * Picks the repository a session belongs to. The project worktree wins when it really is an
 * ancestor of the session directory, so a chat started in a subfolder still lands on its
 * repository. The engine reports a placeholder worktree for directories outside any repository,
 * which is why the session directory is the fallback.
 */
function repositoryOf(session: GlobalSessionInfo): { key: string; path: string; name?: string } {
  const directory = session.directory ?? ""
  const worktree = session.project?.worktree ?? ""
  const normalizedDirectory = normalizeRepositoryPath(directory)
  const normalizedWorktree = normalizeRepositoryPath(worktree)
  const usable = normalizedWorktree.length > 1
    && (normalizedDirectory === normalizedWorktree || normalizedDirectory.startsWith(`${normalizedWorktree}/`))
  if (usable) return { key: normalizedWorktree, path: worktree, name: session.project?.name?.trim() || undefined }
  return { key: normalizedDirectory, path: directory }
}

/**
 * Buckets sessions by repository. The workspace repository always comes first and is listed even
 * when it has no chats yet; the rest follow in most-recently-updated order.
 */
export function groupSessionsByRepository(
  sessions: readonly GlobalSessionInfo[], currentDirectory: string | undefined,
): HistoryGroup[] {
  const current = normalizeRepositoryPath(currentDirectory)
  const groups = new Map<string, HistoryGroup>()

  const ensure = (key: string, path: string, name?: string): HistoryGroup => {
    let group = groups.get(key)
    if (!group) {
      group = { key, name: name || basename(path), path, current: key === current, updated: 0, sessions: [] }
      groups.set(key, group)
    } else if (name && group.name !== name) group.name = name
    return group
  }

  if (current) ensure(current, currentDirectory ?? "")

  for (const session of sessions) {
    const repository = repositoryOf(session)
    if (!repository.key) continue
    const group = ensure(repository.key, repository.path, repository.name)
    group.sessions.push(session)
    group.updated = Math.max(group.updated, session.time.updated)
  }

  for (const group of groups.values()) group.sessions.sort((a, b) => b.time.updated - a.time.updated)
  return [...groups.values()].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    if (b.updated !== a.updated) return b.updated - a.updated
    return a.name.localeCompare(b.name)
  })
}
