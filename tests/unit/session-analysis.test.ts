/**
 * Tests for session-analysis.ts
 *
 * Uses synthetic fixture entries to verify stats calculation,
 * boundary detection, friction/delight signals, and file extraction.
 */

import type { SessionEntry } from "@mariozechner/pi-coding-agent";

import { describe, expect, it } from "vitest";

import type { SessionAnalysis } from "../../src/session-analysis.js";

import { analyzeSession } from "../../src/session-analysis.js";
import {
  assistantMessage,
  assistantWithToolCall,
  compactionEntry,
  messageEntry,
  toolResultMessage,
  userMessage,
} from "../helpers/fixtures.js";

// --- Fixture helpers ---

/** Create a message entry with explicit id, parentId, and timestamp. */
function entry(
  msg: ReturnType<typeof userMessage>,
  opts: { id?: string; parentId?: string | null; timestamp?: string } = {}
): SessionEntry {
  return {
    type: "message",
    message: msg,
    id: opts.id ?? `e_${Math.random().toString(36).slice(2, 8)}`,
    parentId: opts.parentId ?? null,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  } as SessionEntry;
}

/** Create an assistant message entry with provider/model metadata. */
function assistantEntry(
  text: string,
  model: { provider: string; model: string },
  opts: { id?: string; parentId?: string | null; timestamp?: string } = {}
): SessionEntry {
  const msg = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    provider: model.provider,
    model: model.model,
    usage: { input: 100, output: 50, cacheRead: 0 },
    stopReason: "stop" as const,
    api: "chat" as const,
    timestamp: Date.now(),
  };
  return {
    type: "message",
    message: msg,
    id: opts.id ?? `e_${Math.random().toString(36).slice(2, 8)}`,
    parentId: opts.parentId ?? null,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  } as SessionEntry;
}

/** Create a tool result entry that is an error. */
function errorToolResult(
  text: string,
  toolName = "bash",
  opts: { id?: string; parentId?: string | null; timestamp?: string } = {}
): SessionEntry {
  return {
    type: "message",
    message: {
      role: "toolResult" as const,
      toolCallId: `call_${Math.random().toString(36).slice(2, 8)}`,
      toolName,
      content: [{ type: "text" as const, text }],
      isError: true,
      timestamp: Date.now(),
    },
    id: opts.id ?? `e_${Math.random().toString(36).slice(2, 8)}`,
    parentId: opts.parentId ?? null,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  } as SessionEntry;
}

/** Create a branch_summary session entry with a timestamp. */
function branchEntry(
  summary: string,
  opts: { id?: string; parentId?: string | null; timestamp?: string } = {}
): SessionEntry {
  return {
    type: "branch_summary",
    summary,
    fromId: "from_1",
    id: opts.id ?? `bs_${Math.random().toString(36).slice(2, 8)}`,
    parentId: opts.parentId ?? null,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  } as SessionEntry;
}

// --- Tests ---

/** Assert that analyzeSession returns a defined result. */
function analyze(entries: SessionEntry[]): SessionAnalysis {
  const result = analyzeSession(entries);
  if (!result) {
    throw new Error("Expected analyzeSession to return a result");
  }
  return result;
}

describe("analyzeSession", () => {
  it("returns undefined for empty entries", () => {
    expect(analyzeSession([])).toBeUndefined();
  });

  it("returns a complete analysis for a single user message", () => {
    const entries = [entry(userMessage("Hello"))];
    const result = analyze(entries);

    expect(result).toBeDefined();
    expect(result.stats.messageCount).toBe(1);
    expect(result.stats.userMessageCount).toBe(1);
    expect(result.stats.assistantMessageCount).toBe(0);
    expect(result.stats.toolResultCount).toBe(0);
    expect(result.stats.compactionCount).toBe(0);
    expect(result.stats.branchPointCount).toBe(0);
    expect(result.boundaries).toEqual([]);
    expect(result.friction.rephrasingCascades).toBe(0);
    expect(result.friction.toolLoops).toBe(0);
    expect(result.friction.contextChurn).toBe(0);
    expect(result.friction.silentTermination).toBeFalsy();
  });
});

