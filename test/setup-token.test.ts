// Scraping the token off `claude setup-token`'s TUI output. The fixtures below
// mirror bytes observed from claude 2.1.217: 24-bit color runs, cursor moves
// mid-token, an OSC-8 hyperlink block for the auth URL, and — the whole reason
// this code exists — the token hard-wrapped across two lines at terminal width.
import { describe, expect, it } from "vitest";
import { extractToken, stripAnsi } from "../src/commands/add.ts";

const ESC = "\x1b";
const TOKEN_A = "sk-ant-oat01-PsmbVmd67wvLJjFqQbepm8MlGXJOVa9umYAaXRkIJGDB6RQi0zMa_vfleKJ0YppG-r";
const TOKEN_B = "ve00rRPhs03Rkluh7P1g-m7p4agAA";

/** The real shape: color, first line, cursor-down, space, color, remainder. */
const WRAPPED =
  `${ESC}[?2026l${ESC}[?25h` +
  `${ESC}[38;2;78;186;101m✓ Long-lived authentication token created successfully!${ESC}[39m\n` +
  ` Your OAuth token (valid for 1 year):${ESC}[K\n` +
  `${ESC}[38;2;255;193;7m${TOKEN_A}${ESC}[1B${ESC}[39m ` +
  `${ESC}[38;2;255;193;7m${TOKEN_B}${ESC}[1C${ESC}[2B` +
  `${ESC}[38;2;153;153;153mStore this token securely. You won't be able to see it again.${ESC}[39m\n` +
  `${ESC}[2GUse${ESC}[6Gthis${ESC}[11Gtoken${ESC}[17Gby${ESC}[20Gsetting:${ESC}[29Gexport` +
  `${ESC}[36GCLAUDE_CODE_OAUTH_TOKEN=<token>${ESC}[39m\n`;

/** The OSC-8 hyperlink emitted before login — must never be mistaken for a token. */
const AUTH_URL_BLOCK =
  `${ESC}]8;id=829qcd;https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a` +
  `&code_challenge=b6V_b6SvL9H82SkOCFYHrPKIDJaCIaJ6KwujijZetFs${ESC}\\` +
  `${ESC}[38;2;153;153;153mhttps://claude.com/cai/oauth/authorize?code=true${ESC}[39m${ESC}]8;;${ESC}\\`;

describe("stripAnsi", () => {
  it("removes CSI, OSC hyperlinks, and charset selectors", () => {
    const out = stripAnsi(AUTH_URL_BLOCK + WRAPPED);
    expect(out).not.toContain(ESC);
    expect(out).toContain("Long-lived authentication token created successfully!");
  });
});

describe("extractToken", () => {
  it("rejoins a token wrapped across two terminal lines", () => {
    expect(extractToken(WRAPPED)).toBe(TOKEN_A + TOKEN_B);
  });

  it("stops before trailing prose instead of swallowing it", () => {
    const t = extractToken(WRAPPED)!;
    expect(t).not.toMatch(/Store|securely|export/);
    expect(t).toMatch(/^sk-ant-oat[A-Za-z0-9_-]+$/);
  });

  it("reads an unwrapped single-line token", () => {
    const plain = `Your OAuth token:\n${ESC}[33m${TOKEN_A}${ESC}[39m\nStore this token securely.\n`;
    expect(extractToken(plain)).toBe(TOKEN_A);
  });

  it("survives the auth-URL block appearing first", () => {
    expect(extractToken(AUTH_URL_BLOCK + WRAPPED)).toBe(TOKEN_A + TOKEN_B);
  });

  it("returns undefined when the run produced no token", () => {
    expect(extractToken(AUTH_URL_BLOCK)).toBeUndefined();
    expect(extractToken("Login cancelled.\n")).toBeUndefined();
    expect(extractToken("")).toBeUndefined();
  });

  it("rejects an sk-ant-oat fragment that is too short to be a token", () => {
    expect(extractToken("sk-ant-oat01-abc\n")).toBeUndefined();
  });
});
