# MCP Security Gateway

A lightweight TypeScript security gateway that sits in front of an MCP server and enforces role-based authorization on MCP tool calls.

The gateway authenticates incoming requests using Bearer tokens, validates JSON-RPC requests, inspects MCP tool calls, blocks unauthorized administrative operations, and forwards authorized requests to a downstream MCP server.

## Architecture

```text
Client
  |
  | POST /mcp
  | Authorization: Bearer <token>
  v
+-------------------------+
| MCP Security Gateway    |
| 127.0.0.1:3000          |
|                         |
| 1. Authenticate token   |
| 2. Determine role       |
| 3. Validate JSON-RPC    |
| 4. Inspect tool name    |
| 5. Authorize request    |
+------------+------------+
             |
             | Authorized requests only
             v
+-------------------------+
| Mock MCP Server         |
| 127.0.0.1:4000/mcp      |
+-------------------------+
```

## Authorization Rules

The demo gateway supports two roles:

| Token | Role |
|---|---|
| `viewer-token` | viewer |
| `admin-token` | admin |

Normal tools can be called by either role.

Tools whose names begin with `admin_` require the `admin` role.

```text
viewer + get_customer_record -> ALLOWED

viewer + admin_reset_key     -> BLOCKED

admin  + admin_reset_key     -> ALLOWED
```

When a viewer attempts to call an administrative tool, the gateway returns:

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "error": {
    "code": -32001,
    "message": "Unauthorized Tool Call"
  }
}
```

The unauthorized request is rejected before it reaches the downstream MCP server.

## Tech Stack

- Node.js
- TypeScript
- Express
- Axios
- dotenv

## Project Structure

```text
mcp-security-gateway/
├── src/
│   ├── gateway.ts
│   └── mock-server.ts
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

## Setup

Install dependencies:

```bash
npm install
```

Create the local environment file:

```bash
cp .env.example .env
```

Default configuration:

```env
DOWNSTREAM_URL=http://127.0.0.1:4000/mcp
```

## Run the Mock MCP Server

Open one terminal:

```bash
npm run dev:mock
```

The mock server runs at:

```text
http://127.0.0.1:4000/mcp
```

## Run the Security Gateway

Open another terminal:

```bash
npm run dev:gateway
```

The gateway runs at:

```text
http://127.0.0.1:3000/mcp
```

Clients should send requests to port `3000`. Authorized requests are then forwarded to port `4000`.

## Test tools/list

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 10,
    "method": "tools/list",
    "params": {}
  }'
```

The gateway authenticates and forwards the request to the downstream MCP server.

## Test Normal Tool as Viewer

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 20,
    "method": "tools/call",
    "params": {
      "name": "get_customer_record",
      "arguments": {
        "customer_id": "CUST-123"
      }
    }
  }'
```

Expected result: the request is allowed and forwarded downstream.

## Test Admin Tool as Viewer

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer viewer-token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 21,
    "method": "tools/call",
    "params": {
      "name": "admin_reset_key",
      "arguments": {
        "customer_id": "CUST-123"
      }
    }
  }'
```

Expected response:

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "error": {
    "code": -32001,
    "message": "Unauthorized Tool Call"
  }
}
```

The gateway logs:

```text
[BLOCK] role=viewer tool=admin_reset_key
```

The downstream MCP server does not receive this request.

## Test Admin Tool as Admin

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin-token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 22,
    "method": "tools/call",
    "params": {
      "name": "admin_reset_key",
      "arguments": {
        "customer_id": "CUST-123"
      }
    }
  }'
```

Expected result: the request is authorized and forwarded downstream.

## Build and Type Check

Compile TypeScript:

```bash
npm run build
```

Check TypeScript without generating files:

```bash
npm run typecheck
```

## Security Considerations

The gateway includes several security and reliability controls:

- Bearer-token authentication before request processing.
- Role-based authorization for protected `admin_*` tools.
- Unauthorized admin calls are blocked before downstream forwarding.
- JSON request bodies are limited to 100 KB.
- Downstream HTTP requests have a 5-second timeout.
- Bearer credentials are not blindly forwarded downstream.
- Raw internal errors and stack traces are not returned to clients.
- The downstream URL comes from server-controlled configuration rather than client input, reducing SSRF risk.
- `.env`, `node_modules`, `dist`, and `.DS_Store` are excluded from Git.

The static `viewer-token` and `admin-token` values are demonstration credentials only.

In production, authentication would normally use signed JWT or OAuth access tokens validated against a trusted identity provider, with roles or scopes derived from verified claims.

## Dependency Security

Check installed dependencies for known vulnerabilities:

```bash
npm audit
```

During development, the project reported:

```text
found 0 vulnerabilities
```