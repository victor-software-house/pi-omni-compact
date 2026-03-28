import {
  getSettingsListTheme,
  type ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  SettingsList,
  Text,
  type SettingItem,
} from "@mariozechner/pi-tui";

import {
  type OmniCompactController,
  type OmniCompactRuntimeStatus,
} from "./config-controller.js";
import {
  THINKING_LEVELS,
  type ModelConfig,
  type OmniCompactSettings,
} from "./settings.js";

const EMPTY_MODEL_VALUE = "(none)";
const DEFAULT_SLOT_COUNT = 3;
const MAX_SLOT_COUNT = 5;
const MIN_SUMMARY_CHAR_OPTIONS = [
  "50",
  "75",
  "100",
  "150",
  "200",
  "300",
  "500",
  "800",
  "1200",
];
const DEFAULT_THINKING_VALUE = THINKING_LEVELS[4];

function cloneModel(model: ModelConfig): ModelConfig {
  return {
    provider: model.provider,
    id: model.id,
    thinking: model.thinking,
  };
}

function isDefinedModelConfig(
  model: ModelConfig | undefined
): model is ModelConfig {
  return model !== undefined;
}

function toModelValue(model: Pick<ModelConfig, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

function parseModelValue(
  value: string
): Pick<ModelConfig, "provider" | "id"> | undefined {
  const separatorIndex = value.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return undefined;
  }

  return {
    provider: value.slice(0, separatorIndex),
    id: value.slice(separatorIndex + 1),
  };
}

function parseThinkingValue(
  value: string
): ModelConfig["thinking"] | undefined {
  return THINKING_LEVELS.find((thinkingLevel) => thinkingLevel === value);
}

function getSlotCount(config: OmniCompactSettings): number {
  return Math.min(
    Math.max(config.models.length + 1, DEFAULT_SLOT_COUNT),
    MAX_SLOT_COUNT
  );
}

function getModelSlots(
  config: OmniCompactSettings,
  slotCount: number
): Array<ModelConfig | undefined> {
  return Array.from({ length: slotCount }, (_unused, index) => {
    const model = config.models[index];
    return model ? cloneModel(model) : undefined;
  });
}

function buildModelValues(
  config: OmniCompactSettings,
  runtimeStatus: OmniCompactRuntimeStatus
): string[] {
  const values = [EMPTY_MODEL_VALUE];
  const seen = new Set(values);

  for (const model of config.models) {
    const modelValue = toModelValue(model);
    if (!seen.has(modelValue)) {
      seen.add(modelValue);
      values.push(modelValue);
    }
  }

  for (const option of runtimeStatus.modelOptions) {
    if (!seen.has(option.value)) {
      seen.add(option.value);
      values.push(option.value);
    }
  }

  return values;
}

function getSlotLabel(index: number): string {
  if (index === 0) {
    return "Primary model";
  }

  return `Fallback model ${index}`;
}

function getThinkingLabel(index: number): string {
  if (index === 0) {
    return "Primary thinking";
  }

  return `Fallback thinking ${index}`;
}

function buildModelDescription(
  index: number,
  slots: Array<ModelConfig | undefined>,
  runtimeStatus: OmniCompactRuntimeStatus
): string {
  const selectedModel = slots[index];
  if (!selectedModel) {
    return index === 0
      ? "First configured model with auth wins. Choose the main large-context model here."
      : "Optional fallback. Pi tries later slots only when earlier models are unavailable.";
  }

  const currentStatus = runtimeStatus.configuredModels.find(
    (model) => model.index === index
  );

  if (currentStatus) {
    return currentStatus.description;
  }

  return "Selected model status is unknown.";
}

function buildThinkingDescription(
  index: number,
  slots: Array<ModelConfig | undefined>
): string {
  const selectedModel = slots[index];
  if (!selectedModel) {
    return "Select a model first. The thinking level is stored per slot.";
  }

  return `${toModelValue(selectedModel)} will run with ${selectedModel.thinking} reasoning.`;
}

function buildDebugDescription(debugCompactions: boolean): string {
  return debugCompactions
    ? "Save compaction input and output JSON for debugging."
    : "Do not persist debug artifacts.";
}

function buildMinSummaryDescription(minSummaryChars: number): string {
  return `Summaries shorter than ${minSummaryChars} characters fall back to Pi's default compaction.`;
}

function buildSettingItems(
  config: OmniCompactSettings,
  runtimeStatus: OmniCompactRuntimeStatus,
  slotCount: number
): SettingItem[] {
  const slots = getModelSlots(config, slotCount);
  const modelValues = buildModelValues(config, runtimeStatus);
  const minSummaryValues = [...MIN_SUMMARY_CHAR_OPTIONS];
  const currentMinSummary = String(config.minSummaryChars);

  if (!minSummaryValues.includes(currentMinSummary)) {
    minSummaryValues.push(currentMinSummary);
  }

  const items: SettingItem[] = [];

  for (let index = 0; index < slotCount; index += 1) {
    const selectedModel = slots[index];

    items.push({
      id: `model:${index}`,
      label: getSlotLabel(index),
      description: buildModelDescription(index, slots, runtimeStatus),
      currentValue: selectedModel
        ? toModelValue(selectedModel)
        : EMPTY_MODEL_VALUE,
      values: modelValues,
    });

    items.push({
      id: `thinking:${index}`,
      label: getThinkingLabel(index),
      description: buildThinkingDescription(index, slots),
      currentValue: selectedModel?.thinking ?? DEFAULT_THINKING_VALUE,
      values: [...THINKING_LEVELS],
    });
  }

  items.push({
    id: "debugCompactions",
    label: "Debug artifacts",
    description: buildDebugDescription(config.debugCompactions),
    currentValue: config.debugCompactions ? "on" : "off",
    values: ["on", "off"],
  });

  items.push({
    id: "minSummaryChars",
    label: "Minimum summary length",
    description: buildMinSummaryDescription(config.minSummaryChars),
    currentValue: currentMinSummary,
    values: minSummaryValues,
  });

  return items;
}

