import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "halotoken", version: "0.1.0" },
  { capabilities: {} }
);

const transport = new StdioServerTransport();
await server.connect(transport);
