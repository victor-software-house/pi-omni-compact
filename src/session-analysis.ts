/**
 * Session structure analysis for pi-omni-compact.
 *
 * Extracts structural metadata from the full session via
 * ctx.sessionManager.getEntries(). The analysis output is serialized
 * as a <session-structure> section in the compaction input, giving the
 * LLM a verified map of what happened before it reads the conversation.
 *
 * Pure computation on in-memory session data — no I/O, no LLM calls.
 */

import type { SessionEntry } from "@mariozechner/pi-coding-agent";

// --- Public types ---

export interface SessionStats {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolResultCount: number;
  compactionCount: number;
  branchPointCount: number;
  modelsUsed: string[];
}

export interface SessionBoundary {
  type: "compaction" | "branch" | "resume" | "tree_jump";
  timestamp: string;
  detail: string;
}

export interface FrictionSignals {
  rephrasingCascades: number;
  toolLoops: number;
  contextChurn: number;
  silentTermination: boolean;
}

export interface DelightSignals {
  resilientRecovery: boolean;
  oneShotSuccess: boolean;
  explicitPraise: boolean;
}

export interface FilesTouched {
  read: string[];
  written: string[];
}

export interface SessionAnalysis {
  stats: SessionStats;
  boundaries: SessionBoundary[];
  friction: FrictionSignals;
  delight: DelightSignals;
  filesTouched: FilesTouched;
}

// --- Constants ---

/** Minimum gap between entries (in ms) to count as a "resume" boundary. */
const RESUME_GAP_MS = 10 * 60 * 1000; // 10 minutes

/** Minimum consecutive user messages to count as a rephrasing cascade. */
const REPHRASING_CASCADE_MIN = 3;

/** Minimum same-tool-same-error repetitions to count as a tool loop. */
const TOOL_LOOP_MIN = 3;

/** Minimum distinct file reads without any writes to count as context churn. */
const CONTEXT_CHURN_MIN = 10;

/** Words/phrases that indicate explicit praise (case-insensitive). */
const PRAISE_PATTERNS = [
  /\bthank(?:s| you)\b/i,
  /\bgreat job\b/i,
  /\bperfect\b/i,
  /\bawesome\b/i,
  /\bexcellent\b/i,
  /\bwell done\b/i,
  /\bnicely done\b/i,
  /\blooks good\b/i,
  /\bnice work\b/i,
  /\bgood work\b/i,
];

/** Sarcasm/negation patterns that invalidate praise. */
const SARCASM_PATTERNS = [
  /\bnot\b.*\b(?:perfect|great|awesome|excellent)\b/i,
  /\byeah right\b/i,
  /\bsure\b.*\b(?:that|it)\b.*\bwork/i,
  /\bsarcast/i,
  /\/s\b/,
];

// --- Text block type guard ---

interface TextBlock {
  type: "text";
  text: string;
}

function isTextBlock(b: unknown): b is TextBlock {
  return (
    typeof b === "object" &&
    b !== null &&
    "type" in b &&
    (b as Record<string, unknown>).type === "text" &&
    "text" in b
  );
}

// --- Tool call extraction helpers ---

/**
 * Extract tool call info from an assistant message's content blocks.
 * Returns [{name, args}] for each tool call found.
 */
function extractToolCalls(
  entry: SessionEntry
): { name: string; args: Record<string, unknown> }[] {
  if (entry.type !== "message") {
    return [];
  }
  const msg = entry.message;
  if (msg.role !== "assistant") {
    return [];
  }
  if (!Array.isArray(msg.content)) {
    return [];
  }

  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for (const block of msg.content) {
    if (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "toolCall" &&
      "name" in block
    ) {
      const tc = block as {
        type: "toolCall";
        name: string;
        arguments?: Record<string, unknown>;
      };
      calls.push({ name: tc.name, args: tc.arguments ?? {} });
    }
  }
  return calls;
}

/**
 * Extract text content from a message entry (user or assistant).
 */
function extractTextContent(entry: SessionEntry): string {
  if (entry.type !== "message") {
    return "";
  }
  const msg = entry.message;
  if (msg.role !== "user" && msg.role !== "assistant") {
    return "";
  }

  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (!Array.isArray(msg.content)) {
    return "";
  }

  return msg.content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n");
}

/**
 * Check if a tool result entry is an error.
 */
function isToolResultError(entry: SessionEntry): boolean {
  if (entry.type !== "message") {
    return false;
  }
  const msg = entry.message;
  if (msg.role !== "toolResult") {
    return false;
  }
  return "isError" in msg && msg.isError === true;
}

/**
 * Get the tool name from a tool result entry.
 */
function getToolResultName(entry: SessionEntry): string | undefined {
  if (entry.type !== "message") {
    return undefined;
  }
  const msg = entry.message;
  if (msg.role !== "toolResult") {
    return undefined;
  }
  return "toolName" in msg ? (msg.toolName as string) : undefined;
}

/**
 * Get first ~100 chars of tool result content for error comparison.
 */
