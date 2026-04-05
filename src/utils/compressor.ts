const IMPORTANT_PATTERNS =
  /error|warning|warn|failed|exception|cannot|not found|undefined|error CS|warning CS|Build FAILED|Unhandled exception|at |Exception:|NullReferenceException|Object reference/i;

export function compress(raw: string): { output: string; originalLines: number; compressedLines: number } {
  const allLines = raw.split("\n");
  const originalLines = allLines.length;

  // Si el output es pequeño, devolver completo
  if (originalLines <= 20) {
    return { output: raw, originalLines, compressedLines: originalLines };
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
  };
}
