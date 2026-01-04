import { watch } from "fs";
import index from "./src/index.html";

// Build a JS script containing any browser mocking code we need for playwright
// tests
const INIT_SCRIPT_ENTRY = "./src/testing/playwright-init.ts";
const INIT_SCRIPT_OUT = "./dist";
async function buildInitScript() {
  console.log("Building playwright-init.js...");
  const result = await Bun.build({
    entrypoints: [INIT_SCRIPT_ENTRY],
    outdir: INIT_SCRIPT_OUT,
    target: "browser",
    format: "iife",
    naming: "playwright-init.js",
  });
  if (!result.success) {
    console.error("Build failed:", result.logs);
  } else {
    console.log("Build complete: dist/playwright-init.js");
  }
}
await buildInitScript();
watch("./src/testing", { recursive: true }, async (_event, filename) => {
  if (filename?.endsWith(".ts")) await buildInitScript();
});

// Serve the app with development mode (HMR for main app)
const server = Bun.serve({
  development: true,
  port: 3001,
  routes: {
    "/": index,
  },
});

console.log(`Server running at ${server.url}`);
