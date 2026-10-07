import { statSync } from "node:fs";
import { delimiter } from "node:path";

/**
 * npm exec adds node_modules/.bin for every ancestor, even when absent.
 * Claude's Bash sandbox mounts PATH entries; bwrap cannot create these mount
 * points under unwritable parents. Keep real bins and all non-npm entries.
 */
export function sanitizeClaudePath(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (process.platform === "win32" ? key.toUpperCase() !== "PATH" : key !== "PATH") continue;
    env[key] = env[key]?.split(delimiter).filter(entry => {
      const path = entry.replace(/^"|"$/g, "");
      const npmBin = process.platform === "win32"
        ? /(?:^|[\\/])node_modules[\\/]\.bin[\\/]?$/i
        : /(?:^|\/)node_modules\/\.bin\/?$/;
      if (!npmBin.test(path)) return true;
      try { return statSync(path).isDirectory(); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code !== "ENOENT" && code !== "ENOTDIR";
      }
    }).join(delimiter);
  }
}