describe("stats calculation", () => {
  it("counts message types correctly", () => {
    const entries = [
      entry(userMessage("Request 1")),
      entry(assistantMessage("Response 1")),
      entry(userMessage("Request 2")),
      entry(assistantMessage("Response 2")),
      messageEntry(toolResultMessage("result text")),
    ];
    const result = analyze(entries);

    expect(result.stats.messageCount).toBe(5);
    expect(result.stats.userMessageCount).toBe(2);
    expect(result.stats.assistantMessageCount).toBe(2);
    expect(result.stats.toolResultCount).toBe(1);
  });

  it("extracts models used from assistant messages", () => {
    const entries = [
      entry(userMessage("Hello")),
      assistantEntry("Hi", { provider: "google", model: "gemini-3-flash" }),
      assistantEntry("Sure", {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }),
      assistantEntry("Done", { provider: "google", model: "gemini-3-flash" }),
    ];
    const result = analyze(entries);

    expect(result.stats.modelsUsed).toHaveLength(2);
    expect(result.stats.modelsUsed).toContain("google/gemini-3-flash");
    expect(result.stats.modelsUsed).toContain(
      "anthropic/claude-sonnet-4-20250514"
    );
  });

  it("counts compactions", () => {
    const entries: SessionEntry[] = [
      entry(userMessage("Hello")),
      compactionEntry("Summary 1", 45_000, "comp_1"),
      entry(userMessage("Continue")),
      compactionEntry("Summary 2", 38_000, "comp_2"),
    ];
    const result = analyze(entries);

    expect(result.stats.compactionCount).toBe(2);
  });

  it("detects branch points", () => {
    // Two entries with the same parentId = one branch point
    const entries = [
      entry(userMessage("Root"), { id: "root" }),
      entry(userMessage("Branch A"), { id: "a", parentId: "root" }),
      entry(userMessage("Branch B"), { id: "b", parentId: "root" }),
    ];
    const result = analyze(entries);

    expect(result.stats.branchPointCount).toBe(1);
  });
});

describe("boundary detection", () => {
  it("detects compaction boundaries with token counts", () => {
    const entries: SessionEntry[] = [
      entry(userMessage("Hello")),
      compactionEntry("Summary", 45_000, "comp_1"),
    ];
    const result = analyze(entries);

    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].type).toBe("compaction");
    expect(result.boundaries[0].detail).toContain("45K tokens");
  });

  it("detects branch summary boundaries", () => {
    const entries = [
      entry(userMessage("Hello")),
      branchEntry("Branch work summary"),
    ];
    const result = analyze(entries);

    const branchBoundaries = result.boundaries.filter(
      (b) => b.type === "branch"
    );
    expect(branchBoundaries).toHaveLength(1);
    expect(branchBoundaries[0].detail).toBe("branch summary inserted");
  });

  it("detects resume gaps (10+ minutes)", () => {
    const t1 = "2026-02-10T14:00:00Z";
    const t2 = "2026-02-10T16:30:00Z"; // 2h 30m gap
    const entries = [
      entry(userMessage("Hello"), { timestamp: t1 }),
      entry(userMessage("I'm back"), { timestamp: t2 }),
    ];
    const result = analyze(entries);

    const resumeBoundaries = result.boundaries.filter(
      (b) => b.type === "resume"
    );
    expect(resumeBoundaries).toHaveLength(1);
    expect(resumeBoundaries[0].detail).toContain("2h 30m gap");
  });

  it("does not detect resume for small gaps", () => {
    const t1 = "2026-02-10T14:00:00Z";
    const t2 = "2026-02-10T14:05:00Z"; // 5 min gap
    const entries = [
      entry(userMessage("Hello"), { timestamp: t1 }),
      entry(userMessage("Quick follow-up"), { timestamp: t2 }),
    ];
    const result = analyze(entries);

    const resumeBoundaries = result.boundaries.filter(
      (b) => b.type === "resume"
    );
    expect(resumeBoundaries).toHaveLength(0);
  });

  it("detects tree jumps", () => {
    const entries = [
      entry(userMessage("A"), { id: "e1" }),
      entry(userMessage("B"), { id: "e2", parentId: "e1" }),
      // Jump: parentId e1 instead of e2
      entry(userMessage("C"), { id: "e3", parentId: "e1" }),
    ];
    const result = analyze(entries);

    const treeJumps = result.boundaries.filter((b) => b.type === "tree_jump");
    expect(treeJumps).toHaveLength(1);
  });
});

