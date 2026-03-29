/**
 * Model resolution for pi-omni-compact.
 *
 * Iterates the configured model list and returns the first model whose
 * request authentication resolves successfully through Pi's model registry.
 */

import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

import type { ModelConfig } from "./settings.js";

export interface ResolvedModel {
  provider: string;
  model: string;
  thinking: string;
}

/**
 * Resolve the first available model from the configured list.
 * Returns undefined if no configured model can resolve request auth.
 */
export async function resolveModel(
  modelRegistry: ModelRegistry,
  models: ModelConfig[]
): Promise<ResolvedModel | undefined> {
  for (const config of models) {
    const model = modelRegistry.find(config.provider, config.id);
    if (!model) {
      continue;
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      continue;
    }

    return {
      provider: config.provider,
      model: config.id,
      thinking: config.thinking,
    };
  }
  return undefined;
}
