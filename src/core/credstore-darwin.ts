// macOS Keychain credential store via the `security` CLI. A missing item
// (security exit 44, errSecItemNotFound) is reported as an empty token, not an
// error — matching the reference tool's contract.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Read a token from the login Keychain. Absent → ("", null). */
export async function get(service: string): Promise<string> {
  try {
    const { stdout } = await execFileP("/usr/bin/security", [
      "find-generic-password",
      "-a",
      process.env.USER || process.env.USERNAME || "claude-accounts",
      "-s",
      service,
      "-w",
    ]);
    return stdout.replace(/\r?\n$/, "");
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 44 == errSecItemNotFound. Absent token is normal, not an error.
    if (code === 44) return "";
    throw err;
  }
}

/** Store or replace (-U) a token under the service name. */
export async function set(service: string, token: string): Promise<void> {
  await execFileP("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-a",
    process.env.USER || process.env.USERNAME || "claude-accounts",
    "-s",
    service,
    "-l",
    service,
    "-w",
    token,
  ]);
}

/** Remove a token. Missing item is not an error. */
export async function del(service: string): Promise<void> {
  try {
    await execFileP("/usr/bin/security", [
      "delete-generic-password",
      "-a",
      process.env.USER || process.env.USERNAME || "claude-accounts",
      "-s",
      service,
    ]);
  } catch (err) {
    // Missing item is fine.
    const code = (err as { code?: number }).code;
    if (code === 44) return;
    throw err;
  }
}
