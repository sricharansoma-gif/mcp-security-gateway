import axios from "axios";
import express, { NextFunction, Request, Response } from "express";

type UserRole = "admin" | "viewer";

interface AuthenticatedRequest extends Request {
  userRole?: UserRole;
}

export interface DownstreamRequest {
  url: string;
  body: unknown;
  headers: Record<string, string>;
  timeout: number;
}

export interface DownstreamResponse {
  status: number;
  data: unknown;
}

export type DownstreamForwarder = (
  request: DownstreamRequest
) => Promise<DownstreamResponse>;

export interface CreateAppOptions {
  downstreamUrl: string;
  forwarder?: DownstreamForwarder;
}

const tokenRoles: Record<string, UserRole> = {
  "admin-token": "admin",
  "viewer-token": "viewer"
};

const axiosForwarder: DownstreamForwarder = async (request) => {
  const response = await axios.post(request.url, request.body, {
    headers: request.headers,
    timeout: request.timeout,
    validateStatus: () => true
  });

  return { status: response.status, data: response.data };
};

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
      error: { code: -32000, message: "Missing Authorization header" }
    });
  }

  const match = /^Bearer ([^\s]+)$/.exec(authHeader);

  if (!match) {
    return res.status(401).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32000, message: "Invalid Authorization header" }
    });
  }

  const role = tokenRoles[match[1]];

  if (!role) {
    return res.status(401).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32000, message: "Invalid bearer token" }
    });
  }

  req.userRole = role;
  next();
}

export function createApp(options: CreateAppOptions) {
  const app = express();
  const forwarder = options.forwarder ?? axiosForwarder;

  app.use(express.json({ limit: "100kb" }));

  app.post(
    "/mcp",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      const rpcRequest = req.body;

      if (
        !rpcRequest ||
        typeof rpcRequest !== "object" ||
        rpcRequest.jsonrpc !== "2.0" ||
        typeof rpcRequest.method !== "string" ||
        rpcRequest.method.length === 0
      ) {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: rpcRequest?.id ?? null,
          error: { code: -32600, message: "Invalid JSON-RPC Request" }
        });
      }

      if (rpcRequest.method === "tools/call") {
        const toolName = rpcRequest.params?.name;

        if (typeof toolName !== "string" || toolName.trim().length === 0) {
          return res.status(400).json({
            jsonrpc: "2.0",
            id: rpcRequest.id ?? null,
            error: {
              code: -32602,
              message: "Invalid params: tool name is required"
            }
          });
        }

        if (toolName.startsWith("admin_") && req.userRole !== "admin") {
          console.log(`[BLOCK] role=${req.userRole} method=tools/call`);

          return res.json({
            jsonrpc: "2.0",
            id: rpcRequest.id ?? null,
            error: { code: -32001, message: "Unauthorized Tool Call" }
          });
        }
      } else if (rpcRequest.method !== "tools/list") {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: rpcRequest.id ?? null,
          error: {
            code: -32601,
            message: "Method not implemented by gateway yet"
          }
        });
      }

      console.log(`[ALLOW] role=${req.userRole} method=${rpcRequest.method}`);

      try {
        const downstreamResponse = await forwarder({
          url: options.downstreamUrl,
          body: rpcRequest,
          headers: { "Content-Type": "application/json" },
          timeout: 5000
        });

        return res
          .status(downstreamResponse.status)
          .json(downstreamResponse.data);
      } catch {
        console.error("Downstream MCP server error");

        return res.status(502).json({
          jsonrpc: "2.0",
          id: rpcRequest.id ?? null,
          error: {
            code: -32002,
            message: "Downstream MCP server unavailable"
          }
        });
      }
    }
  );

  return app;
}
