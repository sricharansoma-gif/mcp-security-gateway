import dotenv from "dotenv";

import { createApp } from "./app.js";

dotenv.config();

const PORT = 3000;
const HOST = "127.0.0.1";
const DOWNSTREAM_URL =
  process.env.DOWNSTREAM_URL || "http://127.0.0.1:4000/mcp";

const app = createApp({ downstreamUrl: DOWNSTREAM_URL });

app.listen(PORT, HOST, () => {
  console.log(`MCP Security Gateway running at http://${HOST}:${PORT}/mcp`);
});
