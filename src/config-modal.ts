import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

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

interface SelectorOption {
  value: string;
  label: string;
}

interface MenuAction {
  id: string;
  label: string;
}

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
  runtimeStatus: OmniCompactRuntimeStatus
): string {
  const currentStatus = runtimeStatus.configuredModels.find(
    (model) => model.index === index
  );

  if (currentStatus) {
    return currentStatus.description;
  }

  return index === 0
    ? "Choose the main large-context model. The first configured model with auth wins."
    : "Optional fallback. Pi tries later slots only when earlier models are unavailable.";
}

function buildThinkingDescription(
  index: number,
  slots: Array<ModelConfig | undefined>
): string {
  const selectedModel = slots[index];
  if (!selectedModel) {
    return "Select a model first. The thinking level is stored per slot.";
  }

  return `${toModelValue(selectedModel)} runs with ${selectedModel.thinking} reasoning.`;
}

function buildPanelTitle(runtimeStatus: OmniCompactRuntimeStatus): string {
  if (runtimeStatus.usingScopedModels) {
    return `Omni Compact Settings (${runtimeStatus.modelOptions.length} scoped Pi models)`;
  }

  return `Omni Compact Settings (${runtimeStatus.modelOptions.length} available Pi models)`;
}

function buildMenuActions(
  config: OmniCompactSettings,
  runtimeStatus: OmniCompactRuntimeStatus,
  slotCount: number
): MenuAction[] {
  const slots = getModelSlots(config, slotCount);
  const actions: MenuAction[] = [];

  for (let index = 0; index < slotCount; index += 1) {
    const selectedModel = slots[index];

    actions.push({
      id: `model:${index}`,
      label: `${getSlotLabel(index)}: ${selectedModel ? toModelValue(selectedModel) : EMPTY_MODEL_VALUE}`,
    });

    actions.push({
      id: `thinking:${index}`,
      label: `${getThinkingLabel(index)}: ${selectedModel?.thinking ?? DEFAULT_THINKING_VALUE}`,
    });
  }

  actions.push({
    id: "debugCompactions",
    label: `Debug artifacts: ${config.debugCompactions ? "on" : "off"}`,
  });
  actions.push({
    id: "minSummaryChars",
    label: `Minimum summary length: ${config.minSummaryChars}`,
  });

  if (runtimeStatus.scopePatterns && runtimeStatus.scopePatterns.length > 0) {
    actions.push({
      id: "scopeInfo",
      label: `Scoped Pi models: ${runtimeStatus.scopePatterns.join(", ")}`,
    });
  }

  return actions;
}

function buildModelSelectorOptions(
  currentModel: ModelConfig | undefined,
  runtimeStatus: OmniCompactRuntimeStatus
): SelectorOption[] {
  const options: SelectorOption[] = [
    {
      value: EMPTY_MODEL_VALUE,
      label: "(none) — clear this slot",
    },
  ];
  const seen = new Set(options.map((option) => option.value));

  if (currentModel) {
    const currentValue = toModelValue(currentModel);
    const currentOption = runtimeStatus.modelOptions.find(
      (option) => option.value === currentValue
    );

    if (!seen.has(currentValue) && !currentOption) {
      seen.add(currentValue);
      options.push({
        value: currentValue,
        label: `${currentValue} — currently configured outside the visible Pi model list`,
      });
    }
  }

  for (const option of runtimeStatus.modelOptions) {
    if (!seen.has(option.value)) {
      seen.add(option.value);
      options.push({
        value: option.value,
        label: `${option.label} — ${option.description}`,
      });
    }
  }

  return options;
}

function buildSimpleSelectorOptions(values: string[]): SelectorOption[] {
  return values.map((value) => ({
    value,
    label: value,
  }));
}

async function showSelector(
  ctx: ExtensionCommandContext,
  title: string,
  options: SelectorOption[]
): Promise<string | undefined> {
  const selectedLabel = await ctx.ui.select(
    title,
    options.map((option) => option.label)
  );
  if (!selectedLabel) {
    return undefined;
  }

  const selectedOption = options.find(
    (option) => option.label === selectedLabel
  );
  return selectedOption?.value;
}

