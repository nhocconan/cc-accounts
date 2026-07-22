// Credential store facade. Platform split: macOS uses the Keychain (parity
// with the reference zsh/Go tool); Linux and Windows use a 0600 tokens.json so
// it works headless without an OS keyring daemon.
//
// get() returns "" for a missing token (not an error); a thrown error means
// the store itself couldn't be queried.
import { get as darwinGet, set as darwinSet, del as darwinDel } from "./credstore-darwin.ts";
import { get as otherGet, set as otherSet, del as otherDel } from "./credstore-other.ts";

const isDarwin = process.platform === "darwin";

export async function get(service: string): Promise<string> {
  return isDarwin ? darwinGet(service) : otherGet(service);
}

export async function set(service: string, token: string): Promise<void> {
  return isDarwin ? darwinSet(service, token) : otherSet(service, token);
}

export async function del(service: string): Promise<void> {
  return isDarwin ? darwinDel(service) : otherDel(service);
}
