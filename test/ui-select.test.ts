import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { select, promptLine, pressEnter } from "../src/ui/select.ts";

const mocks = vi.hoisted(() => ({ readline: vi.fn() }));
vi.mock("node:readline", () => ({ createInterface: mocks.readline }));
vi.mock("node:child_process", () => ({
  execFile: (_: unknown, __: unknown, callback: (error: Error) => void) => callback(new Error("no fzf")),
  spawn: vi.fn(),
}));

const originalInput = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const originalOutput = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
function tty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}
afterEach(() => {
  vi.restoreAllMocks();
  if (originalInput) Object.defineProperty(process.stdin, "isTTY", originalInput);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  if (originalOutput) Object.defineProperty(process.stdout, "isTTY", originalOutput);
  else Reflect.deleteProperty(process.stdout, "isTTY");
});

describe("menu input", () => {
  it("repaints in place and restores raw mode on cancellation", async () => {
    const input = new EventEmitter();
    Object.assign(input, { isTTY: true, isRaw: true, setRawMode: vi.fn(), resume: vi.fn(), pause: vi.fn() });
    vi.spyOn(process, "stdin", "get").mockReturnValue(input as typeof process.stdin);
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const result = select(["Work", "Personal"], { header: "Accounts" });
    await new Promise((resolve) => setImmediate(resolve));
    input.emit("data", Buffer.from("\x1b[B"));
    expect(write.mock.calls.some(([text]) => text === "\x1b[4A")).toBe(true);
    input.emit("data", Buffer.from("q"));
    await expect(result).resolves.toEqual({ ok: false });
    expect((input as unknown as { setRawMode: ReturnType<typeof vi.fn> }).setRawMode).toHaveBeenLastCalledWith(true);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
  });

  it("cancels numbered selection on EOF", async () => {
    tty(false);
    const rl = new EventEmitter();
    Object.assign(rl, { question: vi.fn(), close: vi.fn() });
    mocks.readline.mockReturnValue(rl);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const result = select(["Work"]);
    rl.emit("close");
    await expect(result).resolves.toEqual({ ok: false });
  });

  it("rejects partial numeric choices", async () => {
    tty(false);
    const rl = new EventEmitter();
    Object.assign(rl, { question: (_: string, cb: (s: string) => void) => cb("1junk"), close: vi.fn() });
    mocks.readline.mockReturnValue(rl);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await expect(select(["Work"])).resolves.toEqual({ ok: false });
  });

  it.each([promptLine, pressEnter])("rejects closed interactive input", async (prompt) => {
    tty(true);
    const rl = new EventEmitter();
    Object.assign(rl, { question: vi.fn(), close: vi.fn() });
    mocks.readline.mockReturnValue(rl);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const result = prompt("Continue");
    rl.emit("close");
    await expect(result).rejects.toThrow("input closed");
  });
});
