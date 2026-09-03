import express from "express";

const app = express();

const PORT = 4000;
const HOST = "127.0.0.1";

app.use(
  express.json({
    limit: "100kb"
  })
);

app.post("/mcp", (req, res) => {
  const request = req.body;

  console.log("\n--- DOWNSTREAM MCP SERVER RECEIVED ---");
  console.log(JSON.stringify(request, null, 2));

  // Basic JSON-RPC validation
  if (
    request.jsonrpc !== "2.0" ||
    typeof request.method !== "string"
  ) {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: {
        code: -32600,
        message: "Invalid Request"
      }
    });
  }

  // MCP tools/list
  if (request.method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "get_customer_record",
            description: "Get a customer record",
            inputSchema: {
              type: "object",
              properties: {
                customer_id: {
                  type: "string"
                }
              },
              required: ["customer_id"]
            }
          },
          {
            name: "admin_reset_key",
            description: "Reset a customer API key",
            inputSchema: {
              type: "object",
              properties: {
                customer_id: {
                  type: "string"
                }
              },
              required: ["customer_id"]
            }
          }
        ]
      }
    });
  }

  // MCP tools/call
  if (request.method === "tools/call") {
    const toolName = request.params?.name;

    if (toolName === "get_customer_record") {
      return res.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: "Customer record retrieved successfully"
            }
          ]
        }
      });
    }

    if (toolName === "admin_reset_key") {
      return res.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: "Admin key reset successfully"
            }
          ]
        }
      });
    }

    return res.json({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32601,
        message: "Tool not found"
      }
    });
  }

  return res.json({
    jsonrpc: "2.0",
    id: request.id,
    error: {
      code: -32601,
      message: "Method not found"
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(
    `Mock MCP server running at http://${HOST}:${PORT}/mcp`
  );
});