function syncSettingItems(
  items: SettingItem[],
  config: OmniCompactSettings,
  runtimeStatus: OmniCompactRuntimeStatus,
  slotCount: number
): void {
  const slots = getModelSlots(config, slotCount);

  for (const item of items) {
    if (item.id.startsWith("model:")) {
      const index = Number(item.id.slice("model:".length));
      const selectedModel = slots[index];

      item.description = buildModelDescription(index, slots, runtimeStatus);
      item.currentValue = selectedModel
        ? toModelValue(selectedModel)
        : EMPTY_MODEL_VALUE;
      continue;
    }

    if (item.id.startsWith("thinking:")) {
      const index = Number(item.id.slice("thinking:".length));
      item.description = buildThinkingDescription(index, slots);
      item.currentValue = slots[index]?.thinking ?? DEFAULT_THINKING_VALUE;
      continue;
    }

    if (item.id === "debugCompactions") {
      item.description = buildDebugDescription(config.debugCompactions);
      item.currentValue = config.debugCompactions ? "on" : "off";
      continue;
    }

    if (item.id === "minSummaryChars") {
      item.description = buildMinSummaryDescription(config.minSummaryChars);
      item.currentValue = String(config.minSummaryChars);
    }
  }
}

function applySetting(
  config: OmniCompactSettings,
  id: string,
  value: string,
  slotCount: number
): OmniCompactSettings {
  const slots = getModelSlots(config, slotCount);

  if (id.startsWith("model:")) {
    const index = Number(id.slice("model:".length));
    if (value === EMPTY_MODEL_VALUE) {
      slots[index] = undefined;
    } else {
      const parsedModel = parseModelValue(value);
      if (!parsedModel) {
        return config;
      }

      slots[index] = {
        provider: parsedModel.provider,
        id: parsedModel.id,
        thinking: slots[index]?.thinking ?? DEFAULT_THINKING_VALUE,
      };
    }

    return {
      ...config,
      models: slots.filter(isDefinedModelConfig),
    };
  }

  if (id.startsWith("thinking:")) {
    const index = Number(id.slice("thinking:".length));
    const slot = slots[index];
    const nextThinking = parseThinkingValue(value);
    if (!slot) {
      return config;
    }
    if (!nextThinking) {
      return config;
    }

    slots[index] = {
      ...slot,
      thinking: nextThinking,
    };

    return {
      ...config,
      models: slots.filter(isDefinedModelConfig),
    };
  }

  if (id === "debugCompactions") {
    return {
      ...config,
      debugCompactions: value === "on",
    };
  }

  if (id === "minSummaryChars") {
    const nextMinSummary = Number(value);
    if (!Number.isInteger(nextMinSummary) || nextMinSummary <= 0) {
      return config;
    }

    return {
      ...config,
      minSummaryChars: nextMinSummary,
    };
  }

  return config;
}

export async function openOmniCompactSettingsModal(
  ctx: ExtensionCommandContext,
  controller: OmniCompactController
): Promise<void> {
  let current = controller.getConfig();
  let runtimeStatus = controller.refreshRuntimeStatus();
  const slotCount = getSlotCount(current);

  await ctx.ui.custom((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(
      new Text(theme.fg("accent", theme.bold("Omni Compact Settings")), 1, 0)
    );
    container.addChild(
      new Text(theme.fg("dim", controller.getConfigPath()), 1, 0)
    );

    const items = buildSettingItems(current, runtimeStatus, slotCount);
    const settingsList = new SettingsList(
      items,
      12,
      getSettingsListTheme(),
      (id, newValue) => {
        current = applySetting(current, id, newValue, slotCount);
        current = controller.setConfig(current);
        runtimeStatus = controller.refreshRuntimeStatus();
        syncSettingItems(items, current, runtimeStatus, slotCount);
        tui.requestRender();
      },
      () => done(undefined),
      { enableSearch: true }
    );

    container.addChild(settingsList);
    container.addChild(
      new Text(
        theme.fg(
          "dim",
          "Esc: close | Arrow keys: navigate | Space: cycle value | Type: search"
        ),
        1,
        0
      )
    );

    return {
      render(width: number): string[] {
        return container.render(width);
      },
      invalidate(): void {
        container.invalidate();
      },
      handleInput(data: string): void {
        settingsList.handleInput?.(data);
        tui.requestRender();
      },
    };
  });
}
