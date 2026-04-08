# HaloToken

**MCP Server that cuts AI agent token usage by 80%+**

![version](https://img.shields.io/badge/version-0.1.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)

## The problem

When Claude Code works on your project, it reads entire files and receives raw command outputs. A 2,000-line lock file, a 400-line controller, a verbose build log — all of it gets sent to the model as-is. That is wasted context window. HaloToken sits between the agent and your system, compressing outputs and extracting only the lines that matter before they reach the model.

## Real-world results

Tested on **Avents**, a production .NET 6 / ASP.NET Core application:

| Input | Raw lines | HaloToken lines | Reduction |
|---|---|---|---|
| `Program.cs` (read_fragment) | 356 | 21 | 94% |
| `package-lock.json` (run_command) | 1,941 | 19 | 99% |
| `dotnet build` warnings (get_build_errors) | 83 | 18 parsed | warnings only |

Tokens saved in a single task: **~2,680**. Response time: **34s** with HaloToken vs 41s without.

## Installation

```bash
git clone https://github.com/Dmian0/HaloToken.git && cd HaloToken
npm install
```

Register as an MCP server in Claude Code:

```bash
claude mcp add halotoken --scope user \
  -- npx tsx /absolute/path/to/HaloToken/src/index.ts
```

Open a new Claude Code session and run `/mcp`. You should see `halotoken` listed as `connected`.

## Tools

| Tool | Description |
|---|---|
| `run_command` | Executes a shell command locally and returns compressed output with ANSI stripping and security validation. |
| `get_build_errors` | Auto-detects the project stack, runs a build check, and returns only parsed errors and warnings. |
| `watch_dotnet` | Starts `dotnet watch` and streams output until the app is ready, a build fails, or timeout (90s). |
| `read_fragment` | Reads a file and returns only the function, class, or keyword you asked for — not the whole file. |
| `get_session_report` | Returns cumulative token savings metrics for the current session. |

## Usage example

In a Claude Code session with HaloToken connected:

```
Check the Avents project using HaloToken tools. 
Use get_build_errors with the project path, then use 
read_fragment to find the HandleLogin function in 
AuthController.cs. Finally run get_session_report.
```

Claude Code calls:

```json
// Step 1: detect stack and parse errors
get_build_errors({ "projectPath": "/path/to/Avents" })
// → { stack: "dotnet", hasErrors: false, hasWarnings: true, totalWarnings: 18 }

// Step 2: read only the relevant function
read_fragment({ "filePath": "Controllers/AuthController.cs", "query": "HandleLogin" })
// → 21 lines returned out of 356 (94% saved)
```

The model never sees the other 335 lines.

## Supported stacks

| Stack | Detection | Build command |
|---|---|---|
| TypeScript | `package.json` + `typescript` in deps | `npx tsc --noEmit` |
| Node.js | `package.json` without typescript | `node --check src/index.js` |
| Python | `requirements.txt` | `python -m py_compile *.py` |
| Rust | `Cargo.toml` | `cargo check` |
| .NET / C# | `*.csproj` or `*.sln` | `dotnet build` |

## How it works

**Command compression.** When `run_command` executes a shell command, the raw output goes through a pipeline: ANSI escape codes are stripped, outputs exceeding 512KB are truncated from the middle, blank and duplicate lines are removed, and only lines matching error/warning patterns plus the last 10 lines are kept. A `package-lock.json` cat that would send 1,941 lines to the model becomes 19.

**Smart file reading.** `read_fragment` does not send the whole file. It detects the file type by extension, tries a structural search first (function/class definitions using language-specific patterns), falls back to keyword search with context lines, and only as a last resort returns the first 50 lines. Results include line numbers for navigation. A file cache with MD5 hashing avoids re-reading files that have not changed on disk.

**Session metrics.** Every call to `run_command` and `read_fragment` is tracked. `get_session_report` returns totals for lines processed, lines returned, lines saved, estimated tokens saved (at 8 tokens/line), and estimated USD saved. This gives you a concrete measure of how much context window HaloToken is recovering per session.

## Project structure

```
src/
├── index.ts                  # MCP server entry point, tool registration
├── tools/
│   ├── run-command.ts        # run_command — shell execution + compression
│   ├── error-extractor.ts    # get_build_errors — stack detection + error parsing
│   ├── dotnet-watcher.ts     # watch_dotnet — live .NET dev server monitoring
│   ├── file-reader.ts        # read_fragment — structural + keyword file search
│   ├── file-cache.ts         # In-memory file cache with MD5 change detection
│   └── session-report.ts     # get_session_report — metrics endpoint
└── utils/
    ├── compressor.ts         # Output compression pipeline
    ├── metrics.ts            # Session metrics singleton
    └── security.ts           # Command validation and blocklist
```

## License

MIT
