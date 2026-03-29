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

export type ModelOptionView = "scoped" | "authenticated" | "all";

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
  modelOptionsByView: Record<ModelOptionView, ModelOption[]>;
  defaultModelView: ModelOptionView;
  configuredModels: ConfiguredModelStatus[];
  resolvedModel?: ConfiguredModelStatus;
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

function buildModelOption(
  model: {
    provider: string;
    id: string;
    name: string;
    reasoning: boolean;
    contextWindow: number;
  },
  authConfigured: boolean,
  view: ModelOptionView
): ModelOption {
  const descriptionParts = [
    model.name,
    formatContextWindow(model.contextWindow),
  ];

  if (model.reasoning) {
    descriptionParts.push("reasoning");
  }

  if (view === "all" && !authConfigured) {
    descriptionParts.push("auth missing");
  }

  return {
    value: toModelOptionValue(model),
    label: toModelOptionValue(model),
    description: descriptionParts.join(" | "),
    provider: model.provider,
    id: model.id,
    authConfigured,
    contextWindow: model.contextWindow,
  };
}

function buildModelOptionsByView(modelRegistry: ModelRegistry, cwd: string) {
  const allModels = modelRegistry.getAll();
  const authenticatedModels = modelRegistry.getAvailable();
  const authenticatedValues = new Set(
    authenticatedModels.map((model) => toModelOptionValue(model))
  );
  const scopePatterns = getScopedModelPatterns(cwd);
  const scopedModels = scopePatterns
    ? authenticatedModels.filter((model) =>
        scopePatterns.some((pattern) =>
          matchesModelPattern(pattern, {
            provider: model.provider,
            id: model.id,
            name: model.name,
          })
        )
      )
    : [];

  const modelOptionsByView: Record<ModelOptionView, ModelOption[]> = {
    scoped: scopedModels
      .map((model) => buildModelOption(model, true, "scoped"))
      .sort(compareModelOptions),
    authenticated: authenticatedModels
      .map((model) => buildModelOption(model, true, "authenticated"))
      .sort(compareModelOptions),
    all: allModels
      .map((model) =>
        buildModelOption(
          model,
          authenticatedValues.has(toModelOptionValue(model)),
          "all"
        )
      )
      .sort(compareModelOptions),
  };

  const usingScopedModels = modelOptionsByView.scoped.length > 0;
  const defaultModelView: ModelOptionView = usingScopedModels
    ? "scoped"
    : modelOptionsByView.authenticated.length > 0
      ? "authenticated"
      : "all";

  return {
    modelOptionsByView,
    authenticatedValues,
    scopedValues: new Set(
      modelOptionsByView.scoped.map((option) => option.value)
    ),
    defaultModelView,
    usingScopedModels,
  };
}

function buildConfiguredModelStatus(
  modelRegistry: ModelRegistry,
  config: OmniCompactSettings,
  allModelOptions: ModelOption[],
  authenticatedValues: Set<string>,
  scopedValues: Set<string>,
  usingScopedModels: boolean
): ConfiguredModelStatus[] {
  const optionByValue = new Map(
    allModelOptions.map((option) => [option.value, option])
  );

  return config.models.map((model, index) => {
    const value = toModelOptionValue(model);
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

    const knownOption = optionByValue.get(value);
    const authConfigured = authenticatedValues.has(value);
    const inScopedView = scopedValues.has(value);
    const descriptionParts = knownOption
      ? knownOption.description.split(" | ")
      : [
          registeredModel.name,
          formatContextWindow(registeredModel.contextWindow),
        ];

    if (
      authConfigured &&
      usingScopedModels &&
      !inScopedView &&
      !descriptionParts.includes("outside scoped models")
    ) {
      descriptionParts.push("outside scoped models");
    }

    if (!authConfigured && !descriptionParts.includes("auth missing")) {
      descriptionParts.push("auth missing");
    }

    return {
      index,
      value,
      label: value,
      description: descriptionParts.join(" | "),
      authConfigured,
      found: true,
    };
  });
}

function buildRuntimeStatus(
  modelRegistry: ModelRegistry,
  cwd: string,
  config: OmniCompactSettings
): OmniCompactRuntimeStatus {
  const views = buildModelOptionsByView(modelRegistry, cwd);
  const configuredModels = buildConfiguredModelStatus(
    modelRegistry,
    config,
    views.modelOptionsByView.all,
    views.authenticatedValues,
    views.scopedValues,
    views.usingScopedModels
  );

  return {
    modelRegistryError: modelRegistry.getError(),
    modelOptionsByView: views.modelOptionsByView,
    defaultModelView: views.defaultModelView,
    configuredModels,
    resolvedModel: configuredModels.find((model) => model.authConfigured),
    usingScopedModels: views.usingScopedModels,
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
