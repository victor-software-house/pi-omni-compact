/**
 * Unit tests for subprocess.ts
 *
 * Mocks child_process.spawn to test the full subprocess module without
 * spawning real pi processes.
 */

import { describe, expect, it, vi } from "vitest";

import type { ResolvedModel } from "../../src/models.js";

// Mock spawn before importing the module under test
const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock fs with mutable mock functions
const mockMkdtempSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockRmdirSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  mkdtempSync: (...args: unknown[]) => mockMkdtempSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  rmdirSync: (...args: unknown[]) => mockRmdirSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// Mock os
vi.mock("node:os", () => ({
  tmpdir: vi.fn().mockReturnValue("/tmp"),
  homedir: vi.fn().mockReturnValue("/home/test"),
}));

// Import the module under test after mocks are set up
// eslint-disable-next-line import/first
import { runSummarizationAgent } from "../../src/subprocess.js";

type MockReadableStream = {
  on: ReturnType<typeof vi.fn>;
};

type MockProcess = {
  stdout: MockReadableStream;
  stderr: MockReadableStream;
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

describe("runSummarizationAgent", () => {
  const mockModel: ResolvedModel = {
    provider: "google",
    model: "gemini-flash",
    thinking: "high",
  };

  const mockCwd = "/test/project";

  // Mock process events
  let mockStdout: MockReadableStream;
  let mockStderr: MockReadableStream;
  let mockProc: MockProcess;

  // Store event handlers for triggering
  let stdoutDataHandler: ((data: Buffer) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;
  let errorHandler: (() => void) | undefined;

  function setupMocks(): void {
    // Reset mocks
    mockMkdtempSync.mockReset();
    mockWriteFileSync.mockReset();
    mockUnlinkSync.mockReset();
    mockRmdirSync.mockReset();
    mockExistsSync.mockReset();
    mockSpawn.mockReset();

    // Setup fs mocks
    mockMkdtempSync.mockReturnValue("/tmp/pi-omni-compact-abc123");
    mockExistsSync.mockReturnValue(false);

    // Setup process mock
    mockStdout = {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data") {
          stdoutDataHandler = handler;
        }
        return mockStdout;
      }),
    };

    mockStderr = {
      on: vi.fn(() => mockStderr),
    };

    mockProc = {
      stdout: mockStdout,
      stderr: mockStderr,
      on: vi.fn((event: string, handler: unknown) => {
        if (event === "close") {
          closeHandler = handler as (code: number | null) => void;
        } else if (event === "error") {
          errorHandler = handler as () => void;
        }
        return mockProc;
      }),
      kill: vi.fn(() => true),
      killed: false,
    };

    mockSpawn.mockReturnValue(mockProc);
  }

  it("creates temp directory with correct prefix", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test system prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    // Trigger close to complete
    if (closeHandler) {
      closeHandler(0);
    }

    await promise;

    expect(mockMkdtempSync).toHaveBeenCalledWith("/tmp/pi-omni-compact-");
  });

  it("writes input and system prompt files with correct content and permissions", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input content",
      "test system prompt content",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(0);
    }

    await promise;

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/tmp/pi-omni-compact-abc123/input.md",
      "test input content",
      { encoding: "utf8", mode: 0o600 }
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/tmp/pi-omni-compact-abc123/system-prompt.md",
      "test system prompt content",
      { encoding: "utf8", mode: 0o600 }
    );
  });

  it("spawns pi with correct CLI arguments", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(0);
    }

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      "pi",
      [
        "--mode",
        "json",
        "-p",
        "--no-session",
        "--provider",
        "google",
        "--model",
        "gemini-flash",
        "--thinking",
        "high",
        "--tools",
        "read,grep,find,ls",
        "--system-prompt",
        "/tmp/pi-omni-compact-abc123/system-prompt.md",
        "@/tmp/pi-omni-compact-abc123/input.md",
        "Produce an enhanced compaction summary. Read any referenced files that would help preserve important context.",
      ],
      {
        cwd: mockCwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  });

  it("adds pi-read-map extension when found", async () => {
    setupMocks();

    // Mock pi-read-map exists in first location
    mockExistsSync.mockImplementation(
      (filepath: string) =>
        filepath === "/home/test/.pi/agent/extensions/pi-read-map"
    );

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(0);
    }

    await promise;

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];

    expect(args).toContain("-e");
    expect(args).toContain("/home/test/.pi/agent/extensions/pi-read-map");
  });

  it("prefers first pi-read-map location when both exist", async () => {
    setupMocks();

    mockExistsSync.mockReturnValue(true);

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(0);
    }

    await promise;

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];

    // Should use the first location (home/.pi/agent/extensions/)
    const eIndex = args.indexOf("-e");
    expect(eIndex).toBeGreaterThan(-1);
    expect(args[eIndex + 1]).toBe(
      "/home/test/.pi/agent/extensions/pi-read-map"
    );
  });

  it("extracts assistant text from message_end event", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    // Simulate JSON events
    const events = [
      JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
      JSON.stringify({
        type: "content_delta",
        delta: { type: "text", text: "Hello" },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "## Goal\nSummarize the work." },
            { type: "text", text: "\n\n## Progress\nMade good progress." },
          ],
        },
      }),
    ];

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(events.join("\n")));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    // Text blocks are joined with "\n" - second block starts with "\n\n"
    expect(result).toBe(
      "## Goal\nSummarize the work.\n\n\n## Progress\nMade good progress."
    );
  });

  it("handles JSON split across multiple data chunks", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    const messageEndEvent = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Complete summary" }],
      },
    });

    // Split the event across chunks
    const chunk1 = messageEndEvent.slice(0, 30);
    const chunk2 = messageEndEvent.slice(30);

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(chunk1));
      stdoutDataHandler(Buffer.from(chunk2));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBe("Complete summary");
  });

  it("ignores non-message_end events", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    const events = [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({ type: "tool_start", tool: "read", args: {} }),
      JSON.stringify({ type: "tool_end", result: "file content" }),
      JSON.stringify({ type: "agent_end" }),
    ];

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(events.join("\n")));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBeUndefined();
  });

  it("ignores message_end events with non-assistant role", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    const events = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "user",
          content: [{ type: "text", text: "User message" }],
        },
      }),
    ];

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(events.join("\n")));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBeUndefined();
  });

  it("returns undefined on non-zero exit code", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(1);
    }

    const result = await promise;

    expect(result).toBeUndefined();
  });

  it("returns undefined on spawn error", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (errorHandler) {
      errorHandler();
    }

    const result = await promise;

    expect(result).toBeUndefined();
  });

  it("returns undefined when output is empty", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBeUndefined();
  });

  it("returns undefined when assistant content is empty", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    const events = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
        },
      }),
    ];

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(events.join("\n")));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBeUndefined();
  });

  it("handles abort signal by killing process", async () => {
    setupMocks();

    const controller = new AbortController();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      controller.signal,
      mockCwd
    );

    // Trigger abort
    controller.abort();

    // Process should be killed
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

    // Trigger close to complete the promise
    if (closeHandler) {
      closeHandler(null);
    }

    // Wait for promise
    const result = await promise;
    expect(result).toBeUndefined();
  });

  it("sends SIGKILL after 5 seconds if process still running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks();

    const controller = new AbortController();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      controller.signal,
      mockCwd
    );

    controller.abort();

    // Fast-forward 5 seconds
    await vi.advanceTimersByTimeAsync(5000);

    // Trigger close to complete the promise
    if (closeHandler) {
      closeHandler(null);
    }

    await promise;

    expect(mockProc.kill).toHaveBeenCalledWith("SIGKILL");

    vi.useRealTimers();
  });

  it("cleans up temp files even on successful completion", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(0);
    }

    await promise;

    expect(mockUnlinkSync).toHaveBeenCalledWith(
      "/tmp/pi-omni-compact-abc123/input.md"
    );
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      "/tmp/pi-omni-compact-abc123/system-prompt.md"
    );
    expect(mockRmdirSync).toHaveBeenCalledWith("/tmp/pi-omni-compact-abc123");
  });

  it("cleans up temp files even on spawn error", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (errorHandler) {
      errorHandler();
    }

    await promise;

    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockRmdirSync).toHaveBeenCalled();
  });

  it("handles cleanup errors gracefully", async () => {
    setupMocks();

    mockUnlinkSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });
    mockRmdirSync.mockImplementation(() => {
      throw new Error("Directory not empty");
    });

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    if (closeHandler) {
      closeHandler(0);
    }

    // Should not throw
    await expect(promise).resolves.toBeUndefined();
  });

  it("uses last message_end event when multiple are received", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    const events = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "First summary" }],
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Second summary" }],
        },
      }),
    ];

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(events.join("\n")));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBe("Second summary");
  });

  it("ignores invalid JSON lines", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    const lines = [
      "not json",
      "{ invalid }",
      "",
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Valid summary" }],
        },
      }),
    ];

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(lines.join("\n")));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBe("Valid summary");
  });

  it("processes remaining buffer on close", async () => {
    setupMocks();

    const promise = runSummarizationAgent(
      "test input",
      "test prompt",
      mockModel,
      new AbortController().signal,
      mockCwd
    );

    // Send incomplete line (no newline at end)
    const incompleteLine = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Final summary" }],
      },
    });

    if (stdoutDataHandler) {
      stdoutDataHandler(Buffer.from(incompleteLine));
    }

    if (closeHandler) {
      closeHandler(0);
    }

    const result = await promise;

    expect(result).toBe("Final summary");
  });
});
