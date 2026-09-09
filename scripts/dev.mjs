import { spawn } from "node:child_process";
import { createServer } from "vite";
import electronPath from "electron";
await import("./build.mjs");
const server = await createServer();
await server.listen();
const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: { ...process.env, STUDIO_DEV_URL: server.resolvedUrls.local[0] },
});
child.on("error", async (error) => {
  console.error(error);
  await server.close();
  process.exit(1);
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
