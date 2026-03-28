/**
 * Settings types, normalization, and persistence for pi-omni-compact.
 */

import { getAgentDir } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";
const UNKNOWN_RECORD_SCHEMA = z.record(z.string(), z.unknown());
const BOOLEAN_SCHEMA = z.boolean();
const MIN_SUMMARY_CHARS_SCHEMA = z.number().int().positive().max(100_000);
const MODEL_CONFIG_SCHEMA = z.object({
  provider: z.string().trim().min(1),
  id: z.string().trim().min(1),
  thinking: z.enum(THINKING_LEVELS).default(DEFAULT_THINKING_LEVEL),
});

export interface ModelConfig {
  provider: string;
  id: string;
  thinking: ThinkingLevel;
}

export interface OmniCompactSettings {
  models: ModelConfig[];
  debugCompactions: boolean;
  minSummaryChars: number;
}

const DEFAULT_SETTINGS: OmniCompactSettings = {
  models: [
    {
      provider: "google-antigravity",
      id: "gemini-3-flash",
      thinking: DEFAULT_THINKING_LEVEL,
    },
    {
      provider: "google-antigravity",
      id: "gemini-3-pro-low",
      thinking: DEFAULT_THINKING_LEVEL,
    },
  ],
  debugCompactions: false,
  minSummaryChars: 100,
};

function cloneModel(model: ModelConfig): ModelConfig {
  return {
    provider: model.provider,
    id: model.id,
    thinking: model.thinking,
  };
}

function cloneModels(models: ModelConfig[]): ModelConfig[] {
  return models.map(cloneModel);
}

export function getDefaultSettings(): OmniCompactSettings {
  return {
    models: cloneModels(DEFAULT_SETTINGS.models),
    debugCompactions: DEFAULT_SETTINGS.debugCompactions,
    minSummaryChars: DEFAULT_SETTINGS.minSummaryChars,
  };
}

function normalizeModels(rawModels: unknown[]): ModelConfig[] {
  const normalized: ModelConfig[] = [];
  const seen = new Set<string>();

  for (const rawModel of rawModels) {
    const parsed = MODEL_CONFIG_SCHEMA.safeParse(rawModel);
    if (!parsed.success) {
      continue;
    }

    const key = `${parsed.data.provider}/${parsed.data.id}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(parsed.data);
  }

  return normalized;
}

export function normalizeSettings(raw: unknown): OmniCompactSettings {
  const parsed = UNKNOWN_RECORD_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    return getDefaultSettings();
  }

  const rawData = parsed.data;
  const models = Array.isArray(rawData.models)
    ? normalizeModels(rawData.models)
    : cloneModels(DEFAULT_SETTINGS.models);
  const debugCompactions = BOOLEAN_SCHEMA.safeParse(rawData.debugCompactions);
  const minSummaryChars = MIN_SUMMARY_CHARS_SCHEMA.safeParse(
    rawData.minSummaryChars
  );

  return {
    models,
    debugCompactions: debugCompactions.success
      ? debugCompactions.data
      : DEFAULT_SETTINGS.debugCompactions,
    minSummaryChars: minSummaryChars.success
      ? minSummaryChars.data
      : DEFAULT_SETTINGS.minSummaryChars,
  };
}

export function getLegacySettingsPath(): string {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(extensionDir, "..", "settings.json");
}

export function getSettingsPath(): string {
  return path.join(getAgentDir(), "pi-omni-compact.json");
}

function readSettingsFile(
  settingsPath: string
): OmniCompactSettings | undefined {
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function serializeSettings(settings: OmniCompactSettings): string {
  return `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`;
}

/**
 * Load settings from the user config path, falling back to the legacy
 * package-adjacent settings.json for backward compatibility.
 */
export function loadSettings(): OmniCompactSettings {
  return (
    readSettingsFile(getSettingsPath()) ??
    readSettingsFile(getLegacySettingsPath()) ??
    getDefaultSettings()
  );
}

export function saveSettings(
  settings: OmniCompactSettings
): OmniCompactSettings {
  const normalized = normalizeSettings(settings);
  const settingsPath = getSettingsPath();

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, serializeSettings(normalized), "utf8");

  return normalized;
}

export function resetSettings(): OmniCompactSettings {
  return saveSettings(getDefaultSettings());
}
