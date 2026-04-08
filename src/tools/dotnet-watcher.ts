import { execa } from "execa";
import { z } from "zod";
import { compress } from "../utils/compressor.js";

export const watchDotnetSchema = z.object({
  projectPath: z.string().describe("Path to the .NET project"),
  command: z.string().default("dotnet watch run").describe("dotnet command to run"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
});

interface DotnetWatchResult {
  status: "ready" | "error" | "timeout" | "port_in_use" | "crashed";
  url: string | null;
  buildSucceeded: boolean;
  portConflict: boolean;
  exitCode: number | null;
  suggestedAction: string | null;
  errors: string[];
  output: string;
  envVarsInjected: number;
}

const SIGNALS = {
  ready:      /Now listening on:\s*(\S+)/i,
  started:    /Application started/i,
  buildOk:    /Build succeeded/i,
  buildKo:    /Build FAILED/i,
  errorCs:    /error CS\d+/i,
  portInUse:  /address already in use/i,
  crashed:    /Exited with error code (\d+)/i,
};

async function killGracefully(proc: ReturnType<typeof execa>) {
  proc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 3000));
  try { proc.kill("SIGKILL"); } catch {}
}

export async function watchDotnet(args: z.infer<typeof watchDotnetSchema>): Promise<DotnetWatchResult> {
  const { projectPath, command, env: extraEnv } = args;
  const lines: string[] = [];
  const errors: string[] = [];
  let url: string | null = null;
  let buildSucceeded = false;
  let portConflict = false;
  let exitCode: number | null = null;
  let suggestedAction: string | null = null;
  const envVarsInjected = Object.keys(extraEnv ?? {}).length;

  return new Promise((resolve) => {
    const proc = execa(command, {
      shell: true,
      cwd: projectPath,
      all: true,
      env: { ...process.env, ...(extraEnv ?? {}) },
    });
    let settled = false;

    const settle = async (status: DotnetWatchResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await killGracefully(proc);
      const { output } = compress(lines.join("\n"));
      resolve({ status, url, buildSucceeded, portConflict, exitCode, suggestedAction, errors, output, envVarsInjected });
    };

    const timer = setTimeout(() => settle("timeout"), 90_000);

    const onLine = (line: string) => {
      lines.push(line);

      const readyMatch = line.match(SIGNALS.ready);
      if (readyMatch) url = readyMatch[1];
      if (SIGNALS.buildOk.test(line)) buildSucceeded = true;
      if (SIGNALS.errorCs.test(line))  errors.push(line.trim());

      if (SIGNALS.portInUse.test(line)) {
        portConflict = true;
        suggestedAction = "The app is already running on this port. Stop the existing instance first.";
        settle("port_in_use");
        return;
      }

      const crashMatch = line.match(SIGNALS.crashed);
      if (crashMatch) {
        exitCode = parseInt(crashMatch[1], 10);
        settle("crashed");
        return;
      }

      if (readyMatch || SIGNALS.started.test(line)) {
        settle("ready");
        return;
      }

      if (SIGNALS.buildKo.test(line)) {
        settle("error");
        return;
      }
    };

    proc.all?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    });

    proc.catch(() => settle("error"));
  });
}
