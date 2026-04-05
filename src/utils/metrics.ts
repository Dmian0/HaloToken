const TOKENS_PER_LINE = 8;
const USD_PER_MILLION_TOKENS = 3;

interface CallRecord {
  command: string;
  originalLines: number;
  compressedLines: number;
  savedLines: number;
  timestamp: string;
}

class SessionMetrics {
  private calls: CallRecord[] = [];
  private readonly sessionStart: string;

  constructor() {
    this.sessionStart = new Date().toISOString();
  }

  addCall(data: Omit<CallRecord, "timestamp">) {
    this.calls.push({ ...data, timestamp: new Date().toISOString() });
  }

  getSummary() {
    const totalCalls = this.calls.length;
    const totalOriginalLines = this.calls.reduce((s, c) => s + c.originalLines, 0);
    const totalCompressedLines = this.calls.reduce((s, c) => s + c.compressedLines, 0);
    const totalSavedLines = this.calls.reduce((s, c) => s + c.savedLines, 0);
    const savingsPercent =
      totalOriginalLines > 0
        ? Math.round((totalSavedLines / totalOriginalLines) * 10000) / 100
        : 0;
    const estimatedTokensSaved = totalSavedLines * TOKENS_PER_LINE;
    const estimatedUSDSaved = (
      (estimatedTokensSaved / 1_000_000) *
      USD_PER_MILLION_TOKENS
    ).toFixed(6);

    return {
      totalCalls,
      totalOriginalLines,
      totalCompressedLines,
      totalSavedLines,
      savingsPercent,
      estimatedTokensSaved,
      estimatedUSDSaved,
      sessionStart: this.sessionStart,
      calls: this.calls,
    };
  }
}

export const metrics = new SessionMetrics();
