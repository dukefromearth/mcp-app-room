import http from "node:http";
import { describe, expect, it } from "vitest";
import { RealMcpSessionFactory } from "../src/mcp";
import { resolveHttpAuthStrategy } from "../src/mcp-auth";
import { RoomStore } from "../src/store";

type AuthRequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void;

describe("HTTP auth strategy handling", () => {
  it("matches auth strategy by URL boundary instead of raw prefix only", () => {
    const strategy = resolveHttpAuthStrategy("https://api.example.com/v1/mcp", {
      "https://api.example.com": {
        type: "bearer",
        token: "base-token",
      },
      "https://api.example.com/v1/": {
        type: "bearer",
        token: "v1-token",
      },
    });

    expect(strategy).toMatchObject({
      type: "bearer",
      token: "v1-token",
    });
  });

  it("does not match auth strategy for lookalike hostnames", () => {
    const strategy = resolveHttpAuthStrategy(
      "https://api.example.com.evil/mcp",
      {
        "https://api.example.com": {
          type: "bearer",
          token: "sensitive-token",
        },
      },
    );

    expect(strategy).toEqual({ type: "none" });
  });

  it("returns AUTH_REQUIRED when auth is required and no strategy is configured", async () => {
    await withAuthServer((_, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    }, async (url) => {
      const store = new RoomStore(new RealMcpSessionFactory());

      await expect(store.inspectServer(url)).rejects.toMatchObject({
        statusCode: 401,
        code: "AUTH_REQUIRED",
      });
    });
  });

  it("returns AUTH_FAILED when bearer strategy is configured but token is rejected", async () => {
    await withAuthServer((req, res) => {
      if (req.headers.authorization !== "Bearer good-token") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }, async (url) => {
      const store = new RoomStore(
        new RealMcpSessionFactory({
          httpAuthConfig: {
            [new URL(url).origin]: {
              type: "bearer",
              token: "bad-token",
            },
          },
        }),
      );

      await expect(store.inspectServer(url)).rejects.toMatchObject({
        statusCode: 401,
        code: "AUTH_FAILED",
      });
    });
  });

  it("returns AUTH_REQUIRED when bearer strategy is configured with an empty token", async () => {
    const store = new RoomStore(
      new RealMcpSessionFactory({
        httpAuthConfig: {
          "http://127.0.0.1:65535/": {
            type: "bearer",
            token: "   ",
          },
        },
      }),
    );

    await expect(store.inspectServer("http://127.0.0.1:65535/mcp")).rejects.toMatchObject({
      statusCode: 401,
      code: "AUTH_REQUIRED",
    });
  });

  it("returns AUTH_DISCOVERY_FAILED when oauth strategy is configured", async () => {
    const store = new RoomStore(
      new RealMcpSessionFactory({
        httpAuthConfig: {
          "http://127.0.0.1:65535/": {
            type: "oauth",
            issuer: "https://issuer.example.com",
          },
        },
      }),
    );

    await expect(store.inspectServer("http://127.0.0.1:65535/mcp")).rejects.toMatchObject({
      statusCode: 501,
      code: "AUTH_DISCOVERY_FAILED",
    });
  });
});

async function withAuthServer(
  onRequest: AuthRequestHandler,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(onRequest);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to bind test auth server");
  }

  const url = `http://127.0.0.1:${address.port}/mcp`;

  try {
    await run(url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