function applyModelSelection(
  config: OmniCompactSettings,
  index: number,
  value: string,
  slotCount: number
): OmniCompactSettings {
  const slots = getModelSlots(config, slotCount);

  if (value === EMPTY_MODEL_VALUE) {
    slots[index] = undefined;
  } else {
    const selectedModel = parseModelValue(value);
    if (!selectedModel) {
      return config;
    }

    slots[index] = {
      provider: selectedModel.provider,
      id: selectedModel.id,
      thinking: slots[index]?.thinking ?? DEFAULT_THINKING_VALUE,
    };
  }

  return {
    ...config,
    models: slots.filter(isDefinedModelConfig),
  };
}

function applyThinkingSelection(
  config: OmniCompactSettings,
  index: number,
  value: string,
  slotCount: number
): OmniCompactSettings {
  const slots = getModelSlots(config, slotCount);
  const selectedModel = slots[index];
  const selectedThinking = parseThinkingValue(value);

  if (!selectedModel || !selectedThinking) {
    return config;
  }

  slots[index] = {
    ...selectedModel,
    thinking: selectedThinking,
  };

  return {
    ...config,
    models: slots.filter(isDefinedModelConfig),
  };
}

function applyMinSummarySelection(
  config: OmniCompactSettings,
  value: string
): OmniCompactSettings {
  const minSummaryChars = Number(value);
  if (!Number.isInteger(minSummaryChars) || minSummaryChars <= 0) {
    return config;
  }

  return {
    ...config,
    minSummaryChars,
  };
}

export async function openOmniCompactSettingsModal(
  ctx: ExtensionCommandContext,
  controller: OmniCompactController
): Promise<void> {
  while (true) {
    const current = controller.getConfig();
    const runtimeStatus = controller.refreshRuntimeStatus();
    const slotCount = getSlotCount(current);
    const slots = getModelSlots(current, slotCount);
    const menuActions = buildMenuActions(current, runtimeStatus, slotCount);

    const selectedActionLabel = await ctx.ui.select(
      buildPanelTitle(runtimeStatus),
      menuActions.map((action) => action.label)
    );
    if (!selectedActionLabel) {
      return;
    }

    const selectedAction = menuActions.find(
      (action) => action.label === selectedActionLabel
    );
    if (!selectedAction) {
      return;
    }

    if (selectedAction.id === "scopeInfo") {
      ctx.ui.notify(selectedAction.label, "info");
      continue;
    }

    if (selectedAction.id.startsWith("model:")) {
      const index = Number(selectedAction.id.slice("model:".length));
      const selectedValue = await showSelector(
        ctx,
        `${getSlotLabel(index)} — ${buildModelDescription(index, runtimeStatus)}`,
        buildModelSelectorOptions(slots[index], runtimeStatus)
      );
      if (!selectedValue) {
        continue;
      }

      controller.setConfig(
        applyModelSelection(current, index, selectedValue, slotCount)
      );
      continue;
    }

    if (selectedAction.id.startsWith("thinking:")) {
      const index = Number(selectedAction.id.slice("thinking:".length));
      if (!slots[index]) {
        ctx.ui.notify("Select a model first.", "warning");
        continue;
      }

      const selectedThinking = await showSelector(
        ctx,
        `${getThinkingLabel(index)} — ${buildThinkingDescription(index, slots)}`,
        buildSimpleSelectorOptions([...THINKING_LEVELS])
      );
      if (!selectedThinking) {
        continue;
      }

      controller.setConfig(
        applyThinkingSelection(current, index, selectedThinking, slotCount)
      );
      continue;
    }

    if (selectedAction.id === "debugCompactions") {
      const selectedValue = await showSelector(
        ctx,
        "Debug artifacts",
        buildSimpleSelectorOptions(["on", "off"])
      );
      if (!selectedValue) {
        continue;
      }

      controller.setConfig({
        ...current,
        debugCompactions: selectedValue === "on",
      });
      continue;
    }

    if (selectedAction.id === "minSummaryChars") {
      const optionValues = [...MIN_SUMMARY_CHAR_OPTIONS];
      const currentValue = String(current.minSummaryChars);
      if (!optionValues.includes(currentValue)) {
        optionValues.push(currentValue);
      }

      const selectedValue = await showSelector(
        ctx,
        "Minimum summary length",
        buildSimpleSelectorOptions(optionValues)
      );
      if (!selectedValue) {
        continue;
      }

      controller.setConfig(applyMinSummarySelection(current, selectedValue));
    }
  }
}
