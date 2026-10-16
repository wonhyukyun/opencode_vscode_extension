interface QuestionClient {
  replyQuestion(requestID: string, answers: string[][]): Promise<boolean>
  rejectQuestion(requestID: string): Promise<boolean>
}

export class QuestionResponder {
  private readonly pending = new Set<string>()

  constructor(
    private readonly client: () => Promise<QuestionClient>,
    private readonly post: (message: { type: string; requestID: string; message?: string }) => void,
  ) {}

  async reply(requestID: string, answers?: string[][]): Promise<void> {
    if (this.pending.has(requestID)) return
    this.pending.add(requestID)
    this.post({ type: "questionSubmitting", requestID })
    try {
      const client = await this.client()
      if (answers) await client.replyQuestion(requestID, answers)
      else await client.rejectQuestion(requestID)
      this.post({ type: "questionResolved", requestID })
    } catch (error) {
      this.post({ type: "questionFailed", requestID, message: error instanceof Error ? error.message : String(error) })
    } finally {
      this.pending.delete(requestID)
    }
  }
}