function getToolResultSnippet(entry: SessionEntry): string {
  if (entry.type !== "message") {
    return "";
  }
  const msg = entry.message;
  if (msg.role !== "toolResult") {
    return "";
  }
  if (!Array.isArray(msg.content)) {
    return "";
  }
  const text = msg.content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n");
  return text.slice(0, 100);
}

// --- Analysis functions ---

function getMessageRole(
  entry: SessionEntry
): "user" | "assistant" | "toolResult" | null {
  if (entry.type !== "message") {
    return null;
  }
  const { role } = entry.message;
  if (role === "user") {
    return "user";
  }
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "toolResult") {
    return "toolResult";
  }
  return null;
}

function calculateStats(entries: SessionEntry[]): SessionStats {
  let messageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolResultCount = 0;
  let compactionCount = 0;
  const modelsSet = new Set<string>();

  for (const entry of entries) {
    const role = getMessageRole(entry);
    if (role) {
      messageCount++;
      if (role === "user") {
        userMessageCount++;
      } else if (role === "assistant") {
        assistantMessageCount++;
        // Extract model info from the assistant message
        if (entry.type === "message") {
          const msg = entry.message;
          if (
            "provider" in msg &&
            "model" in msg &&
            typeof msg.provider === "string" &&
            typeof msg.model === "string"
          ) {
            modelsSet.add(`${msg.provider}/${msg.model}`);
          }
        }
      } else if (role === "toolResult") {
        toolResultCount++;
      }
    }

    if (entry.type === "compaction") {
      compactionCount++;
    }
  }

  // Branch points: entries whose parentId is shared by another entry
  // (i.e., a parent has multiple children)
  const parentChildCount = new Map<string, number>();
  for (const entry of entries) {
    if (entry.parentId !== null) {
      parentChildCount.set(
        entry.parentId,
        (parentChildCount.get(entry.parentId) ?? 0) + 1
      );
    }
  }
  let branchPointCount = 0;
  for (const count of parentChildCount.values()) {
    if (count > 1) {
      branchPointCount++;
    }
  }

  return {
    messageCount,
    userMessageCount,
    assistantMessageCount,
    toolResultCount,
    compactionCount,
    branchPointCount,
    modelsUsed: [...modelsSet],
  };
}

function detectBoundaries(entries: SessionEntry[]): SessionBoundary[] {
  const boundaries: SessionBoundary[] = [];

  let prevTimestamp: number | null = null;
  let prevId: string | null = null;

  for (const entry of entries) {
    const entryTime = new Date(entry.timestamp).getTime();

    // Compaction boundaries
    if (entry.type === "compaction") {
      const tokens =
        "tokensBefore" in entry ? (entry.tokensBefore as number) : 0;
      boundaries.push({
        type: "compaction",
        timestamp: entry.timestamp,
        detail: `compaction: ${formatTokens(tokens)} tokens`,
      });
    }

    // Branch summary boundaries
    if (entry.type === "branch_summary") {
      boundaries.push({
        type: "branch",
        timestamp: entry.timestamp,
        detail: "branch summary inserted",
      });
    }

    // Resume gaps (10+ minute timestamp gaps)
    if (prevTimestamp !== null) {
      const gap = entryTime - prevTimestamp;
      if (gap >= RESUME_GAP_MS) {
        boundaries.push({
          type: "resume",
          timestamp: entry.timestamp,
          detail: `resume: ${formatDuration(gap)} gap`,
        });
      }
    }

    // Tree jumps (parentId doesn't match previous entry's id)
    if (
      prevId !== null &&
      entry.parentId !== null &&
      entry.parentId !== prevId
    ) {
      boundaries.push({
        type: "tree_jump",
        timestamp: entry.timestamp,
        detail: `tree jump: parentId ${entry.parentId} != previous id ${prevId}`,
      });
    }

    prevTimestamp = entryTime;
    prevId = entry.id;
  }

  return boundaries;
}

