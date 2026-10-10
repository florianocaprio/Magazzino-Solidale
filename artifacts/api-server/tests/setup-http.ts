import { afterAll } from "vitest";
import { installSupertestLoopbackAddress } from "./helpers/supertest-loopback";

// Test-only: no runtime patch, dependency edit, retry or response substitution.
const restore = installSupertestLoopbackAddress();
afterAll(restore);