describe("friction detection", () => {
  it("detects rephrasing cascades (3+ consecutive user messages)", () => {
    const entries = [
      entry(userMessage("Do X")),
      entry(userMessage("I mean do X like this")),
      entry(userMessage("What I really want is X")),
    ];
    const result = analyze(entries);

    expect(result.friction.rephrasingCascades).toBe(1);
  });

  it("resets cascade count on meaningful assistant response", () => {
    const entries = [
      entry(userMessage("Do X")),
      entry(userMessage("Do X please")),
      entry(
        assistantMessage(
          "I'll do X now. Let me start by reading the configuration."
        )
      ),
      entry(userMessage("Thanks")),
      entry(userMessage("One more thing")),
    ];
    const result = analyze(entries);

    expect(result.friction.rephrasingCascades).toBe(0);
  });

  it("detects tool loops (same tool, same error 3+ times)", () => {
    const entries = [
      errorToolResult("Permission denied: /root/.config", "bash"),
      errorToolResult("Permission denied: /root/.config", "bash"),
      errorToolResult("Permission denied: /root/.config", "bash"),
    ];
    const result = analyze(entries);

    expect(result.friction.toolLoops).toBe(1);
  });

  it("does not count different errors as tool loops", () => {
    const entries = [
      errorToolResult("File not found: a.ts", "read"),
      errorToolResult("File not found: b.ts", "read"),
      errorToolResult("File not found: c.ts", "read"),
    ];
    const result = analyze(entries);

    expect(result.friction.toolLoops).toBe(0);
  });

  it("detects context churn (10+ reads without writes)", () => {
    const entries: SessionEntry[] = [];
    for (let i = 0; i < 12; i++) {
      entries.push(
        messageEntry(assistantWithToolCall("read", { path: `src/file${i}.ts` }))
      );
    }
    const result = analyze(entries);

    expect(result.friction.contextChurn).toBe(1);
  });

  it("does not detect context churn when writes are present", () => {
    const entries: SessionEntry[] = [];
    for (let i = 0; i < 12; i++) {
      entries.push(
        messageEntry(assistantWithToolCall("read", { path: `src/file${i}.ts` }))
      );
    }
    entries.push(
      messageEntry(
        assistantWithToolCall("write", {
          path: "src/output.ts",
          content: "// ...",
        })
      )
    );
    const result = analyze(entries);

    expect(result.friction.contextChurn).toBe(0);
  });

  it("detects silent termination (ends with unresolved error)", () => {
    const entries = [
      entry(userMessage("Run the tests")),
      messageEntry(assistantWithToolCall("bash", { command: "npm test" })),
      errorToolResult("ENOENT: no such file or directory"),
    ];
    const result = analyze(entries);

    expect(result.friction.silentTermination).toBeTruthy();
  });

  it("does not flag silent termination when error is resolved", () => {
    const entries = [
      entry(userMessage("Run the tests")),
      messageEntry(assistantWithToolCall("bash", { command: "npm test" })),
      errorToolResult("ENOENT: no such file or directory"),
      entry(
        assistantMessage(
          "The test file is missing. I'll create it now and fix the configuration so the tests can find it properly."
        )
      ),
    ];
    const result = analyze(entries);

    expect(result.friction.silentTermination).toBeFalsy();
  });
});

