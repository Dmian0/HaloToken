import { execa } from "execa";
import { z } from "zod";
import { compress } from "../utils/compressor.js";
import { metrics } from "../utils/metrics.js";
import { validateCommand } from "../utils/security.js";

export const runCommandSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
});

export async function runCommand(args: z.infer<typeof runCommandSchema>) {
  const { command, env: extraEnv } = args;
  const envVarsInjected = Object.keys(extraEnv ?? {}).length;

  const validation = validateCommand(command);
  if (!validation.safe) {
    return {
      success: false,
      blocked: true,
      reason: validation.reason,
      output: "",
      originalLines: 0,
      compressedLines: 0,
      savedLines: 0,
      truncated: false,
      envVarsInjected,
      command,
    };
  }

  let rawOutput = "";
  let success = true;

  try {
    const result = await execa(command, {
      shell: true,
      timeout: 30000,
      all: true,
      env: { ...process.env, ...(extraEnv ?? {}) },
    });
    rawOutput = result.all ?? result.stdout;
  } catch (err: unknown) {
    success = false;
    const execaErr = err as { all?: string; stdout?: string; stderr?: string; message?: string };
    rawOutput = execaErr.all ?? execaErr.stdout ?? execaErr.stderr ?? execaErr.message ?? String(err);
  }

  const { output, originalLines, compressedLines, truncated } = compress(rawOutput);
  const savedLines = originalLines - compressedLines;

  metrics.addCall({ command, originalLines, compressedLines, savedLines });

  return {
    success,
    output,
    originalLines,
    compressedLines,
    savedLines,
    truncated,
    envVarsInjected,
    command,
  };
}
