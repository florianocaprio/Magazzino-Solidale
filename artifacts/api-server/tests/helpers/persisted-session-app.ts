import { Router, type IRouter } from "express";
import { requireAuth } from "../../src/middlewares/auth";
import { makeSessionApp } from "../scope-helpers";

/** Real authorization hydration, with only the session transport stubbed. */
export function persistedSessionApp(router: IRouter, userId: number) {
  const authenticated = Router();
  authenticated.use(requireAuth, router);
  return makeSessionApp(authenticated, userId);
}
