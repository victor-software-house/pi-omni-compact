import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
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
  if (left.authConfigured !== right.authConfigured) {
    return left.authConfigured ? -1 : 1;
  }

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

function buildModelOptions(modelRegistry: ModelRegistry): ModelOption[] {
  const availableModels = new Set(
    modelRegistry.getAvailable().map((model) => toModelOptionValue(model))
  );

  return modelRegistry
    .getAll()
    .map((model) => {
      const authConfigured = availableModels.has(toModelOptionValue(model));

      return {
        value: toModelOptionValue(model),
        label: toModelOptionValue(model),
        description: `${formatContextWindow(model.contextWindow)} | ${authConfigured ? "auth configured" : "auth missing"}${model.reasoning ? " | reasoning" : ""}`,
        provider: model.provider,
        id: model.id,
        authConfigured,
        contextWindow: model.contextWindow,
      };
    })
    .sort(compareModelOptions);
}

function buildConfiguredModelStatus(
  modelRegistry: ModelRegistry,
  config: OmniCompactSettings,
  modelOptions: ModelOption[]
): ConfiguredModelStatus[] {
  const availableModels = new Set(
    modelRegistry.getAvailable().map((model) => toModelOptionValue(model))
  );
  const optionByValue = new Map(
    modelOptions.map((option) => [option.value, option])
  );

  return config.models.map((model, index) => {
    const value = toModelOptionValue(model);
    const knownOption = optionByValue.get(value);
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

    const authConfigured = availableModels.has(value);

    return {
      index,
      value,
      label: value,
      description: `${formatContextWindow(registeredModel.contextWindow)} | ${authConfigured ? "auth configured" : "auth missing"}${registeredModel.reasoning ? " | reasoning" : ""}`,
      authConfigured,
      found: true,
    };
  });
}

function buildRuntimeStatus(
  modelRegistry: ModelRegistry,
  config: OmniCompactSettings
): OmniCompactRuntimeStatus {
  const modelOptions = buildModelOptions(modelRegistry);
  const configuredModels = buildConfiguredModelStatus(
    modelRegistry,
    config,
    modelOptions
  );

  return {
    modelRegistryError: modelRegistry.getError(),
    modelOptions,
    configuredModels,
    resolvedModel: configuredModels.find((model) => model.authConfigured),
  };
}

export function createOmniCompactController(
  modelRegistry: ModelRegistry
): OmniCompactController {
  let runtimeStatus = buildRuntimeStatus(modelRegistry, loadSettings());

  return {
    getConfig(): OmniCompactSettings {
      return loadSettings();
    },
    setConfig(next: OmniCompactSettings): OmniCompactSettings {
      const normalized = saveSettings(next);
      runtimeStatus = buildRuntimeStatus(modelRegistry, normalized);
      return normalized;
    },
    resetConfig(): OmniCompactSettings {
      const normalized = resetSettings();
      runtimeStatus = buildRuntimeStatus(modelRegistry, normalized);
      return normalized;
    },
    getConfigPath(): string {
      return getSettingsPath();
    },
    getRuntimeStatus(): OmniCompactRuntimeStatus {
      return runtimeStatus;
    },
    refreshRuntimeStatus(): OmniCompactRuntimeStatus {
      runtimeStatus = buildRuntimeStatus(modelRegistry, loadSettings());
      return runtimeStatus;
    },
  };
}
