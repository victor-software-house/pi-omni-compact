import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";

import type { OmniCompactSettings } from "./settings.js";

import {
  createOmniCompactController,
  type OmniCompactController,
} from "./config-controller.js";
import { openOmniCompactSettingsModal } from "./config-modal.js";

const SUBCOMMANDS = ["show", "verify", "path", "reset", "help"];
const USAGE_TEXT = "Usage: /omni-compact [show|verify|path|reset|help]";

function getSubcommandCompletions(prefix: string): AutocompleteItem[] | null {
  const matches = SUBCOMMANDS.filter((value) => value.startsWith(prefix));
  return matches.length > 0
    ? matches.map((value) => ({ value, label: value }))
    : null;
}

function formatModels(settings: OmniCompactSettings): string {
  if (settings.models.length === 0) {
    return "(none configured)";
  }

  return settings.models
    .map(
      (model, index) =>
        `${index + 1}. ${model.provider}/${model.id} (${model.thinking})`
    )
    .join(" | ");
}

function formatShowMessage(
  controller: OmniCompactController,
  settings: OmniCompactSettings
): string {
  const runtimeStatus = controller.refreshRuntimeStatus();
  const resolutionMessage = runtimeStatus.resolvedModel
    ? `first usable model: ${runtimeStatus.resolvedModel.label}`
    : "no configured model currently has auth";

  return [
    `omni-compact config: ${controller.getConfigPath()}`,
    `models: ${formatModels(settings)}`,
    `debug artifacts: ${settings.debugCompactions ? "on" : "off"}`,
    `min summary chars: ${settings.minSummaryChars}`,
    resolutionMessage,
  ].join("\n");
}

function formatVerifyMessage(controller: OmniCompactController): {
  message: string;
  level: "info" | "warning";
} {
  const runtimeStatus = controller.refreshRuntimeStatus();
  const issues: string[] = [];

  if (runtimeStatus.modelRegistryError) {
    issues.push(`model registry error: ${runtimeStatus.modelRegistryError}`);
  }

  for (const configuredModel of runtimeStatus.configuredModels) {
    if (!configuredModel.found) {
      issues.push(
        `${configuredModel.label}: not found in the current Pi model registry`
      );
      continue;
    }

    if (!configuredModel.authConfigured) {
      issues.push(`${configuredModel.label}: auth is not configured`);
    }
  }

  if (runtimeStatus.resolvedModel) {
    return {
      message:
        issues.length > 0
          ? `omni-compact will use ${runtimeStatus.resolvedModel.label}.\n${issues.join("\n")}`
          : `omni-compact is ready. First usable model: ${runtimeStatus.resolvedModel.label}`,
      level: issues.length > 0 ? "warning" : "info",
    };
  }

  if (issues.length > 0) {
    return {
      message: `omni-compact fallback is likely.\n${issues.join("\n")}`,
      level: "warning",
    };
  }

  return {
    message:
      "omni-compact fallback is likely. No model is currently configured.",
    level: "warning",
  };
}

async function handleArgs(
  args: string,
  ctx: ExtensionCommandContext,
  controller: OmniCompactController
): Promise<boolean> {
  const normalized = args.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized === "show") {
    ctx.ui.notify(
      formatShowMessage(controller, controller.getConfig()),
      "info"
    );
    return true;
  }

  if (normalized === "verify") {
    const verification = formatVerifyMessage(controller);
    ctx.ui.notify(verification.message, verification.level);
    return true;
  }

  if (normalized === "path") {
    ctx.ui.notify(controller.getConfigPath(), "info");
    return true;
  }

  if (normalized === "reset") {
    if (ctx.hasUI) {
      const confirmed = await ctx.ui.confirm(
        "Reset omni-compact settings",
        `Overwrite ${controller.getConfigPath()} with the default configuration?`
      );
      if (!confirmed) {
        return true;
      }
    }

    const resetConfig = controller.resetConfig();
    ctx.ui.notify(formatShowMessage(controller, resetConfig), "info");
    return true;
  }

  if (normalized === "help") {
    ctx.ui.notify(USAGE_TEXT, "info");
    return true;
  }

  ctx.ui.notify(USAGE_TEXT, "warning");
  return true;
}

export function registerOmniCompactCommand(pi: ExtensionAPI): void {
  pi.registerCommand("omni-compact", {
    description: "Inspect and configure pi-omni-compact",
    getArgumentCompletions: getSubcommandCompletions,
    handler: async (args, ctx) => {
      const controller = createOmniCompactController(ctx.modelRegistry);

      if (await handleArgs(args, ctx, controller)) {
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(
          "/omni-compact requires interactive mode for the settings panel.",
          "warning"
        );
        return;
      }

      await openOmniCompactSettingsModal(ctx, controller);
    },
  });
}
