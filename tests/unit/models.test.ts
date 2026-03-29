import { describe, expect, it, vi } from "vitest";

import type { ModelConfig } from "../../src/settings.js";

import { resolveModel } from "../../src/models.js";

function createMockRegistry() {
  return {
    find: vi.fn(),
    getApiKeyAndHeaders: vi.fn(),
  };
}

const testModels: ModelConfig[] = [
  { provider: "google", id: "gemini-flash", thinking: "high" },
  { provider: "google", id: "gemini-pro", thinking: "medium" },
  { provider: "openai", id: "gpt-4", thinking: "low" },
];

describe("resolveModel", () => {
  it("returns the first model whose request auth resolves", async () => {
    const registry = createMockRegistry();
    const mockModel = { provider: "google", id: "gemini-flash" };
    registry.find.mockReturnValue(mockModel);
    registry.getApiKeyAndHeaders.mockResolvedValue({
      ok: true,
      apiKey: "sk-test-key",
      headers: { "x-test": "1" },
    });

    const result = await resolveModel(registry as never, testModels);

    expect(result).toStrictEqual({
      provider: "google",
      model: "gemini-flash",
      thinking: "high",
    });
    expect(registry.find).toHaveBeenCalledWith("google", "gemini-flash");
  });

  it("skips models not found in registry", async () => {
    const registry = createMockRegistry();
    registry.find
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ provider: "google", id: "gemini-pro" });
    registry.getApiKeyAndHeaders.mockResolvedValue({
      ok: true,
      apiKey: "sk-pro-key",
    });

    const result = await resolveModel(registry as never, testModels);

    expect(result).toStrictEqual({
      provider: "google",
      model: "gemini-pro",
      thinking: "medium",
    });
    expect(registry.find).toHaveBeenCalledTimes(2);
  });

  it("skips models whose request auth fails", async () => {
    const registry = createMockRegistry();
    const model1 = { provider: "google", id: "gemini-flash" };
    const model2 = { provider: "google", id: "gemini-pro" };
    registry.find.mockReturnValueOnce(model1).mockReturnValueOnce(model2);
    registry.getApiKeyAndHeaders
      .mockResolvedValueOnce({ ok: false, error: "Missing API key" })
      .mockResolvedValueOnce({ ok: true, apiKey: "sk-pro-key" });

    const result = await resolveModel(registry as never, testModels);

    expect(result?.model).toBe("gemini-pro");
    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledTimes(2);
  });

  it("accepts header-only request auth", async () => {
    const registry = createMockRegistry();
    registry.find.mockReturnValue({ provider: "test", id: "header-only" });
    registry.getApiKeyAndHeaders.mockResolvedValue({
      ok: true,
      headers: { Authorization: "Bearer token" },
    });

    const result = await resolveModel(registry as never, [
      { provider: "test", id: "header-only", thinking: "high" },
    ]);

    expect(result).toStrictEqual({
      provider: "test",
      model: "header-only",
      thinking: "high",
    });
  });

  it("returns undefined when no model can resolve request auth", async () => {
    const registry = createMockRegistry();
    registry.find.mockReturnValue({ provider: "test", id: "test" });
    registry.getApiKeyAndHeaders.mockResolvedValue({
      ok: false,
      error: "Missing API key",
    });

    const result = await resolveModel(registry as never, testModels);

    expect(result).toBeUndefined();
  });

  it("returns undefined for empty model list", async () => {
    const registry = createMockRegistry();
    const result = await resolveModel(registry as never, []);
    expect(result).toBeUndefined();
  });

  it("uses the first available model, not later ones", async () => {
    const registry = createMockRegistry();
    registry.find.mockReturnValueOnce({
      provider: "google",
      id: "gemini-flash",
    });
    registry.getApiKeyAndHeaders.mockResolvedValue({
      ok: true,
      apiKey: "key",
    });

    const result = await resolveModel(registry as never, testModels);

    expect(result?.model).toBe("gemini-flash");
    expect(registry.find).toHaveBeenCalledOnce();
  });
});
