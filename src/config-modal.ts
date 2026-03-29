import {
  DynamicBorder,
  type ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  Input,
  Key,
  SelectList,
  Text,
  fuzzyFilter,
  matchesKey,
  type SelectItem,
} from "@mariozechner/pi-tui";

import {
  type ModelOptionView,
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
const SELECTOR_MAX_VISIBLE = 12;

interface SelectorOption extends SelectItem {
  value: string;
  label: string;
  description?: string;
}

interface SelectorView {
  id: string;
  label: string;
  options: SelectorOption[];
}

interface MenuAction {
  id: string;
  label: string;
  description?: string;
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
  const scopedCount = runtimeStatus.modelOptionsByView.scoped.length;
  const authenticatedCount =
    runtimeStatus.modelOptionsByView.authenticated.length;
  const allCount = runtimeStatus.modelOptionsByView.all.length;

  if (runtimeStatus.usingScopedModels) {
    return `Omni Compact Settings (${scopedCount} scoped / ${authenticatedCount} authenticated / ${allCount} total)`;
  }

  return `Omni Compact Settings (${authenticatedCount} authenticated / ${allCount} total)`;
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
      description: buildModelDescription(index, runtimeStatus),
    });

    actions.push({
      id: `thinking:${index}`,
      label: `${getThinkingLabel(index)}: ${selectedModel?.thinking ?? DEFAULT_THINKING_VALUE}`,
      description: buildThinkingDescription(index, slots),
    });
  }

  actions.push({
    id: "debugCompactions",
    label: `Debug artifacts: ${config.debugCompactions ? "on" : "off"}`,
    description: config.debugCompactions
      ? "Save compaction input and output JSON for debugging."
      : "Do not persist debug artifacts.",
  });
  actions.push({
    id: "minSummaryChars",
    label: `Minimum summary length: ${config.minSummaryChars}`,
    description: `Summaries shorter than ${config.minSummaryChars} characters fall back to Pi's default compaction.`,
  });

  return actions;
}

function buildModelSelectorViewOptions(
  baseOptions: OmniCompactRuntimeStatus["modelOptionsByView"][ModelOptionView],
  currentModel: ModelConfig | undefined,
  fallbackDescription: string
): SelectorOption[] {
  const options: SelectorOption[] = [
    {
      value: EMPTY_MODEL_VALUE,
      label: "(none)",
      description: "Clear this slot.",
    },
  ];
  const seen = new Set(options.map((option) => option.value));

  if (currentModel) {
    const currentValue = toModelValue(currentModel);
    const currentOption = baseOptions.find(
      (option) => option.value === currentValue
    );

    if (!currentOption && !seen.has(currentValue)) {
      seen.add(currentValue);
      options.push({
        value: currentValue,
        label: currentValue,
        description: fallbackDescription,
      });
    }
  }

  for (const option of baseOptions) {
    if (!seen.has(option.value)) {
      seen.add(option.value);
      options.push({
        value: option.value,
        label: option.label,
        description: option.description,
      });
    }
  }

  return options;
}

function buildModelSelectorViews(
  currentModel: ModelConfig | undefined,
  runtimeStatus: OmniCompactRuntimeStatus
): SelectorView[] {
  const views: SelectorView[] = [];

  if (runtimeStatus.modelOptionsByView.scoped.length > 0) {
    views.push({
      id: "scoped",
      label: "Scoped",
      options: buildModelSelectorViewOptions(
        runtimeStatus.modelOptionsByView.scoped,
        currentModel,
        "Currently configured outside scoped models."
      ),
    });
  }

  if (runtimeStatus.modelOptionsByView.authenticated.length > 0) {
    views.push({
      id: "authenticated",
      label: "Authenticated",
      options: buildModelSelectorViewOptions(
        runtimeStatus.modelOptionsByView.authenticated,
        currentModel,
        "Currently configured without authenticated access."
      ),
    });
  }

  views.push({
    id: "all",
    label: "All",
    options: buildModelSelectorViewOptions(
      runtimeStatus.modelOptionsByView.all,
      currentModel,
      "Currently configured model."
    ),
  });

  return views;
}

function buildSimpleSelectorOptions(values: string[]): SelectorOption[] {
  return values.map((value) => ({
    value,
    label: value,
  }));
}

function buildSingleViewSelector(
  label: string,
  options: SelectorOption[]
): SelectorView[] {
  return [{ id: label.toLowerCase(), label, options }];
}

function filterOptions(
  options: SelectorOption[],
  query: string
): SelectorOption[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return options;
  }

  return fuzzyFilter(
    options,
    normalizedQuery,
    (option) => `${option.label} ${option.description ?? ""}`
  );
}

function cycleIndex(index: number, delta: number, total: number): number {
  return (index + delta + total) % total;
}

function getDefaultViewIndex(
  views: SelectorView[],
  defaultViewId?: string
): number {
  if (!defaultViewId) {
    return 0;
  }

  const index = views.findIndex((view) => view.id === defaultViewId);
  return index >= 0 ? index : 0;
}

