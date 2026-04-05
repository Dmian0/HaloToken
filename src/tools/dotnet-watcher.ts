import { execa } from "execa";
import { z } from "zod";
import { compress } from "../utils/compressor.js";

export const watchDotnetSchema = z.object({
  projectPath: z.string().describe("Path to the .NET project"),
  command: z.string().default("dotnet watch run").describe("dotnet command to run"),
});

interface DotnetWatchResult {
  status: "ready" | "error" | "timeout";
  url: string | null;
  buildSucceeded: boolean;
  errors: string[];
  output: string;
}

const SIGNALS = {
  ready:   /Now listening on:\s*(\S+)/i,
  started: /Application started/i,
  buildOk: /Build succeeded/i,
  buildKo: /Build FAILED/i,
  errorCs: /error CS\d+/i,
};

export async function watchDotnet(args: z.infer<typeof watchDotnetSchema>): Promise<DotnetWatchResult> {
  const { projectPath, command } = args;
  const lines: string[] = [];
  const errors: string[] = [];
  let url: string | null = null;
  let buildSucceeded = false;

  return new Promise((resolve) => {
    const proc = execa(command, { shell: true, cwd: projectPath, all: true });
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        const { output } = compress(lines.join("\n"));
        resolve({ status: "timeout", url, buildSucceeded, errors, output });
      }
    }, 60_000);

    const onLine = (line: string) => {
      lines.push(line);

      const readyMatch = line.match(SIGNALS.ready);
      if (readyMatch) {
        url = readyMatch[1];
      }
      if (SIGNALS.buildOk.test(line)) buildSucceeded = true;
      if (SIGNALS.errorCs.test(line))  errors.push(line.trim());

      if (readyMatch || SIGNALS.started.test(line)) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          proc.kill();
          const { output } = compress(lines.join("\n"));
          resolve({ status: "ready", url, buildSucceeded, errors, output });
        }
      }

      if (SIGNALS.buildKo.test(line)) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          proc.kill();
          const { output } = compress(lines.join("\n"));
          resolve({ status: "error", url, buildSucceeded, errors, output });
        }
      }
    };

    proc.all?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    });

    proc.catch(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const { output } = compress(lines.join("\n"));
        resolve({ status: "error", url, buildSucceeded, errors, output });
      }
    });
  });
}
