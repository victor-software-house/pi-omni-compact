import {
  SettingsManager,
  getAgentDir,
  type ModelRegistry,
} from "@mariozechner/pi-coding-agent";

import {
  THINKING_LEVELS,
  getSettingsPath,
  loadSettings,
  resetSettings,
  saveSettings,
  type ModelConfig,
  type OmniCompactSettings,
} from "./settings.js";

export interface ModelOption {
  value: string;
  label: string;
  description: string;
  provider: string;
  id: string;
  authConfigured: boolean;
  contextWindow: number;
}

export interface ConfiguredModelStatus {
  index: number;
  value: string;
  label: string;
  description: string;
  authConfigured: boolean;
  found: boolean;
}

export interface OmniCompactRuntimeStatus {
  modelRegistryError?: string;
  modelOptions: ModelOption[];
  configuredModels: ConfiguredModelStatus[];
  resolvedModel?: ConfiguredModelStatus;
  scopePatterns?: string[];
  usingScopedModels: boolean;
}

export interface OmniCompactController {
  getConfig(): OmniCompactSettings;
  setConfig(next: OmniCompactSettings): OmniCompactSettings;
  resetConfig(): OmniCompactSettings;
  getConfigPath(): string;
  getRuntimeStatus(): OmniCompactRuntimeStatus;
  refreshRuntimeStatus(): OmniCompactRuntimeStatus;
}

function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1_000_000) {
    return `${(contextWindow / 1_000_000).toFixed(1).replace(/\.0$/, "")}M ctx`;
  }

  if (contextWindow >= 1_000) {
    return `${Math.round(contextWindow / 1_000)}k ctx`;
  }

  return `${contextWindow} ctx`;
}

function compareModelOptions(left: ModelOption, right: ModelOption): number {
  if (left.contextWindow !== right.contextWindow) {
    return right.contextWindow - left.contextWindow;
  }

  return left.label.localeCompare(right.label);
}

function toModelOptionValue(
  model: Pick<ModelConfig, "provider" | "id">
): string {
  return `${model.provider}/${model.id}`;
}

