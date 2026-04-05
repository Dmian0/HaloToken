import { execa } from "execa";
import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { compress } from "../utils/compressor.js";

export const getBuildErrorsSchema = z.object({
  projectPath: z.string().describe("Path to the project to analyze"),
});

interface TsError   { file: string; line: string; code: string; message: string }
interface PyError   { file: string; line: string; message: string }
interface GenError  { message: string; raw: string }

async function detectStack(projectPath: string): Promise<
  | { stack: "typescript"; command: string }
  | { stack: "node";       command: string }
  | { stack: "python";     command: string }
  | { stack: "rust";       command: string }
  | { stack: "unknown";    error: string }
> {
  const has = async (file: string) => {
    try { await readFile(join(projectPath, file)); return true; }
    catch { return false; }
  };

  if (await has("Cargo.toml"))       return { stack: "rust",   command: "cargo check 2>&1" };
  if (await has("requirements.txt")) return { stack: "python", command: "python -m py_compile *.py" };

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
  // e.g. "src/index.ts(5,3): error TS2345: Argument..."
  const re = /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  for (const m of output.matchAll(re)) {
    errors.push({ file: m[1], line: m[2], code: m[3], message: m[4] });
  }
  return errors;
}

function parsePyErrors(output: string): PyError[] {
  const errors: PyError[] = [];
  // e.g. "  File "foo.py", line 3"  followed by SyntaxError on next line
  const fileRe = /File "(.+?)",\s+line\s+(\d+)/g;
  const syntaxRe = /SyntaxError:\s+(.+)/g;
  const files = [...output.matchAll(fileRe)];
  const synErrs = [...output.matchAll(syntaxRe)];
  for (let i = 0; i < files.length; i++) {
    errors.push({ file: files[i][1], line: files[i][2], message: synErrs[i]?.[1] ?? "SyntaxError" });
  }
  return errors;
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

  let errors: TsError[] | PyError[] | GenError[];
  if (stack === "typescript") errors = parseTsErrors(rawOutput);
  else if (stack === "python")  errors = parsePyErrors(rawOutput);
  else                          errors = parseGenericErrors(rawOutput);

  const { output: buildOutput } = compress(rawOutput);

  return {
    stack,
    projectPath,
    hasErrors: errors.length > 0,
    totalErrors: errors.length,
    errors,
    buildOutput,
  };
}
