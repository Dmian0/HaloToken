import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runCommand, runCommandSchema } from "./tools/run-command.js";
import { getSessionReport } from "./tools/session-report.js";
import { getBuildErrors, getBuildErrorsSchema } from "./tools/error-extractor.js";
import { watchDotnet, watchDotnetSchema } from "./tools/dotnet-watcher.js";
import { readFragment, readFragmentSchema } from "./tools/file-reader.js";

const server = new Server(
  { name: "halotoken", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run_command",
      description:
        "Executes a shell command locally and returns a compressed output to minimize token usage.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          env: { type: "object", description: "Additional environment variables", additionalProperties: { type: "string" } },
        },
        required: ["command"],
      },
    },
    {
      name: "get_session_report",
      description: "Returns token savings report for current session.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_build_errors",
      description:
        "Auto-detects the project stack (TypeScript, Node, Python, Rust, .NET) and runs a build check, returning only the parsed errors with compressed output.",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Path to the project to analyze" },
        },
        required: ["projectPath"],
      },
    },
    {
      name: "watch_dotnet",
      description:
        "Runs a dotnet watch command and streams output until the app is ready, a build error occurs, or timeout is reached.",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Path to the .NET project" },
          command: {
            type: "string",
            description: "dotnet command to run (default: dotnet watch run)",
          },
          env: { type: "object", description: "Additional environment variables", additionalProperties: { type: "string" } },
        },
        required: ["projectPath"],
      },
    },
    {
      name: "read_fragment",
      description:
        "Reads a specific fragment of a file based on a query (function name, class name, or keyword), returning only the relevant lines with context to minimize token usage.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or relative path to the file" },
          query: { type: "string", description: "What to search for: function name, class name, or keyword" },
          contextLines: { type: "number", description: "Lines of context above/below match (default: 5)" },
          maxLines: { type: "number", description: "Maximum lines to return (default: 100)" },
        },
        required: ["filePath", "query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "run_command") {
    const args = runCommandSchema.parse(request.params.arguments);
    const result = await runCommand(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  if (request.params.name === "get_session_report") {
    const result = await getSessionReport();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  if (request.params.name === "get_build_errors") {
    const args = getBuildErrorsSchema.parse(request.params.arguments);
    const result = await getBuildErrors(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  if (request.params.name === "watch_dotnet") {
    const args = watchDotnetSchema.parse(request.params.arguments);
    const result = await watchDotnet(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  if (request.params.name === "read_fragment") {
    const args = readFragmentSchema.parse(request.params.arguments);
    const result = await readFragment(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