function stripThinkingSuffix(pattern: string): string {
  const lastColonIndex = pattern.lastIndexOf(":");
  if (lastColonIndex < 0) {
    return pattern;
  }

  const suffix = pattern.slice(lastColonIndex + 1);
  const thinkingLevel = THINKING_LEVELS.find((level) => level === suffix);
  if (!thinkingLevel) {
    return pattern;
  }

  return pattern.slice(0, lastColonIndex);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesModelPattern(
  pattern: string,
  model: {
    provider: string;
    id: string;
    name: string;
  }
): boolean {
  const normalizedPattern = stripThinkingSuffix(pattern).trim().toLowerCase();
  if (!normalizedPattern) {
    return false;
  }

  const candidates = [
    `${model.provider}/${model.id}`.toLowerCase(),
    model.id.toLowerCase(),
    model.name.toLowerCase(),
  ];

  if (normalizedPattern.includes("*")) {
    const regex = new RegExp(
      `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, ".*")}$`,
      "i"
    );

    return candidates.some((candidate) => regex.test(candidate));
  }

  return candidates.some(
    (candidate) =>
      candidate === normalizedPattern || candidate.includes(normalizedPattern)
  );
}

function getScopedModelPatterns(cwd: string): string[] | undefined {
  const settingsManager = SettingsManager.create(cwd, getAgentDir());
  const patterns = settingsManager.getEnabledModels();

  if (!patterns || patterns.length === 0) {
    return undefined;
  }

  return patterns;
}

function buildScopedAvailableModels(modelRegistry: ModelRegistry, cwd: string) {
  const availableModels = modelRegistry.getAvailable();
  const scopePatterns = getScopedModelPatterns(cwd);

  if (!scopePatterns) {
    return {
      availableModels,
      scopePatterns: undefined,
      usingScopedModels: false,
    };
  }

  return {
    availableModels: availableModels.filter((model) =>
      scopePatterns.some((pattern) =>
        matchesModelPattern(pattern, {
          provider: model.provider,
          id: model.id,
          name: model.name,
        })
      )
    ),
    scopePatterns,
    usingScopedModels: true,
  };
}

function buildModelOptions(modelRegistry: ModelRegistry, cwd: string) {
  const scopedModels = buildScopedAvailableModels(modelRegistry, cwd);

  return {
    modelOptions: scopedModels.availableModels
      .map((model) => ({
        value: toModelOptionValue(model),
        label: toModelOptionValue(model),
        description: `${model.name} | ${formatContextWindow(model.contextWindow)}${model.reasoning ? " | reasoning" : ""}`,
        provider: model.provider,
        id: model.id,
        authConfigured: true,
        contextWindow: model.contextWindow,
      }))
      .sort(compareModelOptions),
    scopePatterns: scopedModels.scopePatterns,
    usingScopedModels: scopedModels.usingScopedModels,
    availableModelValues: new Set(
      scopedModels.availableModels.map((model) => toModelOptionValue(model))
    ),
  };
}

function buildConfiguredModelStatus(
  modelRegistry: ModelRegistry,
  config: OmniCompactSettings,
  modelOptions: ModelOption[],
  availableModelValues: Set<string>,
  usingScopedModels: boolean
): ConfiguredModelStatus[] {
  const optionByValue = new Map(
    modelOptions.map((option) => [option.value, option])
  );

  return config.models.map((model, index) => {
    const value = toModelOptionValue(model);
    const knownOption = optionByValue.get(value);
    const isInScopedList = availableModelValues.has(value);

    if (knownOption) {
      return {
        index,
        value,
        label: knownOption.label,
        description: knownOption.description,
        authConfigured: knownOption.authConfigured,
        found: true,
      };
    }

    const registeredModel = modelRegistry.find(model.provider, model.id);
    if (!registeredModel) {
      return {
        index,
        value,
        label: value,
        description:
          "Configured model is not available in the current Pi registry.",
        authConfigured: false,
        found: false,
      };
    }

    const descriptionParts = [
      registeredModel.name,
      formatContextWindow(registeredModel.contextWindow),
    ];
    if (registeredModel.reasoning) {
      descriptionParts.push("reasoning");
    }
    if (!isInScopedList) {
      descriptionParts.push(
        usingScopedModels
          ? "outside current Pi scoped model list"
          : "auth missing"
      );
    }

    return {
      index,
      value,
      label: value,
      description: descriptionParts.join(" | "),
      authConfigured: isInScopedList,
      found: true,
    };
  });
}

function buildRuntimeStatus(
  modelRegistry: ModelRegistry,
  cwd: string,
  config: OmniCompactSettings
): OmniCompactRuntimeStatus {
  const scopedModels = buildModelOptions(modelRegistry, cwd);
  const configuredModels = buildConfiguredModelStatus(
    modelRegistry,
    config,
    scopedModels.modelOptions,
    scopedModels.availableModelValues,
    scopedModels.usingScopedModels
  );

  return {
    modelRegistryError: modelRegistry.getError(),
    modelOptions: scopedModels.modelOptions,
    configuredModels,
    resolvedModel: configuredModels.find((model) => model.authConfigured),
    scopePatterns: scopedModels.scopePatterns,
    usingScopedModels: scopedModels.usingScopedModels,
  };
}

export function createOmniCompactController(
  modelRegistry: ModelRegistry,
  cwd: string
): OmniCompactController {
  let runtimeStatus = buildRuntimeStatus(modelRegistry, cwd, loadSettings());

  return {
    getConfig(): OmniCompactSettings {
      return loadSettings();
    },
    setConfig(next: OmniCompactSettings): OmniCompactSettings {
      const normalized = saveSettings(next);
      runtimeStatus = buildRuntimeStatus(modelRegistry, cwd, normalized);
      return normalized;
    },
    resetConfig(): OmniCompactSettings {
      const normalized = resetSettings();
      runtimeStatus = buildRuntimeStatus(modelRegistry, cwd, normalized);
      return normalized;
    },
    getConfigPath(): string {
      return getSettingsPath();
    },
    getRuntimeStatus(): OmniCompactRuntimeStatus {
      return runtimeStatus;
    },
    refreshRuntimeStatus(): OmniCompactRuntimeStatus {
      runtimeStatus = buildRuntimeStatus(modelRegistry, cwd, loadSettings());
      return runtimeStatus;
    },
  };
}
