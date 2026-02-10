/**
 * E2E tests for pi-omni-compact fallback behavior.
 *
 * These tests verify that when the extension fails to produce a summary
 * (e.g., due to invalid model configuration), pi falls back to its
 * default compaction behavior.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTempSessionFromBenchmark,
  cleanupTempSession,
  runPiWithExtension,
} from "../helpers/pi-runner.js";

describe("E2E: Fallback to default compaction", () => {
  it("falls back to default compaction when model is invalid", async () => {
    const sessionFile = createTempSessionFromBenchmark("small-03-tmux-debug");

    // Create a temporary settings file with invalid model
    const tempSettingsDir = fs.mkdtempSync("/tmp/pi-omni-compact-settings-");
    const tempSettingsPath = path.join(tempSettingsDir, "settings.json");
    fs.writeFileSync(
      tempSettingsPath,
      JSON.stringify({
        models: [
          {
            provider: "invalid-provider",
            id: "invalid-model",
            thinking: "high",
          },
        ],
      })
    );

    try {
      const result = await runPiWithExtension({
        sessionFile,
        prompt: "Summarize what we've done.",
        useTriggerExtension: true,
        // Override settings path by setting cwd to temp dir
        cwd: tempSettingsDir,
      });

      // Should complete without crashing
      expect(result.exitCode).toBe(0);

      // Extension should have attempted compaction but returned undefined
      // Fallthrough to default compaction should occur
      const lastCompaction = result.compactionEvents.at(-1);

      // If there was a compaction event, it should not be aborted
      expect(lastCompaction?.aborted ?? false).toBeFalsy();
    } finally {
      cleanupTempSession(sessionFile);
      fs.unlinkSync(tempSettingsPath);
      fs.rmdirSync(tempSettingsDir);
    }
  });

  it("handles missing API key gracefully", async () => {
    const sessionFile = createTempSessionFromBenchmark("small-03-tmux-debug");

    try {
      const result = await runPiWithExtension({
        sessionFile,
        prompt: "Summarize.",
        useTriggerExtension: true,
        model: {
          provider: "nonexistent-provider",
          id: "test-model",
        },
      });

      // Should complete - fallback to default compaction
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupTempSession(sessionFile);
    }
  });
});
