import { readFileSync } from "node:fs";

// Resolved at build time by tsup; source execution reads package metadata.
export const VERSION: string = typeof __CCA_VERSION__ !== "undefined"
  ? __CCA_VERSION__
  : JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
declare const __CCA_VERSION__: string;
