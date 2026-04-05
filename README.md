# HaloToken

MCP Server that reduces AI agent token consumption by 80%+ by executing shell commands locally and compressing their output before returning it to the model.

## How it works

Instead of the AI agent running commands itself and receiving full verbose output, HaloToken runs them locally and applies intelligent compression: keeping error/warning lines, deduplicating, and trimming noise. Only the signal reaches the model.

## Tools

### `run_command`
Executes any shell command locally and returns compressed output.

```json
{ "command": "npm run build" }
```

Returns `originalLines`, `compressedLines`, `savedLines`, and the compressed `output`.

---

### `get_build_errors`
Auto-detects the project stack, runs a build check, and returns only parsed errors.

```json
{ "projectPath": "/path/to/project" }
```

Supported stacks and commands:

| Stack | Detection | Command |
|---|---|---|
| TypeScript | `package.json` + `typescript` dep | `npx tsc --noEmit` |
| Node | `package.json` without typescript | `node --check src/index.js` |
| Python | `requirements.txt` | `python -m py_compile *.py` |
| Rust | `Cargo.toml` | `cargo check` |
| .NET / C# | `*.csproj` or `*.sln` | `dotnet build` |

Error shapes per stack:
- **TypeScript**: `{ file, line, code, message }`
- **Python**: `{ file, line, message }`
- **.NET**: `{ file, line, column, code, severity, message }`
- **Generic**: `{ message, raw }`

---

### `watch_dotnet`
Runs `dotnet watch` and streams output until the app signals ready, a build error occurs, or 60s timeout.

```json
{ "projectPath": "/path/to/project", "command": "dotnet watch run" }
```

Returns `{ status, url, buildSucceeded, errors, output }` where `status` is `"ready"`, `"error"`, or `"timeout"`.

Signals monitored:
- `Now listening on:` → app ready, extracts URL
- `Application started` → startup complete
- `Build succeeded` / `Build FAILED` → build result
- `error CS` → compilation error

---

### `get_session_report`
Returns cumulative token savings for the current session.

```json
{}
```

```json
{
  "totalCalls": 12,
  "totalOriginalLines": 4820,
  "totalCompressedLines": 87,
  "totalSavedLines": 4733,
  "savingsPercent": 98.2,
  "estimatedTokensSaved": 37864,
  "estimatedUSDSaved": "0.000114",
  "sessionStart": "2026-04-05T00:00:00.000Z",
  "calls": [...]
}
```

Token estimate: `savedLines × 8`. USD estimate: `tokens / 1,000,000 × $3` (Claude Sonnet pricing).

---

## Setup

```bash
npm install
npm run dev      # development (tsx, no build step)
npm run build    # compile to dist/
npm start        # run compiled output
```

### Add to Claude Code

```bash
claude mcp add halotoken --scope user \
  -- npx tsx /absolute/path/to/HaloToken/src/index.ts
```

Verify with `/mcp` in a new Claude Code session — `halotoken` should appear as `connected`.

## Project structure

```
src/
├── index.ts                  # MCP server, tool registration
├── tools/
│   ├── run-command.ts        # run_command tool
│   ├── error-extractor.ts    # get_build_errors tool + stack detection
│   ├── dotnet-watcher.ts     # watch_dotnet tool
│   └── session-report.ts     # get_session_report tool
└── utils/
    ├── compressor.ts         # output compression logic
    └── metrics.ts            # session metrics singleton
```

## Compression strategy

1. If output is ≤ 20 lines → return as-is
2. Remove blank lines and consecutive duplicates
3. Keep all lines matching important patterns (errors, warnings, exceptions, .NET-specific signals)
4. Always keep the last 10 lines (tail context)
5. If result is empty → return last 5 lines
