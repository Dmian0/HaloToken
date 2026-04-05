import { execa } from "execa";
import { z } from "zod";
import { compress } from "../utils/compressor.js";
import { metrics } from "../utils/metrics.js";

export const runCommandSchema = z.object({
  command: z.string().describe("Shell command to execute"),
});

export async function runCommand(args: z.infer<typeof runCommandSchema>) {
  const { command } = args;

  let rawOutput = "";
  let success = true;

  try {
    const result = await execa(command, {
      shell: true,
      timeout: 30000,
      all: true,
    });
    rawOutput = result.all ?? result.stdout;
  } catch (err: unknown) {
    success = false;
    const execaErr = err as { all?: string; stdout?: string; stderr?: string; message?: string };
    rawOutput = execaErr.all ?? execaErr.stdout ?? execaErr.stderr ?? execaErr.message ?? String(err);
  }

  const { output, originalLines, compressedLines } = compress(rawOutput);
  const savedLines = originalLines - compressedLines;

  metrics.addCall({ command, originalLines, compressedLines, savedLines });

  return {
    success,
    output,
    originalLines,
    compressedLines,
    savedLines,
    command,
  };
}
