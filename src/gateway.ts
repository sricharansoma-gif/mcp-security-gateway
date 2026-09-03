import express, {
  Request,
  Response,
  NextFunction
} from "express";

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = 3000;
const HOST = "127.0.0.1";

const DOWNSTREAM_URL =
  process.env.DOWNSTREAM_URL || "http://127.0.0.1:4000/mcp";

type UserRole = "admin" | "viewer";

interface AuthenticatedRequest extends Request {
  userRole?: UserRole;
}

const tokenRoles: Record<string, UserRole> = {
  "admin-token": "admin",
  "viewer-token": "viewer"
};


/*
 * Authentication middleware
 */
function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: "Missing Authorization header"
      }
    });
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: "Invalid Authorization header"
      }
    });
  }

  const role = tokenRoles[token];

  if (!role) {
    return res.status(401).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: "Invalid bearer token"
      }
    });
  }

  req.userRole = role;

  next();
}


/*
 * Forward an allowed request to the downstream MCP server
 */
async function forwardRequest(
  req: Request,
  res: Response
) {
  try {
    const downstreamResponse = await axios.post(
      DOWNSTREAM_URL,
      req.body,
      {
        headers: {
          "Content-Type": "application/json"
        },

        timeout: 5000,

        validateStatus: () => true
      }
    );

    return res
      .status(downstreamResponse.status)
      .json(downstreamResponse.data);

  } catch (error) {
    console.error("Downstream MCP server error");

    return res.status(502).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32002,
        message: "Downstream MCP server unavailable"
      }
    });
  }
}


/*
 * Parse JSON request bodies
 */
app.use(
  express.json({
    limit: "100kb"
  })
);


/*
 * MCP Gateway endpoint
 */
app.post(
  "/mcp",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {

    const rpcRequest = req.body;

    /*
     * Basic JSON-RPC validation
     */
    if (
      rpcRequest.jsonrpc !== "2.0" ||
      typeof rpcRequest.method !== "string"
    ) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id: rpcRequest.id ?? null,
        error: {
          code: -32600,
          message: "Invalid JSON-RPC Request"
        }
      });
    }


    /*
     * tools/list is allowed and forwarded
     * to the downstream MCP server
     */
    if (rpcRequest.method === "tools/list") {

      console.log(
        `[ALLOW] role=${req.userRole} method=tools/list`
      );

      return forwardRequest(req, res);
    }
    if (rpcRequest.method === "tools/call") {

  const toolName = rpcRequest.params?.name;

  /*
   * Make sure a tool name was actually provided.
   */
  if (typeof toolName !== "string") {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: rpcRequest.id ?? null,
      error: {
        code: -32602,
        message: "Invalid params: tool name is required"
      }
    });
  }

  /*
   * Any tool beginning with "admin_"
   * requires the admin role.
   */
  if (
    toolName.startsWith("admin_") &&
    req.userRole !== "admin"
  ) {
    console.log(
      `[BLOCK] role=${req.userRole} tool=${toolName}`
    );

    return res.json({
      jsonrpc: "2.0",
      id: rpcRequest.id ?? null,
      error: {
        code: -32001,
        message: "Unauthorized Tool Call"
      }
    });
  }

  /*
   * If we reach here, the call is authorized.
   */
  console.log(
    `[ALLOW] role=${req.userRole} tool=${toolName}`
  );

  return forwardRequest(req, res);
}

    /*
     * Other methods are not implemented yet.
     * We will add tools/call next.
     */
    return res.status(400).json({
      jsonrpc: "2.0",
      id: rpcRequest.id ?? null,
      error: {
        code: -32601,
        message: "Method not implemented by gateway yet"
      }
    });
  }
);


app.listen(PORT, HOST, () => {
  console.log(
    `MCP Security Gateway running at http://${HOST}:${PORT}/mcp`
  );

  console.log(
    `Forwarding allowed requests to ${DOWNSTREAM_URL}`
  );
});