function detectFriction(entries: SessionEntry[]): FrictionSignals {
  let rephrasingCascades = 0;
  let toolLoops = 0;
  let contextChurn = 0;
  let silentTermination = false;

  // Rephrasing cascades: 3+ consecutive user messages without
  // meaningful assistant response (tool calls or substantive text)
  let consecutiveUserMessages = 0;
  for (const entry of entries) {
    const role = getMessageRole(entry);
    if (role === "user") {
      consecutiveUserMessages++;
      // Only count the transition (when we first hit the threshold)
      if (consecutiveUserMessages === REPHRASING_CASCADE_MIN) {
        rephrasingCascades++;
      }
    } else if (role === "assistant") {
      // Check if the assistant response is meaningful
      const toolCalls = extractToolCalls(entry);
      const text = extractTextContent(entry);
      if (toolCalls.length > 0 || text.length > 20) {
        consecutiveUserMessages = 0;
      }
      // Short/empty assistant responses don't reset the cascade
    }
    // Tool results and non-message entries don't affect cascade counting
  }

  // Tool loops: same tool fails with same error 3+ times
  const errorSequences = new Map<string, number>();
  for (const entry of entries) {
    if (isToolResultError(entry)) {
      const toolName = getToolResultName(entry) ?? "unknown";
      const snippet = getToolResultSnippet(entry);
      const key = `${toolName}:${snippet}`;
      const count = (errorSequences.get(key) ?? 0) + 1;
      errorSequences.set(key, count);
      if (count === TOOL_LOOP_MIN) {
        toolLoops++;
      }
    }
  }

  // Context churn: 10+ distinct file reads without any writes
  // in the entire session
  const readFiles = new Set<string>();
  let hasWrite = false;
  for (const entry of entries) {
    const toolCalls = extractToolCalls(entry);
    for (const tc of toolCalls) {
      if (tc.name === "read") {
        const { path } = tc.args;
        if (typeof path === "string") {
          readFiles.add(path);
        }
      } else if (tc.name === "write" || tc.name === "edit") {
        hasWrite = true;
      }
    }
  }
  if (!hasWrite && readFiles.size >= CONTEXT_CHURN_MIN) {
    contextChurn++;
  }

  // Silent termination: session ends with an unresolved error
  const lastFewEntries = entries.slice(-5);
  const lastToolResult = [...lastFewEntries]
    .toReversed()
    .find((e) => getMessageRole(e) === "toolResult");
  if (lastToolResult && isToolResultError(lastToolResult)) {
    // Check if there's a subsequent assistant message that addresses it
    const lastToolResultIdx = entries.indexOf(lastToolResult);
    const afterEntries = entries.slice(lastToolResultIdx + 1);
    const hasResolution = afterEntries.some((e) => {
      const role = getMessageRole(e);
      if (role !== "assistant") {
        return false;
      }
      const text = extractTextContent(e);
      return text.length > 50; // Substantial assistant response
    });
    if (!hasResolution) {
      silentTermination = true;
    }
  }

  return {
    rephrasingCascades,
    toolLoops,
    contextChurn,
    silentTermination,
  };
}

function detectDelight(entries: SessionEntry[]): DelightSignals {
  let resilientRecovery = false;
  let oneShotSuccess = false;
  let explicitPraise = false;

  // Resilient recovery: error followed by fix without user intervention
  // Pattern: toolResult(isError) -> assistant(fix) -> toolResult(success)
  for (let i = 0; i < entries.length - 2; i++) {
    if (isToolResultError(entries[i])) {
      // Check if the next entries lead to a successful result
      // without a user message in between
      let foundUserMessage = false;
      for (let j = i + 1; j < Math.min(i + 5, entries.length); j++) {
        const role = getMessageRole(entries[j]);
        if (role === "user") {
          foundUserMessage = true;
          break;
        }
        if (
          role === "toolResult" &&
          !isToolResultError(entries[j]) &&
          !foundUserMessage
        ) {
          resilientRecovery = true;
          break;
        }
      }
      if (resilientRecovery) {
        break;
      }
    }
  }

  // One-shot success: single user request, no error tool results
  const userMessages = entries.filter((e) => getMessageRole(e) === "user");
  if (userMessages.length === 1) {
    const hasErrors = entries.some((e) => isToolResultError(e));
    if (!hasErrors) {
      oneShotSuccess = true;
    }
  }

  // Explicit praise: user message contains praise words without sarcasm
  for (const entry of entries) {
    if (getMessageRole(entry) !== "user") {
      continue;
    }
    const text = extractTextContent(entry);
    if (!text) {
      continue;
    }

    const hasPraise = PRAISE_PATTERNS.some((p) => p.test(text));
    if (!hasPraise) {
      continue;
    }

    const hasSarcasm = SARCASM_PATTERNS.some((p) => p.test(text));
    if (!hasSarcasm) {
      explicitPraise = true;
      break;
    }
  }

  return {
    resilientRecovery,
    oneShotSuccess,
    explicitPraise,
  };
}

function extractFilesTouched(entries: SessionEntry[]): FilesTouched {
  const readFiles = new Set<string>();
  const writtenFiles = new Set<string>();

  for (const entry of entries) {
    const toolCalls = extractToolCalls(entry);
    for (const tc of toolCalls) {
      if (tc.name === "read" && typeof tc.args.path === "string") {
        readFiles.add(tc.args.path);
      } else if (tc.name === "write" && typeof tc.args.path === "string") {
        writtenFiles.add(tc.args.path);
      } else if (tc.name === "edit" && typeof tc.args.path === "string") {
        writtenFiles.add(tc.args.path);
      }
    }
  }

  return {
    read: [...readFiles].toSorted(),
    written: [...writtenFiles].toSorted(),
  };
}

// --- Formatting helpers ---

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

// --- Main entry point ---

/**
 * Analyze a session's entries and extract structural metadata.
 *
 * Pure function: no I/O, no side effects. O(n) over entries.
 * Returns undefined if entries are empty or analysis fails.
 */
export function analyzeSession(
  entries: SessionEntry[]
): SessionAnalysis | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  try {
    return {
      stats: calculateStats(entries),
      boundaries: detectBoundaries(entries),
      friction: detectFriction(entries),
      delight: detectDelight(entries),
      filesTouched: extractFilesTouched(entries),
    };
  } catch {
    // Analysis failure must not break compaction
    return undefined;
  }
}
