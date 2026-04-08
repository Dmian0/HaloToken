const TOKENS_PER_LINE = 8;
const USD_PER_MILLION_TOKENS = 3;

interface CallRecord {
  command: string;
  originalLines: number;
  compressedLines: number;
  savedLines: number;
  timestamp: string;
}

interface FileReadRecord {
  filePath: string;
  totalLines: number;
  returnedLines: number;
  timestamp: string;
}

class SessionMetrics {
  private calls: CallRecord[] = [];
  private fileReads: FileReadRecord[] = [];
  private readonly sessionStart: string;

  constructor() {
    this.sessionStart = new Date().toISOString();
  }

  addCall(data: Omit<CallRecord, "timestamp">) {
    this.calls.push({ ...data, timestamp: new Date().toISOString() });
  }

  addFileRead(data: Omit<FileReadRecord, "timestamp">) {
    this.fileReads.push({ ...data, timestamp: new Date().toISOString() });
  }

  getSummary() {
    const totalCalls = this.calls.length;
    const totalOriginalLines = this.calls.reduce((s, c) => s + c.originalLines, 0);
    const totalCompressedLines = this.calls.reduce((s, c) => s + c.compressedLines, 0);
    const totalSavedLines = this.calls.reduce((s, c) => s + c.savedLines, 0);

    const totalFileReads = this.fileReads.length;
    const totalFileLinesRead = this.fileReads.reduce((s, r) => s + r.totalLines, 0);
    const totalFileLinesReturned = this.fileReads.reduce((s, r) => s + r.returnedLines, 0);
    const totalFileLinesSaved = totalFileLinesRead - totalFileLinesReturned;

    const allSavedLines = totalSavedLines + totalFileLinesSaved;
    const allOriginalLines = totalOriginalLines + totalFileLinesRead;
    const savingsPercent =
      allOriginalLines > 0
        ? Math.round((allSavedLines / allOriginalLines) * 10000) / 100
        : 0;
    const estimatedTokensSaved = allSavedLines * TOKENS_PER_LINE;
    const estimatedUSDSaved = (
      (estimatedTokensSaved / 1_000_000) *
      USD_PER_MILLION_TOKENS
    ).toFixed(6);

    return {
      totalCalls,
      totalOriginalLines,
      totalCompressedLines,
      totalSavedLines,
      totalFileReads,
      totalFileLinesRead,
      totalFileLinesReturned,
      totalFileLinesSaved,
      savingsPercent,
      estimatedTokensSaved,
      estimatedUSDSaved,
      sessionStart: this.sessionStart,
      calls: this.calls,
      fileReads: this.fileReads,
    };
  }
}

export const metrics = new SessionMetrics();
