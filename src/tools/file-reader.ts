import { readFile } from "fs/promises";
import { extname } from "path";
import { z } from "zod";
import { fileCache } from "./file-cache.js";
import { metrics } from "../utils/metrics.js";

export const readFragmentSchema = z.object({
  filePath: z.string().describe("Absolute or relative path to the file"),
  query: z.string().describe("What to search for: function name, class name, or keyword"),
  contextLines: z.number().optional().default(5).describe("Lines of context above/below match"),
  maxLines: z.number().optional().default(100).describe("Maximum lines to return"),
});

type FileType = "javascript" | "csharp" | "python" | "rust" | "go" | "generic";

const EXT_MAP: Record<string, FileType> = {
  ".ts": "javascript", ".js": "javascript", ".tsx": "javascript", ".jsx": "javascript",
  ".cs": "csharp",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
};

const STRUCTURAL_PATTERNS: Record<FileType, (q: string) => RegExp[]> = {
  javascript: (q) => [
    new RegExp(`\\bfunction\\s+${q}\\b`),
    new RegExp(`\\bconst\\s+${q}\\b`),
    new RegExp(`\\bclass\\s+${q}\\b`),
    new RegExp(`\\basync\\s+${q}\\b`),
    new RegExp(`\\b${q}\\s*=>`),
  ],
  csharp: (q) => [
    new RegExp(`\\bvoid\\s+${q}\\b`),
    new RegExp(`\\basync\\s+Task.*\\b${q}\\b`),
    new RegExp(`\\bpublic\\s+.*\\b${q}\\b`),
    new RegExp(`\\bprivate\\s+.*\\b${q}\\b`),
    new RegExp(`\\bclass\\s+${q}\\b`),
  ],
  python: (q) => [
    new RegExp(`\\bdef\\s+${q}\\b`),
    new RegExp(`\\bclass\\s+${q}\\b`),
  ],
  rust: (q) => [
    new RegExp(`\\bfn\\s+${q}\\b`),
    new RegExp(`\\bstruct\\s+${q}\\b`),
    new RegExp(`\\bimpl\\s+${q}\\b`),
  ],
  go: (q) => [
    new RegExp(`\\bfunc\\s+${q}\\b`),
    new RegExp(`\\bfunc\\s+\\(.*\\)\\s+${q}\\b`),
    new RegExp(`\\btype\\s+${q}\\b`),
  ],
  generic: (q) => [new RegExp(`\\b${q}\\b`)],
};

function formatLines(lines: string[], startIdx: number): string {
  return lines
    .map((line, i) => {
      const num = String(startIdx + i + 1).padStart(4, " ");
      return `${num} | ${line}`;
    })
    .join("\n");
}

function findBlockEnd(lines: string[], startIdx: number): number {
  const startLine = lines[startIdx];
  const baseIndent = startLine.search(/\S/);
  let braceDepth = 0;
  let foundOpen = false;

  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{" || ch === "(") { braceDepth++; foundOpen = true; }
      if (ch === "}" || ch === ")") braceDepth--;
    }
    if (foundOpen && braceDepth <= 0) return i;

    // Indentation-based fallback (Python, etc.)
    if (i > startIdx && !foundOpen) {
      const trimmed = lines[i].trim();
      if (trimmed.length > 0 && lines[i].search(/\S/) <= baseIndent) {
        return i - 1;
      }
    }
  }
  return Math.min(startIdx + 50, lines.length - 1);
}

export async function readFragment(args: z.infer<typeof readFragmentSchema>) {
  const { filePath, query, contextLines, maxLines } = args;
  const fileType: FileType = EXT_MAP[extname(filePath)] ?? "generic";

  // Read file with cache
  let lines: string[];
  const cached = fileCache.get(filePath);
  if (cached && !(await fileCache.hasChanged(filePath))) {
    lines = cached.lines;
  } else {
    const content = await readFile(filePath, "utf-8");
    lines = fileCache.set(filePath, content).lines;
  }

  const totalFileLines = lines.length;

  // --- Structural search ---
  const patterns = STRUCTURAL_PATTERNS[fileType](query);
  let structuralIdx = -1;
  for (const pat of patterns) {
    const idx = lines.findIndex((l) => pat.test(l));
    if (idx !== -1) { structuralIdx = idx; break; }
  }

  if (structuralIdx !== -1) {
    const blockEnd = findBlockEnd(lines, structuralIdx);
    const start = Math.max(0, structuralIdx - contextLines);
    const end = Math.min(lines.length - 1, blockEnd + contextLines);
    const slice = lines.slice(start, Math.min(end + 1, start + maxLines));
    const returnedLines = slice.length;

    metrics.addFileRead({ filePath, totalLines: totalFileLines, returnedLines });

    return {
      filePath, query, found: true,
      matchType: "structural" as const,
      fileType, totalFileLines, returnedLines,
      savedLines: totalFileLines - returnedLines,
      content: formatLines(slice, start),
      lineStart: start + 1,
      lineEnd: start + returnedLines,
    };
  }

  // --- Keyword search ---
  const lowerQuery = query.toLowerCase();
  const matchIndices = lines
    .map((l, i) => (l.toLowerCase().includes(lowerQuery) ? i : -1))
    .filter((i) => i !== -1);

  if (matchIndices.length > 0) {
    const fragments: string[] = [];
    let totalReturned = 0;

    for (let m = 0; m < matchIndices.length && totalReturned < maxLines; m++) {
      const idx = matchIndices[m];
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(lines.length - 1, idx + contextLines);
      const remaining = maxLines - totalReturned;
      const slice = lines.slice(start, Math.min(end + 1, start + remaining));

      if (matchIndices.length > 1) {
        fragments.push(`--- match ${m + 1} ---\n${formatLines(slice, start)}`);
      } else {
        fragments.push(formatLines(slice, start));
      }
      totalReturned += slice.length;
    }

    const returnedLines = totalReturned;
    metrics.addFileRead({ filePath, totalLines: totalFileLines, returnedLines });

    return {
      filePath, query, found: true,
      matchType: "keyword" as const,
      fileType, totalFileLines, returnedLines,
      savedLines: totalFileLines - returnedLines,
      content: fragments.join("\n"),
      lineStart: Math.max(0, matchIndices[0] - contextLines) + 1,
      lineEnd: Math.min(lines.length, matchIndices[matchIndices.length - 1] + contextLines + 1),
    };
  }

  // --- Fallback ---
  const fallbackSlice = lines.slice(0, 50);
  const returnedLines = fallbackSlice.length;

  metrics.addFileRead({ filePath, totalLines: totalFileLines, returnedLines });

  return {
    filePath, query, found: false,
    matchType: "fallback" as const,
    fileType, totalFileLines, returnedLines,
    savedLines: totalFileLines - returnedLines,
    content: formatLines(fallbackSlice, 0),
    lineStart: 1,
    lineEnd: returnedLines,
  };
}
