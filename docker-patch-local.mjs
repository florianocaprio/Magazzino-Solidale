import fs from "fs";

const appPath = "artifacts/api-server/src/app.ts";
let app = fs.readFileSync(appPath, "utf8");

app = app.replace(
  'sameSite: "none", secure: true,',
  'sameSite: process.env.COOKIE_SAMESITE === "lax" ? "lax" : "none", secure: process.env.COOKIE_SECURE === "true",'
);

fs.writeFileSync(appPath, app);
console.log("Patch cookie locale applicata.");
