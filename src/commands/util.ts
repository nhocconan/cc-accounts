// Small shared helpers for command modules.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { usageDir } from "../core/paths.ts";

/** Clear the cached usage snapshot for an account (call after token change). */
export async function clearUsage(slug: string): Promise<void> {
  await fs.unlink(join(usageDir(), `${slug}.json`)).catch(() => {});
}
