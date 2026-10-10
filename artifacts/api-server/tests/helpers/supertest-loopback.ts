import request from "supertest";

/**
 * Supertest 7 builds an IPv4 URL even when listen(0) opened an IPv6 server.
 * On dual-stack hosts that port can belong to a different IPv4 listener.
 * Keep the actual server lifecycle and route unchanged; align only loopback.
 */
export function installSupertestLoopbackAddress() {
  const prototype = request.Test.prototype;
  const original = prototype.serverAddress;
  const aligned: typeof original = function (this: request.Test, app, path) {
    const url = original.call(this, app, path);
    const address =
      typeof app !== "string" && "address" in app ? app.address() : null;
    if (
      address &&
      typeof address !== "string" &&
      address.family === "IPv6" &&
      (address.address === "::" || address.address === "::1")
    ) {
      return url.replace("://127.0.0.1:", "://[::1]:");
    }
    return url;
  };
  prototype.serverAddress = aligned;
  return () => {
    prototype.serverAddress = original;
  };
}
