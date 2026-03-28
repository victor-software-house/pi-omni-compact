import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSettingsPath,
  loadSettings,
  resetSettings,
  saveSettings,
} from "../../src/settings.js";

vi.mock("node:fs");
vi.mock("node:url", () => ({
  fileURLToPath: () => "/fake/extension/src/settings.ts",
}));
vi.mock("@mariozechner/pi-coding-agent", () => ({
  getAgentDir: () => "/fake/agent",
}));

describe("settings", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("loads valid settings from the user config path", () => {
    vi.mocked(fs.readFileSync).mockImplementation((settingsPath) => {
      if (settingsPath === "/fake/agent/pi-omni-compact.json") {
        return JSON.stringify({
          models: [
            { provider: "google", id: "gemini-flash", thinking: "high" },
          ],
          debugCompactions: true,
          minSummaryChars: 180,
        });
      }

      throw new Error("unexpected read");
    });

    const settings = loadSettings();

    expect(settings.models).toHaveLength(1);
    expect(settings.models[0].provider).toBe("google");
    expect(settings.models[0].id).toBe("gemini-flash");
    expect(settings.models[0].thinking).toBe("high");
    expect(settings.debugCompactions).toBeTruthy();
    expect(settings.minSummaryChars).toBe(180);
  });

  it("falls back to the legacy settings file", () => {
    vi.mocked(fs.readFileSync)
      .mockImplementationOnce(() => {
        throw new Error("ENOENT");
      })
      .mockImplementationOnce(() =>
        JSON.stringify({
          models: [{ provider: "legacy", id: "model", thinking: "low" }],
        })
      );

    const settings = loadSettings();

    expect(settings.models).toHaveLength(1);
    expect(settings.models[0].provider).toBe("legacy");
    expect(settings.models[0].id).toBe("model");
    expect(settings.models[0].thinking).toBe("low");
  });

  it("returns defaults when neither settings file exists", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const settings = loadSettings();

    expect(settings.models).toHaveLength(2);
    expect(settings.models[0].provider).toBe("google-antigravity");
    expect(settings.models[0].id).toBe("gemini-3-flash");
    expect(settings.minSummaryChars).toBe(100);
    expect(settings.debugCompactions).toBeFalsy();
  });

  it("normalizes malformed fields to safe defaults", () => {
    vi.mocked(fs.readFileSync).mockImplementation((settingsPath) => {
      if (settingsPath === "/fake/agent/pi-omni-compact.json") {
        return JSON.stringify({
          models: [
            { provider: "google", id: "gemini-pro", thinking: "high" },
            { provider: "google", id: "gemini-pro", thinking: "minimal" },
            { provider: "", id: "broken", thinking: "high" },
          ],
          debugCompactions: "yes",
          minSummaryChars: -5,
        });
      }

      throw new Error("unexpected read");
    });

    const settings = loadSettings();

    expect(settings.models).toEqual([
      { provider: "google", id: "gemini-pro", thinking: "high" },
    ]);
    expect(settings.debugCompactions).toBeFalsy();
    expect(settings.minSummaryChars).toBe(100);
  });

  it("reads the expected config paths in order", () => {
    vi.mocked(fs.readFileSync)
      .mockImplementationOnce(() => {
        throw new Error("ENOENT");
      })
      .mockImplementationOnce(() => JSON.stringify({ models: [] }));

    loadSettings();

    expect(fs.readFileSync).toHaveBeenNthCalledWith(
      1,
      "/fake/agent/pi-omni-compact.json",
      "utf8"
    );
    expect(fs.readFileSync).toHaveBeenNthCalledWith(
      2,
      path.join("/fake/extension", "settings.json"),
      "utf8"
    );
  });

  it("writes normalized settings to the user config path", () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    saveSettings({
      models: [
        { provider: "google", id: "gemini-pro", thinking: "high" },
        { provider: "google", id: "gemini-pro", thinking: "minimal" },
      ],
      debugCompactions: true,
      minSummaryChars: 250,
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith("/fake/agent", {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/fake/agent/pi-omni-compact.json",
      `${JSON.stringify(
        {
          models: [{ provider: "google", id: "gemini-pro", thinking: "high" }],
          debugCompactions: true,
          minSummaryChars: 250,
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  });

  it("resets to defaults in the user config path", () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    resetSettings();

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    expect(getSettingsPath()).toBe("/fake/agent/pi-omni-compact.json");
  });
});
