import { describe, expect, it } from "vitest";

import piOmniCompact from "../../src/index.js";
import { createMockPi } from "../helpers/mocks.js";

describe("extension loading", () => {
  it("exports a default function", () => {
    expect(typeof piOmniCompact).toBe("function");
  });

  it("registers session_before_compact handler", () => {
    const mockPi = createMockPi();

    piOmniCompact(mockPi as never);

    expect(mockPi.on).toHaveBeenCalledWith(
      "session_before_compact",
      expect.any(Function)
    );
  });

  it("registers session_before_tree handler", () => {
    const mockPi = createMockPi();

    piOmniCompact(mockPi as never);

    expect(mockPi.on).toHaveBeenCalledWith(
      "session_before_tree",
      expect.any(Function)
    );
  });

  it("registers exactly two event handlers", () => {
    const mockPi = createMockPi();

    piOmniCompact(mockPi as never);

    expect(mockPi.on).toHaveBeenCalledTimes(2);
  });

  it("registers the omni-compact command", () => {
    const mockPi = createMockPi();

    piOmniCompact(mockPi as never);

    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "omni-compact",
      expect.objectContaining({
        description: expect.stringContaining("configure"),
        handler: expect.any(Function),
      })
    );
  });

  it("does not register any tools", () => {
    const mockPi = createMockPi();

    piOmniCompact(mockPi as never);

    expect(mockPi.registerTool).not.toHaveBeenCalled();
  });
});
