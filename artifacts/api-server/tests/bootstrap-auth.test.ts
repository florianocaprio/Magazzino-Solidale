import { describe, expect, it } from "vitest";
import { isBootstrapAllowedRequest } from "../src/middlewares/auth";

/**
 * The first-run bootstrap surface must be minimal: an unauthenticated visitor on
 * a fresh install may ONLY read the available roles, read the users already
 * created, and create a new user. Everything else stays behind authentication
 * even before the first admin exists.
 */
describe("isBootstrapAllowedRequest", () => {
  it("allows the requests the setup screen needs", () => {
    expect(isBootstrapAllowedRequest("GET", "/ruoli")).toBe(true);
    expect(isBootstrapAllowedRequest("GET", "/utenti")).toBe(true);
    expect(isBootstrapAllowedRequest("POST", "/utenti")).toBe(true);
    expect(isBootstrapAllowedRequest("POST", "/utenti/")).toBe(true);
  });

  it("blocks user mutations other than create, and single-record reads", () => {
    expect(isBootstrapAllowedRequest("GET", "/utenti/5")).toBe(false);
    expect(isBootstrapAllowedRequest("PATCH", "/utenti/5")).toBe(false);
    expect(isBootstrapAllowedRequest("DELETE", "/utenti/5")).toBe(false);
    expect(isBootstrapAllowedRequest("POST", "/utenti/5/reset-password")).toBe(
      false,
    );
  });

  it("blocks every role mutation and single-record reads (roles are read-only list during bootstrap)", () => {
    expect(isBootstrapAllowedRequest("GET", "/ruoli/2")).toBe(false);
    expect(isBootstrapAllowedRequest("POST", "/ruoli")).toBe(false);
    expect(isBootstrapAllowedRequest("PATCH", "/ruoli/2")).toBe(false);
    expect(isBootstrapAllowedRequest("DELETE", "/ruoli/2")).toBe(false);
  });

  it("blocks unrelated business endpoints", () => {
    expect(isBootstrapAllowedRequest("GET", "/dashboard")).toBe(false);
    expect(isBootstrapAllowedRequest("GET", "/beneficiari")).toBe(false);
    expect(isBootstrapAllowedRequest("POST", "/lotti")).toBe(false);
    expect(isBootstrapAllowedRequest("GET", "/")).toBe(false);
  });
});
