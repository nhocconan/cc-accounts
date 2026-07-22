import { describe, it, expect } from "vitest";
import { deepMerge } from "../src/core/settings.ts";

describe("deepMerge", () => {
  it("merges nested objects", () => {
    const a = { model: "opus", env: { FOO: "1", SHARED: "a" } };
    const b = { model: "sonnet", env: { BAR: "2", SHARED: "b" } };
    expect(deepMerge(a, b)).toEqual({
      model: "sonnet",
      env: { FOO: "1", SHARED: "b", BAR: "2" },
    });
  });

  it("b wins for scalars", () => {
    expect(deepMerge({ x: 1 }, { x: 2 })).toEqual({ x: 2 });
    expect(deepMerge({ x: 1 }, { x: "hello" })).toEqual({ x: "hello" });
  });

  it("arrays are replaced, not merged", () => {
    expect(deepMerge({ a: [1, 2, 3] }, { a: [4] })).toEqual({ a: [4] });
  });

  it("null/undefined handling", () => {
    expect(deepMerge({ x: 1 }, {})).toEqual({ x: 1 });
    expect(deepMerge({ x: 1 }, { y: 2 })).toEqual({ x: 1, y: 2 });
  });

  it("does not mutate inputs", () => {
    const a = { x: { y: 1 } };
    const b = { x: { z: 2 } };
    deepMerge(a, b);
    expect(a).toEqual({ x: { y: 1 } });
    expect(b).toEqual({ x: { z: 2 } });
  });
});
