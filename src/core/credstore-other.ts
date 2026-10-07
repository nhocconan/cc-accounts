// Linux/Windows credential store: a 0600 JSON file under the config root, the
// same model Claude Code itself uses for .credentials.json. This works headless
// (servers, CI, containers) without an OS keyring daemon.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { withFileLock } from "./lock.ts";
import { configRoot } from "./paths.ts";

function tokensFile(): string {
  return join(configRoot(), "tokens.json");
}

async function readAll(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(tokensFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== "string")) {
      throw new Error(`${tokensFile()} must contain a JSON object of token strings`);
    }
    return Object.assign(Object.create(null), parsed) as Record<string, string>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null) as Record<string, string>;
    throw err;
  }
}

async function writeAll(map: Record<string, string>): Promise<void> {
  await fs.mkdir(dirname(tokensFile()), { recursive: true, mode: 0o700 });
  const tmp = `${tokensFile()}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(map, null, 2), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, tokensFile());
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export async function get(service: string): Promise<string> {
  const map = await readAll();
  return Object.prototype.hasOwnProperty.call(map, service) ? map[service]! : "";
}

export async function set(service: string, token: string): Promise<void> {
  await withFileLock(tokensFile() + ".lock", async () => {
    const map = await readAll();
    map[service] = token;
    await writeAll(map);
  });
}

export async function del(service: string): Promise<void> {
  await withFileLock(tokensFile() + ".lock", async () => {
    const map = await readAll();
    delete map[service];
    await writeAll(map);
  });
}
