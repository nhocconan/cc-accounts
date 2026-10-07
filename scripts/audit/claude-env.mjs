import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// AGENTS.md §1: both Claude environment builders must sanitize npm PATH bins.
const sites = [
  ["src/core/launcher.ts", "buildEnv"],
  ["src/commands/add.ts", "scrubbedEnv"],
];
function guarded(source, name) {
  const body = source.match(new RegExp(`export function ${name}\\([^]*?\\n\\}`))?.[0];
  return Boolean(body && /sanitizeClaudePath\(env\);\s*return env;/.test(body));
}
if (process.argv.includes("--self-test")) {
  const good = "export function fixture() {\n  sanitizeClaudePath(env);\n  return env;\n}";
  if (!guarded(good, "fixture") || guarded(good.replace("sanitizeClaudePath(env);", ""), "fixture")) {
    throw new Error("Claude environment audit self-test failed");
  }
}
let failed = false;
function forcesScrub(source) {
  return /(?:\.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB|\[\s*["']CLAUDE_CODE_SUBPROCESS_ENV_SCRUB["']\s*\])\s*=/.test(source);
}
if (process.argv.includes("--self-test")) {
  if (!forcesScrub('env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1";') || forcesScrub('const value = env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB;')) {
    throw new Error("Subprocess isolation audit self-test failed");
  }
}
for (const [file, name] of sites) {
  const source = readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
  if (forcesScrub(source)) {
    console.error(`${file}: violates AGENTS.md §2; preserve the user's subprocess scrub mode instead of assigning it.`);
    failed = true;
  }
  if (guarded(source, name)) continue;
  console.error(`${file}: ${name} violates AGENTS.md §1; call sanitizeClaudePath(env) immediately before returning the Claude environment.`);
  failed = true;
}
if (failed) process.exitCode = 1;
