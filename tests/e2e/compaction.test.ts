/**
 * E2E tests for pi-omni-compact compaction behavior.
 *
 * These tests spawn real pi processes with the extension loaded
 * and verify compaction produces enhanced summaries with required sections.
 */

import { describe, expect, it } from "vitest";

import {
  createTempSessionFromBenchmark,
  cleanupTempSession,
  runPiWithExtension,
} from "../helpers/pi-runner.js";

describe("E2E: Compaction with pi-omni-compact", () => {
  it("produces enhanced compaction summary with required sections", async () => {
    // Use small benchmark session with enough context to trigger compaction
    const sessionFile = createTempSessionFromBenchmark("small-03-tmux-debug");

    try {
      const result = await runPiWithExtension({
        sessionFile,
        prompt: "Summarize what we've done so far.",
        useTriggerExtension: true,
      });

      // Should complete successfully
      expect(result.exitCode).toBe(0);

      // Should have compaction events
      expect(result.compactionEvents.length).toBeGreaterThan(0);

      // Get the last compaction result
      const lastCompaction = result.compactionEvents.at(-1);
      expect(lastCompaction).toBeDefined();
      expect(lastCompaction?.result).toBeDefined();

      // Verify enhanced format sections
      const summary = lastCompaction?.result?.summary;
      expect(summary).toBeDefined();
      expect(summary).toContain("## Goal");
      expect(summary).toContain("## Progress");
      expect(summary).toContain("## Key Decisions");
      expect(summary).toContain("## Next Steps");
    } finally {
      cleanupTempSession(sessionFile);
    }
  });

  it("summary length is substantial", async () => {
    const sessionFile = createTempSessionFromBenchmark("small-03-tmux-debug");

    try {
      const result = await runPiWithExtension({
        sessionFile,
        prompt: "What files have we modified?",
        useTriggerExtension: true,
      });

      expect(result.exitCode).toBe(0);

      const lastCompaction = result.compactionEvents.at(-1);
      expect(lastCompaction).toBeDefined();

      // Summary should be substantial
      expect(lastCompaction?.result?.summary?.length ?? 0).toBeGreaterThan(100);
    } finally {
      cleanupTempSession(sessionFile);
    }
  });
});
