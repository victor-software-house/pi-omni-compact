/**
 * Trigger extension for E2E testing.
 *
 * This extension triggers compaction at the end of each turn so we can
 * test compaction behavior in print mode (where /compact builtin is not available).
 *
 * Usage: pi -e ./tests/helpers/trigger-compact-ext.ts --mode json -p "prompt"
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

const COMPACT_THRESHOLD_TOKENS = 20_000;

function triggerCompaction(ctx: ExtensionContext): void {
  ctx.compact({
    onComplete: () => {
      // Compaction completed successfully
    },
    onError: () => {
      // Compaction failed - will fall back to default
    },
  });
}

export default function (pi: ExtensionAPI): void {
  pi.on("turn_end", (_event, ctx) => {
    const usage = ctx.getContextUsage();
    // Trigger compaction if we have enough context
    if (usage && usage.tokens > COMPACT_THRESHOLD_TOKENS) {
      triggerCompaction(ctx);
    }
  });

  pi.registerCommand("trigger-compact", {
    description: "Trigger compaction immediately (for testing)",
    handler: (_args, ctx) => {
      triggerCompaction(ctx);
    },
  });
}
