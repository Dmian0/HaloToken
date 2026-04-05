import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runCommand, runCommandSchema } from "./tools/run-command.js";
import { getSessionReport } from "./tools/session-report.js";

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
        },
        required: ["command"],
      },
    },
    {
      name: "get_session_report",
      description: "Returns token savings report for current session.",
      inputSchema: { type: "object", properties: {} },
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
  throw new Error(`Unknown tool: ${request.params.name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