describe("delight detection", () => {
  it("detects resilient recovery (error -> fix without user)", () => {
    const entries = [
      entry(userMessage("Build the feature")),
      messageEntry(assistantWithToolCall("bash", { command: "npm run build" })),
      errorToolResult("TypeScript error: missing import"),
      messageEntry(
        assistantWithToolCall("edit", {
          path: "src/index.ts",
          oldText: "foo",
          newText: 'import { foo } from "./foo"',
        })
      ),
      messageEntry(toolResultMessage("File edited successfully")),
    ];
    const result = analyze(entries);

    expect(result.delight.resilientRecovery).toBeTruthy();
  });

  it("does not detect resilient recovery when user intervenes", () => {
    const entries = [
      entry(userMessage("Build the feature")),
      messageEntry(assistantWithToolCall("bash", { command: "npm run build" })),
      errorToolResult("TypeScript error: missing import"),
      entry(userMessage("You need to add the import")),
      messageEntry(assistantWithToolCall("edit", { path: "src/index.ts" })),
      messageEntry(toolResultMessage("File edited successfully")),
    ];
    const result = analyze(entries);

    expect(result.delight.resilientRecovery).toBeFalsy();
  });

  it("detects one-shot success (single user message, no errors)", () => {
    const entries = [
      entry(userMessage("Add a health check endpoint")),
      messageEntry(
        assistantWithToolCall("write", {
          path: "src/health.ts",
          content: "// health check",
        })
      ),
      messageEntry(toolResultMessage("File written")),
      entry(assistantMessage("Done. The health check endpoint is ready.")),
    ];
    const result = analyze(entries);

    expect(result.delight.oneShotSuccess).toBeTruthy();
  });

  it("does not detect one-shot with multiple user messages", () => {
    const entries = [
      entry(userMessage("Add a health check endpoint")),
      entry(assistantMessage("Done.")),
      entry(userMessage("Also add logging")),
    ];
    const result = analyze(entries);

    expect(result.delight.oneShotSuccess).toBeFalsy();
  });

  it("detects explicit praise", () => {
    const entries = [
      entry(userMessage("Fix the bug")),
      entry(assistantMessage("Fixed.")),
      entry(userMessage("Thanks, that looks good!")),
    ];
    const result = analyze(entries);

    expect(result.delight.explicitPraise).toBeTruthy();
  });

  it("filters sarcastic praise", () => {
    const entries = [
      entry(userMessage("Fix the bug")),
      entry(assistantMessage("Fixed.")),
      entry(userMessage("Yeah right, that's not great at all")),
    ];
    const result = analyze(entries);

    expect(result.delight.explicitPraise).toBeFalsy();
  });
});

describe("files touched extraction", () => {
  it("extracts read files from tool calls", () => {
    const entries = [
      messageEntry(assistantWithToolCall("read", { path: "src/index.ts" })),
      messageEntry(assistantWithToolCall("read", { path: "src/config.ts" })),
    ];
    const result = analyze(entries);

    expect(result.filesTouched.read).toEqual(["src/config.ts", "src/index.ts"]);
  });

  it("extracts written files from write and edit tool calls", () => {
    const entries = [
      messageEntry(
        assistantWithToolCall("write", {
          path: "src/new.ts",
          content: "// ...",
        })
      ),
      messageEntry(
        assistantWithToolCall("edit", {
          path: "src/existing.ts",
          oldText: "a",
          newText: "b",
        })
      ),
    ];
    const result = analyze(entries);

    expect(result.filesTouched.written).toEqual([
      "src/existing.ts",
      "src/new.ts",
    ]);
  });

  it("deduplicates file paths", () => {
    const entries = [
      messageEntry(assistantWithToolCall("read", { path: "src/index.ts" })),
      messageEntry(assistantWithToolCall("read", { path: "src/index.ts" })),
      messageEntry(assistantWithToolCall("read", { path: "src/index.ts" })),
    ];
    const result = analyze(entries);

    expect(result.filesTouched.read).toEqual(["src/index.ts"]);
  });

  it("returns sorted file paths", () => {
    const entries = [
      messageEntry(assistantWithToolCall("read", { path: "src/z.ts" })),
      messageEntry(assistantWithToolCall("read", { path: "src/a.ts" })),
      messageEntry(assistantWithToolCall("read", { path: "src/m.ts" })),
    ];
    const result = analyze(entries);

    expect(result.filesTouched.read).toEqual([
      "src/a.ts",
      "src/m.ts",
      "src/z.ts",
    ]);
  });

  it("handles entries with no tool calls", () => {
    const entries = [
      entry(userMessage("Hello")),
      entry(assistantMessage("Hi there")),
    ];
    const result = analyze(entries);

    expect(result.filesTouched.read).toEqual([]);
    expect(result.filesTouched.written).toEqual([]);
  });
});

describe("edge cases", () => {
  it("handles session with only non-message entries", () => {
    const entries: SessionEntry[] = [
      compactionEntry("Summary", 50_000, "comp_1"),
    ];
    const result = analyze(entries);

    expect(result.stats.messageCount).toBe(0);
    expect(result.stats.compactionCount).toBe(1);
  });

  it("handles mixed entry types gracefully", () => {
    const thinkingEntry = {
      type: "thinking_level_change" as const,
      thinkingLevel: "high",
      id: "tlc_1",
      parentId: null,
      timestamp: new Date().toISOString(),
    };
    const entries = [
      thinkingEntry as SessionEntry,
      entry(userMessage("Hello")),
    ];
    const result = analyze(entries);

    expect(result.stats.messageCount).toBe(1);
    expect(result.stats.userMessageCount).toBe(1);
  });
});
