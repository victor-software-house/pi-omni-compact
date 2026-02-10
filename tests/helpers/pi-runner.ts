/**
 * E2E test runner for pi with pi-omni-compact extension.
 *
 * Spawns pi with the extension loaded, captures JSON events,
 * and extracts compaction results from auto_compaction_end events.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface PiRunOptions {
  /** Session file to load (optional) */
  sessionFile?: string;
  /** Initial prompt to send */
  prompt: string;
  /** Additional prompts to send after the initial */
  additionalPrompts?: string[];
  /** Working directory for pi */
  cwd?: string;
  /** Model to use (defaults to settings.json) */
  model?: { provider: string; id: string; thinking?: string };
  /** Whether to load the trigger-compact extension */
  useTriggerExtension?: boolean;
  /** Additional extensions to load */
  extensions?: string[];
  /** Abort signal for timeout control */
  signal?: AbortSignal;
}

export interface CompactionEvent {
  type: "auto_compaction_end";
  result?: {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
  };
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
}

export interface PiRunResult {
  /** All events captured from pi --mode json */
  events: Record<string, unknown>[];
  /** Compaction events specifically */
  compactionEvents: CompactionEvent[];
  /** Final assistant message content (if any) */
  finalMessage?: string;
  /** Exit code */
  exitCode: number;
  /** stderr output */
  stderr: string;
}

/**
 * Run pi with the pi-omni-compact extension and capture JSON events.
 */
export function runPiWithExtension(
  options: PiRunOptions
): Promise<PiRunResult> {
  const extensionPath = path.resolve(process.cwd(), "src/index.ts");

  const args: string[] = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "-e",
    extensionPath,
  ];

  // Add trigger extension if requested
  if (options.useTriggerExtension) {
    const triggerExtPath = path.resolve(
      process.cwd(),
      "tests/helpers/trigger-compact-ext.ts"
    );
    args.push("-e", triggerExtPath);
  }

  // Add any additional extensions
  if (options.extensions) {
    for (const ext of options.extensions) {
      args.push("-e", ext);
    }
  }

  // Add session file if provided
  if (options.sessionFile) {
    args.push("--session", options.sessionFile);
  }

  // Add model if specified
  if (options.model) {
    args.push("--provider", options.model.provider);
    args.push("--model", options.model.id);
    if (options.model.thinking) {
      args.push("--thinking", options.model.thinking);
    }
  }

  // Add prompts
  args.push(options.prompt);
  if (options.additionalPrompts) {
    for (const prompt of options.additionalPrompts) {
      args.push(prompt);
    }
  }

  const events: Record<string, unknown>[] = [];
  const compactionEvents: CompactionEvent[] = [];
  const stderrChunks: Buffer[] = [];
  let finalMessage: string | undefined;

  return new Promise((resolve, reject) => {
    const proc = spawn("pi", args, {
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";

    const processLine = (line: string) => {
      if (!line.trim()) {
        return;
      }

      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        events.push(event);

        if (event.type === "auto_compaction_end") {
          compactionEvents.push(event as CompactionEvent);
        }

        if (event.type === "message_end") {
          const msg = event.message as {
            role?: string;
            content?: { type?: string; text?: string }[];
          };
          if (msg?.role === "assistant" && Array.isArray(msg.content)) {
            const textParts: string[] = [];
            for (const block of msg.content) {
              if (block.type === "text" && block.text) {
                textParts.push(block.text);
              }
            }
            if (textParts.length > 0) {
              finalMessage = textParts.join("\n");
            }
          }
        }
      } catch {
        // Ignore invalid JSON lines
      }
    };

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderrChunks.push(data);
    });

    proc.on("close", (code: number | null) => {
      // Process remaining buffer
      if (buffer.trim()) {
        processLine(buffer);
      }

      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      resolve({
        events,
        compactionEvents,
        finalMessage,
        exitCode: code ?? 1,
        stderr,
      });
    });

    proc.on("error", (error) => {
      reject(error);
    });

    // Handle abort signal
    if (options.signal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 5000);
      };

      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
}

/**
 * Create a temporary session file from a benchmark session.
 * Returns the path to the temporary file.
 */
export function createTempSessionFromBenchmark(
  benchmarkSessionId: string
): string {
  const benchmarkDir = path.join(
    os.homedir(),
    "tools/pi-compression-benchmark/datasets/sessions"
  );

  // Read manifest to find the file
  const manifestPath = path.join(benchmarkDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    sessions: { id: string; filename: string }[];
  };

  const sessionInfo = manifest.sessions.find(
    (s) => s.id === benchmarkSessionId
  );
  if (!sessionInfo) {
    throw new Error(`Benchmark session not found: ${benchmarkSessionId}`);
  }

  const sourcePath = path.join(benchmarkDir, sessionInfo.filename);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-omni-compact-test-")
  );
  const destPath = path.join(tempDir, "test-session.jsonl");

  fs.copyFileSync(sourcePath, destPath);

  return destPath;
}

/**
 * Clean up a temporary session file.
 */
export function cleanupTempSession(sessionPath: string): void {
  try {
    fs.unlinkSync(sessionPath);
    fs.rmdirSync(path.dirname(sessionPath));
  } catch {
    // Ignore cleanup errors
  }
}