function openSearchableSelector(
  ctx: ExtensionCommandContext,
  title: string,
  views: SelectorView[],
  subtitle?: string,
  defaultViewId?: string
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const searchInput = new Input();
    const selectedValueByView = new Map<string, string | undefined>();
    let viewIndex = getDefaultViewIndex(views, defaultViewId);
    let filteredOptions: SelectorOption[] = [];
    let selectedIndex = 0;
    let selectedValue: string | undefined;
    let selectList = new SelectList([], SELECTOR_MAX_VISIBLE, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    const applyFilter = (): void => {
      const activeView = views[viewIndex];
      const preferredValue = selectedValueByView.get(activeView.id);
      filteredOptions = filterOptions(
        activeView.options,
        searchInput.getValue()
      );

      if (filteredOptions.length === 0) {
        selectedIndex = 0;
        selectedValue = undefined;
      } else {
        const matchedIndex = preferredValue
          ? filteredOptions.findIndex(
              (option) => option.value === preferredValue
            )
          : -1;
        selectedIndex = matchedIndex >= 0 ? matchedIndex : 0;
        selectedValue = filteredOptions[selectedIndex]?.value;
      }

      selectList = new SelectList(filteredOptions, SELECTOR_MAX_VISIBLE, {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });
      selectList.setSelectedIndex(selectedIndex);
      selectList.onSelectionChange = (item) => {
        selectedValue = item.value;
        selectedValueByView.set(activeView.id, item.value);
      };
    };

    const moveSelection = (delta: number): void => {
      if (filteredOptions.length === 0) {
        return;
      }

      selectedIndex = cycleIndex(selectedIndex, delta, filteredOptions.length);
      selectedValue = filteredOptions[selectedIndex]?.value;
      selectedValueByView.set(views[viewIndex].id, selectedValue);
      selectList.setSelectedIndex(selectedIndex);
    };

    const cycleView = (delta: number): void => {
      if (views.length <= 1) {
        return;
      }

      viewIndex = cycleIndex(viewIndex, delta, views.length);
      applyFilter();
    };

    applyFilter();

    return {
      render(width: number): string[] {
        const container = new Container();
        const activeView = views[viewIndex];
        const viewHint =
          views.length > 1
            ? `View: ${activeView.label} (${viewIndex + 1}/${views.length}) | Tab: switch views`
            : `View: ${activeView.label}`;
        const footerHint =
          views.length > 1
            ? "Type to search | ↑↓ wrap | Tab/Shift+Tab: switch views | Enter: select | Esc: close"
            : "Type to search | ↑↓ wrap | Enter: select | Esc: close";

        container.addChild(
          new DynamicBorder((text) => theme.fg("accent", text))
        );
        container.addChild(
          new Text(theme.fg("accent", theme.bold(title)), 1, 0)
        );
        if (subtitle) {
          container.addChild(new Text(theme.fg("dim", subtitle), 1, 0));
        }
        container.addChild(new Text(theme.fg("dim", viewHint), 1, 0));
        container.addChild(new Text(theme.fg("dim", "Search"), 1, 0));
        container.addChild(searchInput);
        container.addChild(selectList);
        container.addChild(new Text(theme.fg("dim", footerHint), 1, 0));
        container.addChild(
          new DynamicBorder((text) => theme.fg("accent", text))
        );

        return container.render(width);
      },
      invalidate(): void {
        searchInput.invalidate();
        selectList.invalidate();
      },
      handleInput(data: string): void {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done(undefined);
          return;
        }

        if (matchesKey(data, Key.enter)) {
          done(filteredOptions[selectedIndex]?.value);
          return;
        }

        if (matchesKey(data, Key.up)) {
          moveSelection(-1);
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.down)) {
          moveSelection(1);
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.tab)) {
          cycleView(1);
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.shift("tab"))) {
          cycleView(-1);
          tui.requestRender();
          return;
        }

        searchInput.handleInput(data);
        applyFilter();
        tui.requestRender();
      },
    };
  });
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

    const selectedActionId = await openSearchableSelector(
      ctx,
      buildPanelTitle(runtimeStatus),
      buildSingleViewSelector(
        "Settings",
        menuActions.map((action) => ({
          value: action.id,
          label: action.label,
          description: action.description,
        }))
      ),
      controller.getConfigPath()
    );
    if (!selectedActionId) {
      return;
    }

    if (selectedActionId.startsWith("model:")) {
      const index = Number(selectedActionId.slice("model:".length));
      const selectedValue = await openSearchableSelector(
        ctx,
        getSlotLabel(index),
        buildModelSelectorViews(slots[index], runtimeStatus),
        buildModelDescription(index, runtimeStatus),
        runtimeStatus.defaultModelView
      );
      if (!selectedValue) {
        continue;
      }

      controller.setConfig(
        applyModelSelection(current, index, selectedValue, slotCount)
      );
      continue;
    }

    if (selectedActionId.startsWith("thinking:")) {
      const index = Number(selectedActionId.slice("thinking:".length));
      if (!slots[index]) {
        ctx.ui.notify("Select a model first.", "warning");
        continue;
      }

      const selectedThinking = await openSearchableSelector(
        ctx,
        getThinkingLabel(index),
        buildSingleViewSelector(
          "Thinking",
          buildSimpleSelectorOptions([...THINKING_LEVELS])
        ),
        buildThinkingDescription(index, slots)
      );
      if (!selectedThinking) {
        continue;
      }

      controller.setConfig(
        applyThinkingSelection(current, index, selectedThinking, slotCount)
      );
      continue;
    }

    if (selectedActionId === "debugCompactions") {
      const selectedValue = await openSearchableSelector(
        ctx,
        "Debug artifacts",
        buildSingleViewSelector(
          "Debug",
          buildSimpleSelectorOptions(["on", "off"])
        )
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

    if (selectedActionId === "minSummaryChars") {
      const optionValues = [...MIN_SUMMARY_CHAR_OPTIONS];
      const currentValue = String(current.minSummaryChars);
      if (!optionValues.includes(currentValue)) {
        optionValues.push(currentValue);
      }

      const selectedValue = await openSearchableSelector(
        ctx,
        "Minimum summary length",
        buildSingleViewSelector(
          "Length",
          buildSimpleSelectorOptions(optionValues)
        )
      );
      if (!selectedValue) {
        continue;
      }

      controller.setConfig(applyMinSummarySelection(current, selectedValue));
    }
  }
}
