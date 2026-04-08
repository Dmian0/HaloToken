import { execa } from "execa";
import { readFile } from "fs/promises";
import { glob } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { compress } from "../utils/compressor.js";

export const getBuildErrorsSchema = z.object({
  projectPath: z.string().describe("Path to the project to analyze"),
});

interface TsError     { file: string; line: string; code: string; message: string }
interface PyError     { file: string; line: string; message: string }
interface DotnetError   { file: string; line: string; column: string; code: string; message: string; severity: "error" | "warning" }
interface DotnetWarning { file: string; line: string; code: string; message: string; raw: string }
interface GenError      { message: string; raw: string }

async function detectStack(projectPath: string): Promise<
  | { stack: "typescript"; command: string }
  | { stack: "node";       command: string }
  | { stack: "python";     command: string }
  | { stack: "rust";       command: string }
  | { stack: "dotnet";     command: string }
  | { stack: "unknown";    error: string }
> {
  const has = async (file: string) => {
    try { await readFile(join(projectPath, file)); return true; }
    catch { return false; }
  };

  // Busca .csproj o .sln (pueden tener cualquier nombre)
  const hasDotnet = async () => {
    try {
      for await (const _ of glob("*.{csproj,sln}", { cwd: projectPath })) return true;
      return false;
    } catch { return false; }
  };

  if (await has("Cargo.toml"))       return { stack: "rust",   command: "cargo check 2>&1" };
  if (await has("requirements.txt")) return { stack: "python", command: "python -m py_compile *.py" };
  if (await hasDotnet())             return { stack: "dotnet", command: "dotnet build 2>&1" };

  if (await has("package.json")) {
    const raw = await readFile(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const hasTs = "typescript" in (pkg.dependencies ?? {}) || "typescript" in (pkg.devDependencies ?? {});
    if (hasTs) return { stack: "typescript", command: "npx tsc --noEmit" };
    return { stack: "node", command: "node --check src/index.js" };
  }

  return { stack: "unknown", error: "No recognizable stack found" };
}

function parseTsErrors(output: string): TsError[] {
  const errors: TsError[] = [];
  const re = /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  for (const m of output.matchAll(re)) {
    errors.push({ file: m[1], line: m[2], code: m[3], message: m[4] });
  }
  return errors;
}

function parsePyErrors(output: string): PyError[] {
  const errors: PyError[] = [];
  const fileRe = /File "(.+?)",\s+line\s+(\d+)/g;
  const syntaxRe = /SyntaxError:\s+(.+)/g;
  const files = [...output.matchAll(fileRe)];
  const synErrs = [...output.matchAll(syntaxRe)];
  for (let i = 0; i < files.length; i++) {
    errors.push({ file: files[i][1], line: files[i][2], message: synErrs[i]?.[1] ?? "SyntaxError" });
  }
  return errors;
}

function parseDotnetErrors(output: string): { errors: DotnetError[]; warnings: DotnetWarning[] } {
  const errors: DotnetError[] = [];
  const warnings: DotnetWarning[] = [];
  const seenWarnings = new Set<string>();

  const addWarning = (w: DotnetWarning) => {
    // Deduplicate by raw line (dotnet emits same warning in restore + build phases)
    if (seenWarnings.has(w.raw)) return;
    seenWarnings.add(w.raw);
    warnings.push(w);
  };

  // Compilation errors/warnings with file location and CS code
  // e.g. "src/Foo.cs(12,5): error CS0103: The name 'bar' does not exist"
  const csRe = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(CS\d+):\s+(.+)$/gm;
  for (const m of output.matchAll(csRe)) {
    const entry = {
      file: m[1].trim(),
      line: m[2],
      column: m[3],
      severity: m[4] as "error" | "warning",
      code: m[5],
      message: m[6],
    };
    if (entry.severity === "error") {
      errors.push(entry);
    } else {
      addWarning({ file: entry.file, line: entry.line, code: entry.code, message: entry.message, raw: m[0] });
    }
  }

  // SDK warnings with file location
  // e.g. ".../targets(32,5): warning NETSDK1138: The target framework..."
  const sdkLocRe = /^(.+?)\((\d+),\d+\):\s+warning\s+(NETSDK\d+):\s+(.+)$/gm;
  for (const m of output.matchAll(sdkLocRe)) {
    addWarning({ file: m[1].trim(), line: m[2], code: m[3], message: m[4], raw: m[0] });
  }

  // NuGet/SDK warnings without file location (path : warning CODE: message)
  // e.g. "Avents.csproj : warning NU1902: Package 'Azure.Identity'..."
  const nuRe = /^(.+?)\s*:\s*warning\s+(NU\d+|NETSDK\d+):\s+(.+)$/gm;
  for (const m of output.matchAll(nuRe)) {
    addWarning({ file: m[1].trim(), line: "", code: m[2], message: m[3], raw: m[0] });
  }

  // Generic warnings (filepath(line,col): warning : message) — no code
  const genWarnRe = /^(.+?)\((\d+),\d+\):\s+warning\s*:\s+(.+)$/gm;
  for (const m of output.matchAll(genWarnRe)) {
    addWarning({ file: m[1].trim(), line: m[2], code: "", message: m[3], raw: m[0] });
  }

  // Tests fallidos
  for (const line of output.split("\n")) {
    if (/\bFAILED\b/.test(line) && !errors.some((e) => e.message === line.trim())) {
      errors.push({ file: "", line: "", column: "", severity: "error", code: "TEST", message: line.trim() });
    }
  }

  // Errores de runtime
  for (const line of output.split("\n")) {
    if (/^(Error\b|Unhandled exception)/.test(line.trim())) {
      errors.push({ file: "", line: "", column: "", severity: "error", code: "RUNTIME", message: line.trim() });
    }
  }

  return { errors, warnings };
}

function parseGenericErrors(output: string): GenError[] {
  return output
    .split("\n")
    .filter((l) => /error:/i.test(l))
    .map((raw) => ({ message: raw.replace(/^.*?error:\s*/i, "").trim(), raw }));
}

export async function getBuildErrors(args: z.infer<typeof getBuildErrorsSchema>) {
  const { projectPath } = args;

  const detection = await detectStack(projectPath);

  if (detection.stack === "unknown") {
    return { stack: "unknown", projectPath, error: detection.error };
  }

  const { stack, command } = detection;

  let rawOutput = "";
  try {
    const result = await execa(command, { shell: true, cwd: projectPath, all: true, reject: false });
    rawOutput = result.all ?? result.stdout + "\n" + result.stderr;
  } catch (err: unknown) {
    const e = err as { all?: string; message?: string };
    rawOutput = e.all ?? e.message ?? String(err);
  }

  let errors: TsError[] | PyError[] | DotnetError[] | GenError[];
  let warnings: DotnetWarning[] = [];

  if (stack === "typescript")  errors = parseTsErrors(rawOutput);
  else if (stack === "python") errors = parsePyErrors(rawOutput);
  else if (stack === "dotnet") {
    const parsed = parseDotnetErrors(rawOutput);
    errors = parsed.errors;
    warnings = parsed.warnings;
  }
  else                         errors = parseGenericErrors(rawOutput);

  const { output: buildOutput } = compress(rawOutput);

  return {
    stack,
    projectPath,
    hasErrors: errors.length > 0,
    hasWarnings: warnings.length > 0,
    totalErrors: errors.length,
    totalWarnings: warnings.length,
    errors,
    warnings,
    buildOutput,
  };
}
