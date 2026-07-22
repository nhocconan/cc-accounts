import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  outExtension: () => ({ esm: ".js" }),
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  // Zero runtime deps → fully self-contained bundle.
  noExternal: [/.*/],
  shims: false,
});
