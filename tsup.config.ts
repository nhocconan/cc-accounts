import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  define: { __CCA_VERSION__: JSON.stringify(version) },
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  outExtension: () => ({ esm: ".js" }),
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __ccaCreateRequire } from "node:module";\nconst require = __ccaCreateRequire(import.meta.url);' },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  // Bundle runtime dependencies into the published CLI.
  noExternal: [/.*/],
  shims: true,
});
