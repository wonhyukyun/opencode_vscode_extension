export interface HistoryDeleteResult {
  deleted: string[]
  failed: { id: string; message: string }[]
}

export async function deleteHistory(
  ids: readonly string[], remove: (id: string) => Promise<unknown>,
): Promise<HistoryDeleteResult> {
  const result: HistoryDeleteResult = { deleted: [], failed: [] }
  for (const id of new Set(ids)) {
    try {
      const removed = await remove(id)
      if (removed === false) throw new Error("The engine did not delete this chat.")
      result.deleted.push(id)
    } catch (error) {
      result.failed.push({ id, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}
