/**
 * Debug artifact saving for pi-omni-compact.
 *
 * When enabled, saves compaction input/output as timestamped JSON files
 * for post-mortem analysis of bad compactions.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_DEBUG_DIR = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-omni-compact",
  "compactions"
);

export interface CompactionDebugData {
  model: string;
  input: string;
  systemPrompt: string;
  output?: string;
  error?: string;
  timestamp: string;
}

/**
 * Save compaction debug artifacts to disk.
 * No-ops when disabled. Swallows all write errors.
 */
export function saveCompactionDebug(
  enabled: boolean,
  data: CompactionDebugData,
  debugDir = DEFAULT_DEBUG_DIR
): void {
  if (!enabled) {
    return;
  }

  try {
    fs.mkdirSync(debugDir, { recursive: true });
    const safeTimestamp = data.timestamp
      .replaceAll(":", "-")
      .replaceAll(".", "-");
    const filename = `${safeTimestamp}.json`;
    fs.writeFileSync(
      path.join(debugDir, filename),
      JSON.stringify(data, null, 2),
      { encoding: "utf8" }
    );
  } catch {
    // Swallow write errors — debug logging must never break compaction
  }
}
