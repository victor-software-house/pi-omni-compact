/**
 * Tests for debug artifact saving.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveCompactionDebug } from "../../src/debug.js";

vi.mock("node:fs");

describe("saveCompactionDebug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseData = {
    model: "google/gemini-3-flash",
    input: "<conversation>test</conversation>",
    systemPrompt: "You are a compaction specialist.",
    output: "## Goal\nTest summary",
    timestamp: "2026-02-10T20:00:00.000Z",
  };

  it("writes JSON file when enabled", () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    saveCompactionDebug(true, baseData, "/tmp/debug");

    expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/debug", {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join("/tmp/debug", "2026-02-10T20-00-00-000Z.json"),
      expect.stringContaining('"model": "google/gemini-3-flash"'),
      { encoding: "utf8" }
    );
  });

  it("no-ops when disabled", () => {
    saveCompactionDebug(false, baseData, "/tmp/debug");

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("includes error field when present", () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const errorData = {
      ...baseData,
      output: undefined,
      error: "Summary too short",
    };
    saveCompactionDebug(true, errorData, "/tmp/debug");

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toBe("Summary too short");
    expect(parsed).not.toHaveProperty("output");
  });

  it("swallows write errors without throwing", () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(() => {
      saveCompactionDebug(true, baseData, "/tmp/debug");
    }).not.toThrow();
  });

  it("writes valid JSON containing all fields", () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    saveCompactionDebug(true, baseData, "/tmp/debug");

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.model).toBe("google/gemini-3-flash");
    expect(parsed.input).toBe("<conversation>test</conversation>");
    expect(parsed.systemPrompt).toBe("You are a compaction specialist.");
    expect(parsed.output).toBe("## Goal\nTest summary");
    expect(parsed.timestamp).toBe("2026-02-10T20:00:00.000Z");
  });
});
