import type { Express, Request, RequestHandler } from "express";
import { createServer, type IncomingMessage, type Server } from "node:http";

type Trace = {
  method?: string;
  originalUrl: string;
  routers: string[];
  superAdminGuardPresent?: boolean;
  actorSuperAdmin?: boolean;
  bodyError?: string;
  route?: string;
  status?: number;
  contentType?: string;
};

const redactedUrl = (value: string) => {
  const url = new URL(value, "http://127.0.0.1");
  for (const key of [...url.searchParams.keys()])
    url.searchParams.set(key, "[redacted]");
  return url.pathname + url.search;
};

/** Supertest must not own/close a different ephemeral listener per request. */
export function httpListeners(options: { diagnostics?: string } = {}) {
  const listeners = new Map<unknown, Promise<Server>>();
  const traces = new WeakMap<IncomingMessage, Trace>();
  const capturedResponses = new WeakSet<object>();
  const states = new Map<
    Server,
    {
      id: string;
      lifecycle: "listening" | "draining" | "closed";
      active: number;
      requests: number;
      idle: Array<() => void>;
      last?: Trace;
    }
  >();
  let sequence = 0;
  let closing: Promise<void> | undefined;
  const diagnostic = (server: Server, event: string, trace?: Trace) => {
    if (options.diagnostics)
      console.error(
        "TEST_HTTP_LIFECYCLE",
        JSON.stringify({
          harness: options.diagnostics,
          listener: states.get(server)?.id,
          event,
          lifecycle: states.get(server)?.lifecycle,
          active: states.get(server)?.active,
          ...trace,
        }),
      );
  };
  return {
    inspect(server: Server) {
      const state = states.get(server);
      if (!state) throw new Error("Unowned test listener");
      const { idle: _idle, ...snapshot } = state;
      return snapshot;
    },
    /** Records entry into the actual router, never its protected payload. */
    router(
      name: string,
      handler: RequestHandler,
      superAdminGuardPresent?: boolean,
    ): RequestHandler {
      return (req, res, next) => {
        const trace = traces.get(req);
        if (trace) {
          trace.routers.push(name);
          if (superAdminGuardPresent !== undefined) {
            trace.superAdminGuardPresent = superAdminGuardPresent;
            trace.actorSuperAdmin = req.user?.isSuperAdmin;
          }
          if (options.diagnostics && !capturedResponses.has(res)) {
            capturedResponses.add(res);
            const json = res.json;
            res.json = function (body) {
              // Error field only: never record items, metadata, cookies or tokens.
              if (this.statusCode >= 400 && typeof body?.error === "string")
                trace.bodyError = body.error
                  .replace(
                    /https?:\/\/\S+|\S+@\S+|(?:token|password|secret)\s*[=:]\s*\S+/gi,
                    "[redacted]",
                  )
                  .slice(0, 250);
              return json.call(this, body);
            };
          }
        }
        return handler(req, res, next);
      };
    },
    open(key: unknown, build: () => Express): Promise<Server> {
      if (closing)
        throw new Error("Cannot open a test listener during teardown");
      let listener = listeners.get(key);
      if (!listener) {
        listener = new Promise<Server>((resolve, reject) => {
          const server = createServer(build());
          const state = {
            id: `${options.diagnostics ?? "test"}:${++sequence}`,
            lifecycle: "listening" as const,
            active: 0,
            requests: 0,
            idle: [] as Array<() => void>,
            last: undefined as Trace | undefined,
          };
          states.set(server, state);
          server.prependListener("request", (req, res) => {
            state.active++;
            state.requests++;
            const trace: Trace = {
              method: req.method,
              originalUrl: redactedUrl(req.url ?? "/"),
              routers: [],
            };
            traces.set(req, trace);
            let completed = false;
            const complete = () => {
              if (completed) return;
              completed = true;
              state.active--;
              trace.route = (req as Request).route?.path;
              trace.status = res.statusCode;
              trace.contentType = String(res.getHeader("content-type") ?? "");
              state.last = trace;
              if (res.statusCode >= 400 || !res.writableFinished)
                diagnostic(
                  server,
                  res.writableFinished ? "response-error" : "response-aborted",
                  trace,
                );
              if (state.active === 0)
                state.idle.splice(0).forEach((done) => done());
            };
            res.once("finish", complete);
            res.once("close", complete);
          });
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (
              !address ||
              typeof address === "string" ||
              address.address !== "127.0.0.1"
            )
              return reject(new Error("Unexpected test listener binding"));
            state.id += `:${address.port}`;
            diagnostic(server, "opened");
            resolve(server);
          });
        });
        listeners.set(key, listener);
      }
      return listener;
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
        const servers = await Promise.all(listeners.values());
        await Promise.all(
          servers.map(async (server) => {
            const state = states.get(server)!;
            state.lifecycle = "draining";
            if (state.active)
              await new Promise<void>((resolve) => state.idle.push(resolve));
            await new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
              server.closeIdleConnections();
            });
            state.lifecycle = "closed";
            diagnostic(server, "closed");
            states.delete(server);
          }),
        );
        listeners.clear();
      })();
      try {
        await closing;
      } finally {
        closing = undefined;
      }
    },
  };
}
