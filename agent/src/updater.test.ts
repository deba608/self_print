import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stageUpdate, renderUpdaterBat } from "./updater";
import { sha256Hex } from "./update-lib";

describe("stageUpdate", () => {
  it("rejects sha mismatch without extracting", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "upd-"));
    await expect(stageUpdate(Buffer.from("junk"), "0".repeat(64), dir)).rejects.toThrow(/sha256/);
    expect(existsSync(path.join(dir, "payload"))).toBe(false);
  });

  it("extracts a valid zip into payload/", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "upd-"));
    const src = mkdtempSync(path.join(tmpdir(), "src-"));
    writeFileSync(path.join(src, "hello.txt"), "hi");
    const zip = path.join(dir, "p.zip");
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${src}\\*" -DestinationPath "${zip}"`,
    ]);
    const bytes = readFileSync(zip);
    await stageUpdate(bytes, sha256Hex(bytes), dir);
    expect(existsSync(path.join(dir, "payload", "hello.txt"))).toBe(true);
  });
});

describe("renderUpdaterBat", () => {
  it("substitutes all placeholders", () => {
    const out = renderUpdaterBat("x {{ROOT}} {{KIND}} {{VERSION}}", {
      root: "C:\\shop",
      kind: "code",
      version: "1.1.0",
    });
    expect(out).toBe("x C:\\shop code 1.1.0");
    expect(out).not.toContain("{{");
  });

  it("leaves no placeholders in the real template", () => {
    const template = readFileSync(path.resolve("agent/updater-template.bat"), "utf8");
    const out = renderUpdaterBat(template, { root: "C:\\shop", kind: "full", version: "2.0.0" });
    expect(out).not.toContain("{{");
    // config.json must be copied back out of the backup on both swap kinds.
    expect(out).toContain("engine.bak\\agent\\config.json");
    expect(out).toContain("agent.bak\\config.json");
  });
});
