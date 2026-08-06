import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  stageUpdate,
  renderUpdaterBat,
  heartbeatContent,
  launchUpdaterTask,
  UPDATER_TASK,
} from "./updater";
import { sha256Hex } from "./update-lib";

describe("stageUpdate", () => {
  it("rejects sha mismatch without extracting", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "upd-"));
    await expect(stageUpdate(Buffer.from("junk"), "0".repeat(64), dir)).rejects.toThrow(/sha256/);
    expect(existsSync(path.join(dir, "payload"))).toBe(false);
  });

  function zipOf(contents: (src: string) => void): { dir: string; bytes: Buffer } {
    const dir = mkdtempSync(path.join(tmpdir(), "upd-"));
    const src = mkdtempSync(path.join(tmpdir(), "src-"));
    contents(src);
    const zip = path.join(dir, "p.zip");
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${src}\\*" -DestinationPath "${zip}"`,
    ]);
    return { dir, bytes: readFileSync(zip) };
  }

  it("extracts a valid zip into payload/", async () => {
    const { dir, bytes } = zipOf((src) => {
      mkdirSync(path.join(src, "agent"));
      writeFileSync(path.join(src, "agent", "version.json"), '{"version":"1.1.0"}');
      writeFileSync(path.join(src, "hello.txt"), "hi");
    });
    await stageUpdate(bytes, sha256Hex(bytes), dir);
    expect(existsSync(path.join(dir, "payload", "hello.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "payload", "agent", "version.json"))).toBe(true);
  });

  it("rejects an incomplete payload and removes it", async () => {
    const { dir, bytes } = zipOf((src) => {
      writeFileSync(path.join(src, "stray.txt"), "no agent dir here");
    });
    await expect(stageUpdate(bytes, sha256Hex(bytes), dir)).rejects.toThrow(/incomplete/);
    expect(existsSync(path.join(dir, "payload"))).toBe(false);
  });
});

describe("launchUpdaterTask", () => {
  it("throws when schtasks cannot be run, so the caller keeps the old version", () => {
    // The failure contract matters more than the happy path: a silent failure
    // here would exit the agent with no updater running. We do NOT register a
    // real task in tests — clearing PATH makes the schtasks lookup fail.
    const realPath = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(() => launchUpdaterTask("C:\\nope\\run-update.bat")).toThrow();
    } finally {
      process.env.PATH = realPath;
    }
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

  it("leaves the engine directory before swapping (inherited cwd would lock it)", () => {
    const template = readFileSync(path.resolve("agent/updater-template.bat"), "utf8");
    const cd = template.indexOf('cd /d "%ROOT%"');
    expect(cd).toBeGreaterThan(-1);
    expect(cd).toBeLessThan(template.indexOf(":swap"));
    expect(cd).toBeLessThan(template.indexOf('schtasks /End /TN "SelfPrintAgent"'));
  });

  it("cleans up its own one-shot task on every exit path", () => {
    const template = readFileSync(path.resolve("agent/updater-template.bat"), "utf8");
    const exits = template.match(/^\s*exit \/b \d/gm) ?? [];
    const deletes = template.match(/schtasks \/Delete \/TN "SelfPrintUpdater" \/F/g) ?? [];
    expect(exits.length).toBeGreaterThan(0);
    expect(deletes.length).toBe(exits.length);
    // The task name must match what updater.ts registers.
    expect(UPDATER_TASK).toBe("SelfPrintUpdater");
  });

  it("stops the scheduled task before touching files", () => {
    const template = readFileSync(path.resolve("agent/updater-template.bat"), "utf8");
    const end = template.indexOf('schtasks /End /TN "SelfPrintAgent"');
    // START-PRINTER.bat relaunches the agent 5s after it exits, so the task
    // (whole process tree) must be stopped before the wait loop and the swap.
    expect(end).toBeGreaterThan(-1);
    expect(end).toBeLessThan(template.indexOf(":waitloop"));
    expect(end).toBeLessThan(template.indexOf(":swap"));
    // ...and again before the rollback kills node.
    expect(template.indexOf('schtasks /End', end + 1)).toBeGreaterThan(template.indexOf(":unhealthy"));
  });

  it("matches the heartbeat version on a whole line, not a substring", () => {
    const template = readFileSync(path.resolve("agent/updater-template.bat"), "utf8");
    expect(template).toContain('findstr /X /C:"%TARGET%"');
  });

  it("writes a heartbeat findstr /X can actually match", () => {
    // findstr /X does not match the last line of a file with no terminator.
    expect(heartbeatContent("1.1.0")).toBe("1.1.0\r\n");
  });

  it("retries the rollback and reports a hard failure", () => {
    const template = readFileSync(path.resolve("agent/updater-template.bat"), "utf8");
    expect(template).toContain(":rollbackloop");
    expect(template).toContain(":rollbackfailed");
    expect(template).toContain("ROLLBACK FAILED - manual recovery needed");
  });
});
