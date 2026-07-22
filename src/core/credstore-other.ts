// Linux/Windows credential store: a 0600 JSON file under the config root, the
// same model Claude Code itself uses for .credentials.json. This works headless
// (servers, CI, containers) without an OS keyring daemon.
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { configRoot } from "./paths.ts";

function tokensFile(): string {
  return join(configRoot(), "tokens.json");
}

async function readAll(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(tokensFile(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeAll(map: Record<string, string>): Promise<void> {
  await fs.mkdir(dirname(tokensFile()), { recursive: true, mode: 0o700 });
  const tmp = tokensFile() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  await fs.rename(tmp, tokensFile());
}

export async function get(service: string): Promise<string> {
  const map = await readAll();
  return map[service] || "";
}

export async function set(service: string, token: string): Promise<void> {
  const map = await readAll();
  map[service] = token;
  await writeAll(map);
}

export async function del(service: string): Promise<void> {
  const map = await readAll();
  delete map[service];
  await writeAll(map);
}
