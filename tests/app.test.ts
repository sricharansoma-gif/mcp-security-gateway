import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  createApp,
  DownstreamRequest,
  DownstreamResponse
} from "../src/app.js";

const DOWNSTREAM_URL = "http://127.0.0.1:4000/mcp";

const listRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {}
};

function successfulForwarder() {
  return vi.fn(
    async (_request: DownstreamRequest): Promise<DownstreamResponse> => ({
      status: 200,
      data: { jsonrpc: "2.0", id: 1, result: { tools: [] } }
    })
  );
}

function appWith(forwarder = successfulForwarder()) {
  return {
    app: createApp({ downstreamUrl: DOWNSTREAM_URL, forwarder }),
    forwarder
  };
}

function authenticatedPost(app: ReturnType<typeof createApp>, token: string) {
  return request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${token}`);
}

describe("authentication", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const { app, forwarder } = appWith();
    const response = await request(app).post("/mcp").send(listRequest);

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Missing Authorization header");
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed Authorization header", async () => {
    const { app, forwarder } = appWith();
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Basic viewer-token")
      .send(listRequest);

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Invalid Authorization header");
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown bearer token", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "unknown-token").send(
      listRequest
    );

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Invalid bearer token");
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("authenticates a valid viewer token", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "viewer-token").send(
      listRequest
    );

    expect(response.status).toBe(200);
    expect(forwarder).toHaveBeenCalledOnce();
  });

  it("authenticates a valid admin token", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "admin-token").send(
      listRequest
    );

    expect(response.status).toBe(200);
    expect(forwarder).toHaveBeenCalledOnce();
  });
});

describe("authorization", () => {
  it("allows a viewer to call a normal tool", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "viewer-token").send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_customer_record" }
    });

    expect(response.status).toBe(200);
    expect(forwarder).toHaveBeenCalledOnce();
  });

  it("blocks a viewer from calling an admin tool", async () => {
    const { app } = appWith();
    const response = await authenticatedPost(app, "viewer-token").send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "admin_reset_key" }
    });

    expect(response.status).toBe(200);
    expect(response.body.error).toEqual({
      code: -32001,
      message: "Unauthorized Tool Call"
    });
  });

  it("allows an admin to call an admin tool", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "admin-token").send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "admin_reset_key" }
    });

    expect(response.status).toBe(200);
    expect(forwarder).toHaveBeenCalledOnce();
  });

  it("blocks an unauthorized admin call before forwarding", async () => {
    const { app, forwarder } = appWith();
    await authenticatedPost(app, "viewer-token").send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "admin_delete_everything" }
    });

    expect(forwarder).not.toHaveBeenCalled();
  });
});

describe("JSON-RPC and input validation", () => {
  it("returns 400 for an invalid JSON-RPC version", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "viewer-token").send({
      ...listRequest,
      jsonrpc: "1.0"
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(-32600);
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or invalid method", async () => {
    const { app, forwarder } = appWith();
    const missing = await authenticatedPost(app, "viewer-token").send({
      jsonrpc: "2.0",
      id: 6
    });
    const invalid = await authenticatedPost(app, "viewer-token").send({
      jsonrpc: "2.0",
      id: 7,
      method: 42
    });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(missing.body.error.code).toBe(-32600);
    expect(invalid.body.error.code).toBe(-32600);
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("returns 400 when tools/call has no valid tool name", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "viewer-token").send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "" }
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(-32602);
    expect(forwarder).not.toHaveBeenCalled();
  });
});

describe("forwarding and security", () => {
  it("enforces the 100 KB JSON request-body limit", async () => {
    const { app, forwarder } = appWith();
    const response = await authenticatedPost(app, "viewer-token").send({
      ...listRequest,
      params: { value: "x".repeat(101 * 1024) }
    });

    expect(response.status).toBe(413);
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("forwards tools/list for an authenticated caller", async () => {
    const { app, forwarder } = appWith();
    await authenticatedPost(app, "viewer-token").send(listRequest);

    expect(forwarder).toHaveBeenCalledWith(
      expect.objectContaining({ body: listRequest })
    );
  });

  it("forwards an authorized tools/call", async () => {
    const { app, forwarder } = appWith();
    const body = {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "get_customer_record" }
    };
    await authenticatedPost(app, "viewer-token").send(body);

    expect(forwarder).toHaveBeenCalledWith(
      expect.objectContaining({ body })
    );
  });

  it("never forwards the Authorization header downstream", async () => {
    const { app, forwarder } = appWith();
    await authenticatedPost(app, "viewer-token").send(listRequest);

    const downstreamRequest = forwarder.mock.calls[0][0];
    expect(downstreamRequest.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(Object.keys(downstreamRequest.headers).map((key) => key.toLowerCase()))
      .not.toContain("authorization");
  });

  it("returns a sanitized 502 when downstream forwarding fails", async () => {
    const forwarder = vi.fn(async (): Promise<DownstreamResponse> => {
      throw new Error("connect ECONNREFUSED at secret.internal:4000");
    });
    const { app } = appWith(forwarder);
    const response = await authenticatedPost(app, "viewer-token").send(
      listRequest
    );

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32002,
        message: "Downstream MCP server unavailable"
      }
    });
  });

  it("does not expose raw downstream errors or stack traces", async () => {
    const rawError = "credential=super-secret\n    at downstream.ts:99:1";
    const forwarder = vi.fn(async (): Promise<DownstreamResponse> => {
      throw new Error(rawError);
    });
    const { app } = appWith(forwarder);
    const response = await authenticatedPost(app, "viewer-token").send(
      listRequest
    );

    expect(response.text).not.toContain("super-secret");
    expect(response.text).not.toContain("downstream.ts");
    expect(response.text).not.toContain("stack");
  });

  it("uses the server-controlled URL even when client input includes a URL", async () => {
    const { app, forwarder } = appWith();
    await authenticatedPost(app, "viewer-token").send({
      ...listRequest,
      url: "https://attacker.example/mcp",
      downstreamUrl: "https://attacker.example/override"
    });

    expect(forwarder.mock.calls[0][0].url).toBe(DOWNSTREAM_URL);
    expect(forwarder.mock.calls[0][0].timeout).toBe(5000);
  });
});
