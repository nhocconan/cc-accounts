// Regression guard for the "npx cc-accounts add looks frozen" bug.
//
// npm/npx render a progress spinner by repeatedly erasing the current terminal
// line (ESC[1G ESC[0K). That wipes whatever sits on the cursor's line no matter
// which stream wrote it — so a prompt written as "Name: " with no trailing
// newline is invisible by the time the user looks, and the CLI appears hung
// while it waits on stdin. Only newline-terminated text is safe.
//
// Byte-level assertions cannot catch this: the prompt IS in the output stream,
// it just is not on screen. So render the stream through a minimal terminal
// model and assert against the resulting screen.
import { describe, expect, it } from "vitest";
import { formatPrompt } from "../src/ui/select.ts";

/** Enough of a terminal to model line erasure: CSI G (column), K/J (erase). */
function renderScreen(data: string): string {
  const screen: string[][] = [[]];
  let row = 0;
  let col = 0;

  for (let i = 0; i < data.length; ) {
    const ch = data[i]!;
    if (ch === "\x1b") {
      const m = /^\x1b\[([0-9;]*)([A-Za-z])/.exec(data.slice(i));
      if (m) {
        const n = /^\d+$/.test(m[1]!) ? parseInt(m[1]!, 10) : 0;
        if (m[2] === "G") col = Math.max(0, n - 1);
        else if (m[2] === "K") {
          if (n === 0) screen[row]!.length = Math.min(screen[row]!.length, col);
          else if (n === 2) screen[row] = [];
        } else if (m[2] === "J" && n === 0) {
          screen[row]!.length = Math.min(screen[row]!.length, col);
          screen.length = row + 1;
        }
        i += m[0].length;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row += 1;
      col = 0;
      if (row >= screen.length) screen.push([]);
    } else if (ch === "\r") {
      col = 0;
    } else {
      const line = screen[row]!;
      while (line.length < col) line.push(" ");
      line[col] = ch;
      col += 1;
    }
    i += 1;
  }
  return screen.map((l) => l.join("").trimEnd()).join("\n");
}

/** One npx spinner burst: erase the cursor's line, draw a frame, repeat. */
const SPINNER = Array.from("⠙⠹⠸⠼⠴⠦⠧⠇⠙⠹")
  .map((f) => `\x1b[1G\x1b[0K${f}`)
  .join("");

describe("renderScreen", () => {
  it("models the spinner erasing an unterminated line (the actual bug)", () => {
    const screen = renderScreen("Step 1/3 — name this account\nAccount display name: " + SPINNER);
    expect(screen).toContain("Step 1/3"); // completed line survives
    expect(screen).not.toContain("Account display name"); // trailing prompt is wiped
  });
});

describe("formatPrompt", () => {
  it("ends in a newline so the spinner cannot erase the question", () => {
    expect(formatPrompt("Account display name")).toMatch(/\n$/);
  });

  it("keeps the question on screen through a spinner burst", () => {
    const screen = renderScreen(formatPrompt("Account display name") + "> " + SPINNER);
    expect(screen).toContain("Account display name");
  });

  it("keeps a defaulted question on screen too", () => {
    const out = formatPrompt("Command suffix (without claude-)", "personal");
    expect(out).toContain("[personal]");
    expect(renderScreen(out + "> " + SPINNER)).toContain("Command suffix (without claude-) [personal]");
  });
});
