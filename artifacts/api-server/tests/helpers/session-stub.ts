import type { RequestHandler } from "express";
import { loadSessionUser } from "../../src/middlewares/auth";

/** Fresh synthetic session for route tests; revocation tests use a real store. */
export function sessionStub(userId: number): RequestHandler {
  return async (req, _res, next) => {
    const user = await loadSessionUser(userId);
    req.session = {
      userId,
      passwordVersion: user?.passwordVersion,
    } as typeof req.session;
    next();
  };
}
