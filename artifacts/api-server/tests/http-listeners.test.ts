import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { httpListeners } from "./helpers/http-listeners";

const listeners = httpListeners();
afterEach(async () => listeners.close());

describe("lifecycle HTTP posseduto dallo scenario", () => {
  it("riusa il listener e drena due richieste realmente sovrapposte prima del cleanup", async () => {
    let entered!: () => void;
    const bothEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const release: Array<() => void> = [];
    const app = express();
    app.post("/command", (_req, res) => {
      release.push(() => res.status(200).json({ ok: true }));
      if (release.length === 2) entered();
    });
    const server = await listeners.open(app, () => app);
    const second = await listeners.open(app, () => {
      throw new Error("La stessa app non deve creare un secondo listener");
    });
    expect(second).toBe(server);
    const pending = [server, second].map((target) =>
      request(target)
        .post("/command")
        .then((response) => response),
    );
    let closing: Promise<void> | undefined;
    try {
      await bothEntered;
      expect(listeners.inspect(server)).toMatchObject({
        active: 2,
        requests: 2,
        lifecycle: "listening",
      });
      closing = listeners.close();
      // Observe the state transition; one assumed microtask is not a barrier.
      await expect
        .poll(() => listeners.inspect(server).lifecycle)
        .toBe("draining");
      expect(server.listening).toBe(true);
      expect(listeners.inspect(server)).toMatchObject({
        active: 2,
        lifecycle: "draining",
      });
      expect(() => listeners.open("late", () => app)).toThrow(
        "Cannot open a test listener during teardown",
      );
    } finally {
      release.forEach((done) => done());
      const responses = await Promise.all(pending);
      await closing;
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
    }
    expect(server.listening).toBe(false);
  });

  it("propaga ECONNRESET senza retry né falso successo e consente il teardown", async () => {
    let attempts = 0;
    const app = express();
    app.post("/command", (req) => {
      attempts++;
      req.socket.destroy();
    });
    const server = await listeners.open(app, () => app);
    await expect(request(server).post("/command")).rejects.toMatchObject({
      code: "ECONNRESET",
      message: "socket hang up",
    });
    expect(attempts).toBe(1);
    await listeners.close();
    expect(server.listening).toBe(false);
  });

  it("mantiene distinte le app degli attori e riapre uno scenario senza cache residua", async () => {
    const actorApp = (actor: string) => {
      const app = express();
      app.get("/actor", (_req, res) => res.json({ actor }));
      return app;
    };
    const first = await listeners.open("ordinary", () => actorApp("ordinary"));
    const second = await listeners.open("other", () => actorApp("other"));
    expect(first).not.toBe(second);
    const responses = await Promise.all([
      request(first).get("/actor"),
      request(second).get("/actor"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.actor)).toEqual([
      "ordinary",
      "other",
    ]);
    await listeners.close();
    expect(first.listening).toBe(false);
    expect(second.listening).toBe(false);
    const reopened = await listeners.open("ordinary", () => actorApp("new"));
    expect(reopened).not.toBe(first);
    const response = await request(reopened).get("/actor");
    expect(response.status).toBe(200);
    expect(response.body.actor).toBe("new");
  });
});
