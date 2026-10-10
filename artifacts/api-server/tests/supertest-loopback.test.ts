import { createServer, type ListenOptions, type Server } from "node:net";
import { createServer as createHttpServer } from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

const servers: Server[] = [];
async function listen(server: Server, options: ListenOptions) {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected an IP test listener");
  return address;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          if (!server.listening) return resolve();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("Supertest raggiunge la famiglia IP del listener effettivo", () => {
  it.each(["404", "reset"])(
    "non raggiunge il listener IPv4 estraneo sulla stessa porta (%s)",
    async (mode) => {
      let foreignRequests = 0;
      let expectedRequests = 0;
      const foreign = createHttpServer((req, res) => {
        foreignRequests++;
        if (mode === "reset") req.socket.destroy();
        else res.writeHead(404).end("wrong listener");
      });
      const address = await listen(foreign, { port: 0, host: "127.0.0.1" });
      const expected = createHttpServer((req, res) => {
        expectedRequests++;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ listener: "IPv6", path: req.url }));
      });
      await listen(expected, {
        port: address.port,
        host: "::1",
        ipv6Only: true,
      });
      const response = await request(expected).get("/probe?q=a%2Fb");
      expect(response.status, response.text).toBe(200);
      expect(response.body).toEqual({
        listener: "IPv6",
        path: "/probe?q=a%2Fb",
      });
      expect(expectedRequests).toBe(1);
      expect(foreignRequests).toBe(0);
    },
  );

  it("preserva cookie e sessione di un agent sul listener IPv6", async () => {
    const app = createHttpServer((req, res) => {
      if (req.url === "/login") {
        res.setHeader("set-cookie", "test_session=synthetic; Path=/; HttpOnly");
        res.end("login");
      } else {
        res.statusCode =
          req.headers.cookie === "test_session=synthetic" ? 200 : 401;
        res.end("protected");
      }
    });
    await listen(app, { port: 0, host: "::1", ipv6Only: true });
    const agent = request.agent(app);
    expect((await agent.post("/login")).status).toBe(200);
    expect((await agent.get("/protected")).status).toBe(200);
  });

  it("non altera URL espliciti IPv4 o sopprime errori reali", async () => {
    let attempts = 0;
    const app = createServer((socket) => {
      attempts++;
      socket.destroy();
    });
    const address = await listen(app, { port: 0, host: "127.0.0.1" });
    await expect(
      request(`http://127.0.0.1:${address.port}`).get("/probe"),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(attempts).toBe(1);
  });
});
