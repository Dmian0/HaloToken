const IMPORTANT_PATTERNS =
  /error|warning|warn|failed|exception|cannot|not found|undefined|error CS|warning CS|warning NETSDK|warning NU|Build FAILED|Unhandled exception|at |Exception:|NullReferenceException|Object reference/i;

const MAX_BYTES = 512 * 1024;

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function compress(raw: string): { output: string; originalLines: number; compressedLines: number; truncated: boolean } {
  raw = stripAnsi(raw);

  let truncated = false;
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
    const half = Math.floor(MAX_BYTES / 2);
    const start = Buffer.from(raw).subarray(0, half).toString("utf8");
    const end = Buffer.from(raw).subarray(-half).toString("utf8");
    raw = start + "\n[...OUTPUT TRUNCATED: exceeded 512KB...]\n" + end;
    truncated = true;
  }

  const allLines = raw.split("\n");
  const originalLines = allLines.length;

  // Si el output es pequeño, devolver completo
  if (originalLines <= 20) {
    return { output: raw, originalLines, compressedLines: originalLines, truncated };
  }

  // Eliminar líneas vacías o solo espacios
  const nonEmpty = allLines.filter((line) => line.trim().length > 0);

  // Eliminar duplicados consecutivos
  const deduplicated = nonEmpty.filter((line, i) => i === 0 || line !== nonEmpty[i - 1]);

  // Líneas importantes (errores, warnings, etc.)
  const important = deduplicated.filter((line) => IMPORTANT_PATTERNS.test(line));

  // Últimas 10 líneas del output original (no vacías)
  const tail = nonEmpty.slice(-10);

  // Unir importantes + tail, deduplicar y preservar orden original
  const combined = [...new Set([...important, ...tail])].sort(
    (a, b) => deduplicated.indexOf(a) - deduplicated.indexOf(b)
  );

  // Si quedó vacío, devolver las últimas 5
  const result = combined.length > 0 ? combined : nonEmpty.slice(-5);

  return {
    output: result.join("\n"),
    originalLines,
    compressedLines: result.length,
    truncated,
  };
}
