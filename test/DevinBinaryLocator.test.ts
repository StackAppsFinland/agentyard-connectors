import { describe, expect, it } from "vitest";
import { DevinBinaryLocator, DevinBinaryNotFoundError } from "../src/devin/DevinBinaryLocator.js";

const never = () => false;
const only =
  (...matches: string[]) =>
  (p: string) =>
    matches.some((m) => p === m || p.endsWith(m));

describe("DevinBinaryLocator", () => {
  it("prefers DEVIN_ACP_BIN", () => {
    const loc = new DevinBinaryLocator({
      env: { DEVIN_ACP_BIN: "C:\\custom\\devin.exe" },
      platform: "win32",
      exists: only("C:\\custom\\devin.exe"),
    });
    expect(loc.locate()).toBe("C:\\custom\\devin.exe");
  });

  it("finds the default Windows install path", () => {
    const loc = new DevinBinaryLocator({
      env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local", PATH: "" },
      platform: "win32",
      exists: only("devin.exe"),
    });
    expect(loc.locate()).toMatch(/Programs[/\\]Devin[/\\]resources.*devin\.exe$/);
  });

  it("falls back to PATH", () => {
    const loc = new DevinBinaryLocator({
      env: { PATH: "/usr/bin:/bin", HOME: "/home/u" },
      platform: "linux",
      exists: (p) => p === "/usr/bin/devin",
    });
    expect(loc.locate()).toBe("/usr/bin/devin");
  });

  it("throws a helpful error when nothing matches", () => {
    const loc = new DevinBinaryLocator({ env: { PATH: "" }, platform: "win32", exists: never });
    expect(() => loc.locate()).toThrow(DevinBinaryNotFoundError);
    try {
      loc.locate();
    } catch (e) {
      expect((e as Error).message).toMatch(/DEVIN_ACP_BIN/);
      expect((e as DevinBinaryNotFoundError).searched.length).toBeGreaterThan(0);
    }
  });
});
