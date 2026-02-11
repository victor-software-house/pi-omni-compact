/**
 * Hybrid input serializer for pi-omni-compact.
 *
 * Converts compaction and branch summarization event data
 * into a structured text format combining conversation and metadata.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

import {
  type FileOperations,
  type SessionEntry,
  convertToLlm,
  serializeConversation,
} from "@mariozechner/pi-coding-agent";

import type { SessionAnalysis } from "./session-analysis.js";

/** Subset of CompactionPreparation needed for serialization */
interface CompactionInput {
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  customInstructions?: string;
  sessionAnalysis?: SessionAnalysis;
}

/**
 * Extract an AgentMessage from a session entry, mirroring the pattern
 * from compaction.ts's getMessageFromEntry().
 */
function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "custom_message") {
    // Build a minimal custom-role message for serialization
    return {
      role: "custom" as const,
      customType: entry.customType,
      content:
        typeof entry.content === "string" ? entry.content : entry.content,
      display: entry.display,
      details: entry.details,
      timestamp: new Date(entry.timestamp).getTime(),
    } as AgentMessage;
  }
  if (entry.type === "branch_summary") {
    return {
      role: "branchSummary" as const,
      summary: entry.summary,
      fromId: entry.fromId,
      timestamp: new Date(entry.timestamp).getTime(),
    } as AgentMessage;
  }
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary" as const,
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    } as AgentMessage;
  }
  return undefined;
}

/**
 * Format file operations into the metadata section.
 */
function formatFileOps(fileOps: FileOperations): string {
  const parts: string[] = [];
  if (fileOps.read.size > 0) {
    parts.push(`  read: ${[...fileOps.read].join(", ")}`);
  }
  if (fileOps.written.size > 0) {
    parts.push(`  written: ${[...fileOps.written].join(", ")}`);
  }
  if (fileOps.edited.size > 0) {
    parts.push(`  edited: ${[...fileOps.edited].join(", ")}`);
  }
  if (parts.length === 0) {
    return "  (none)";
  }
  return parts.join("\n");
}

/**
 * Serialize compaction preparation data into hybrid input format.
 */
export function serializeCompactionInput(preparation: CompactionInput): string {
  const {
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    customInstructions,
    sessionAnalysis,
  } = preparation;

  const sections: string[] = [];

  // Session structure analysis (before conversation for context)
  if (sessionAnalysis) {
    sections.push(formatSessionAnalysis(sessionAnalysis));
  }

  // Main conversation
  const conversationText = serializeConversation(
    convertToLlm(messagesToSummarize)
  );
  sections.push(`<conversation>\n${conversationText}\n</conversation>`);

  // Turn prefix (if split turn)
  if (isSplitTurn && turnPrefixMessages.length > 0) {
    const prefixText = serializeConversation(convertToLlm(turnPrefixMessages));
    sections.push(`<turn-prefix>\n${prefixText}\n</turn-prefix>`);
  }

  // Metadata
  const metadataLines = [
    "<metadata>",
    `<token-count>${tokensBefore}</token-count>`,
    `<split-turn>${isSplitTurn}</split-turn>`,
    "<file-operations>",
    formatFileOps(fileOps),
    "</file-operations>",
    "</metadata>",
  ];
  sections.push(metadataLines.join("\n"));

  // Previous summary (for incremental compaction)
  if (previousSummary) {
    sections.push(
      `<previous-summary>\n${previousSummary}\n</previous-summary>`
    );
  }

  // User compaction note (from /compact <text>)
  if (customInstructions?.trim()) {
    sections.push(
      `<user-compaction-note>\n${customInstructions.trim()}\n</user-compaction-note>`
    );
  }

  return sections.join("\n\n");
}

/**
 * Serialize branch entries into hybrid input format for branch summarization.
 */
export function serializeBranchInput(
  entriesToSummarize: SessionEntry[],
  sessionAnalysis?: SessionAnalysis
): string {
  const messages: AgentMessage[] = [];
  for (const entry of entriesToSummarize) {
    const msg = getMessageFromEntry(entry);
    if (msg) {
      messages.push(msg);
    }
  }

  const sections: string[] = [];

  if (sessionAnalysis) {
    sections.push(formatSessionAnalysis(sessionAnalysis));
  }

  const conversationText = serializeConversation(convertToLlm(messages));
  sections.push(`<conversation>\n${conversationText}\n</conversation>`);

  return sections.join("\n\n");
}

/**
 * Format a SessionAnalysis into the <session-structure> section.
 */
function formatSessionAnalysis(analysis: SessionAnalysis): string {
  const { stats, boundaries, friction, delight, filesTouched } = analysis;
  const lines: string[] = [
    // Stats
    `Messages: ${stats.messageCount} (user: ${stats.userMessageCount}, assistant: ${stats.assistantMessageCount}, tool: ${stats.toolResultCount})`,
  ];
  if (stats.modelsUsed.length > 0) {
    lines.push(`Models: ${stats.modelsUsed.join(", ")}`);
  }
  lines.push(
    `Compactions: ${stats.compactionCount} | Branch points: ${stats.branchPointCount}`
  );

  // Boundaries
  if (boundaries.length > 0) {
    lines.push("");
    lines.push("Boundaries:");
    for (const b of boundaries) {
      lines.push(`- [${b.timestamp}] ${b.detail}`);
    }
  }

  // Friction
  const frictionLines: string[] = [];
  if (friction.rephrasingCascades > 0) {
    frictionLines.push(
      `- Rephrasing cascades: ${friction.rephrasingCascades} (${friction.rephrasingCascades}x 3+ consecutive user messages)`
    );
  }
  if (friction.toolLoops > 0) {
    frictionLines.push(
      `- Tool loops: ${friction.toolLoops} (same error repeated 3+ times)`
    );
  }
  if (friction.contextChurn > 0) {
    frictionLines.push(
      `- Context churn: ${friction.contextChurn} (10+ file reads without writes)`
    );
  }
  if (friction.silentTermination) {
    frictionLines.push(
      "- Silent termination: session ended with unresolved error"
    );
  }
  if (frictionLines.length > 0) {
    lines.push("");
    lines.push("Friction:");
    lines.push(...frictionLines);
  }

  // Delight
  const delightLines: string[] = [];
  if (delight.resilientRecovery) {
    delightLines.push(
      "- Resilient recovery: yes (fixed errors without user help)"
    );
  }
  if (delight.oneShotSuccess) {
    delightLines.push(
      "- One-shot success: yes (task completed without corrections)"
    );
  }
  if (delight.explicitPraise) {
    delightLines.push("- Explicit praise: yes");
  }
  if (delightLines.length > 0) {
    lines.push("");
    lines.push("Delight:");
    lines.push(...delightLines);
  }

  // Files touched
  if (filesTouched.read.length > 0 || filesTouched.written.length > 0) {
    lines.push("");
    lines.push("Files touched:");
    if (filesTouched.read.length > 0) {
      lines.push(`  read: ${filesTouched.read.join(", ")}`);
    }
    if (filesTouched.written.length > 0) {
      lines.push(`  written: ${filesTouched.written.join(", ")}`);
    }
  }

  return `<session-structure>\n${lines.join("\n")}\n</session-structure>`;
}
