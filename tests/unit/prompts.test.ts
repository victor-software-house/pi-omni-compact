import { describe, expect, it } from "vitest";

import {
  BRANCH_SUMMARIZATION_SYSTEM_PROMPT,
  COMPACTION_INCREMENTAL_SYSTEM_PROMPT,
  COMPACTION_SYSTEM_PROMPT,
} from "../../src/prompts.js";

const ALL_PROMPTS = [
  { name: "compaction", prompt: COMPACTION_SYSTEM_PROMPT },
  { name: "incremental", prompt: COMPACTION_INCREMENTAL_SYSTEM_PROMPT },
  { name: "branch", prompt: BRANCH_SUMMARIZATION_SYSTEM_PROMPT },
];

describe("compaction system prompt", () => {
  it("instructs the model to produce a summary, not continue conversation", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain(
      "Do NOT continue the conversation"
    );
    expect(COMPACTION_SYSTEM_PROMPT).toContain(
      "ONLY output the structured summary"
    );
  });

  it("includes the enhanced format sections", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Goal");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Progress");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Key Decisions");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## File Changes");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Code Patterns Established");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Implicit Dependencies");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Open Questions");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Error History");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Next Steps");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("## Critical Context");
  });

  it("includes read-files and modified-files tags", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain("<read-files>");
    expect(COMPACTION_SYSTEM_PROMPT).toContain("<modified-files>");
  });

  it("mentions tool access for reading files", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain("read, grep, find, and ls");
  });

  it("emphasizes density over length", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain("Density over length");
  });

  it("emphasizes capturing what AND why", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain("WHAT changed AND WHY");
  });
});

describe("compaction incremental system prompt", () => {
  it("instructs to merge with existing summary", () => {
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "merge them into an existing summary"
    );
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "<previous-summary>"
    );
  });

  it("instructs to verify prior claims skeptically", () => {
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "VERIFY claims from the previous summary"
    );
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "Drop or correct claims the new messages contradict"
    );
  });

  it("instructs to update progress", () => {
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      'move "In Progress" items to "Done"'
    );
  });

  it("instructs to prune resolved and irrelevant items", () => {
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "PRUNE resolved errors"
    );
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain("Open Questions");
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "items that are no longer relevant"
    );
  });

  it("includes verify prior claims in merge priorities", () => {
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "Verify prior claims"
    );
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "drop anything contradicted by new evidence"
    );
  });

  it("has the same enhanced format as initial prompt", () => {
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain("## Goal");
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain("## File Changes");
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain("## Error History");
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain("## Next Steps");
  });

  it("does not continue conversation", () => {
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "Do NOT continue the conversation"
    );
  });
});

describe("branch summarization system prompt", () => {
  it("focuses on branch context preservation", () => {
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain(
      "branch being abandoned"
    );
  });

  it("emphasizes divergence and outcomes", () => {
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain("diverged");
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain(
      "completed successfully"
    );
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain("failed and why");
  });

  it("instructs for revisit context", () => {
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain("revisits this work");
  });

  it("has the enhanced format sections", () => {
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain("## Goal");
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain("## Progress");
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain("## Next Steps");
  });

  it("does not continue conversation", () => {
    expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain(
      "Do NOT continue the conversation"
    );
  });
});

describe("accuracy rules", () => {
  it("all three prompts contain session type detection rule", () => {
    const rule = "Session type detection";
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain(rule);
    }
  });

  it("all three prompts contain done vs in progress rule", () => {
    const rule = "Done vs In Progress";
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain(rule);
    }
  });

  it("all three prompts contain file modifications rule", () => {
    const rule = "File modifications";
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain(rule);
    }
  });

  it("all three prompts contain exact names rule", () => {
    const rule = "Exact names";
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain(rule);
    }
  });

  it("all three prompts contain confidence markers rule", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain("Confidence markers");
      expect(prompt).toContain("[verified]");
      expect(prompt).toContain("[inferred]");
      expect(prompt).toContain("[uncertain]");
    }
  });
});

describe("tool error resilience", () => {
  it("all three prompts instruct to continue on tool errors", () => {
    for (const { name, prompt } of ALL_PROMPTS) {
      expect(prompt, `${name} missing tool resilience`).toContain(
        "Tool Error Handling"
      );
      expect(prompt, `${name} missing continue instruction`).toContain(
        "Do not abandon the summary"
      );
    }
  });
});

describe("writing rules", () => {
  it("all three prompts include Strunk's principles", () => {
    for (const { name, prompt } of ALL_PROMPTS) {
      expect(prompt, `${name} missing writing rules`).toContain(
        "Writing Rules"
      );
      expect(prompt, `${name} missing active voice`).toContain("Active voice");
      expect(prompt, `${name} missing omit needless words`).toContain(
        "Omit needless words"
      );
      expect(prompt, `${name} missing concrete language`).toContain(
        "Concrete language"
      );
    }
  });

  it("all three prompts include AI anti-patterns", () => {
    for (const { name, prompt } of ALL_PROMPTS) {
      expect(prompt, `${name} missing AI patterns`).toContain(
        "Avoid AI writing patterns"
      );
      expect(prompt, `${name} missing puffery rule`).toContain("No puffery");
      expect(prompt, `${name} missing hedging rule`).toContain("No hedging");
    }
  });
});

describe("implicit dependencies section", () => {
  it("all three prompts include implicit dependencies in format", () => {
    for (const { name, prompt } of ALL_PROMPTS) {
      expect(prompt, `${name} missing implicit dependencies`).toContain(
        "## Implicit Dependencies"
      );
      expect(prompt, `${name} missing env vars`).toContain(
        "Environment variables configured or relied upon"
      );
      expect(prompt, `${name} missing convention-based`).toContain(
        "Convention-based patterns"
      );
    }
  });
});

describe("user compaction note", () => {
  it("compaction prompts mention user-compaction-note", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain("<user-compaction-note>");
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "<user-compaction-note>"
    );
  });

  it("instructs not to treat note as main goal", () => {
    expect(COMPACTION_SYSTEM_PROMPT).toContain(
      "do NOT treat it as the session's main goal"
    );
    expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(
      "do NOT treat it as the session's main goal"
    );
  });
});

describe("prompt distinctness", () => {
  it("initial and incremental prompts are different", () => {
    expect(COMPACTION_SYSTEM_PROMPT).not.toBe(
      COMPACTION_INCREMENTAL_SYSTEM_PROMPT
    );
  });

  it("compaction and branch prompts are different", () => {
    expect(COMPACTION_SYSTEM_PROMPT).not.toBe(
      BRANCH_SUMMARIZATION_SYSTEM_PROMPT
    );
  });

  it("all three prompts share the enhanced format", () => {
    const sharedSections = [
      "## Goal",
      "## Constraints & Preferences",
      "## Progress",
      "## Key Decisions",
      "## File Changes",
      "## Next Steps",
    ];
    for (const section of sharedSections) {
      expect(COMPACTION_SYSTEM_PROMPT).toContain(section);
      expect(COMPACTION_INCREMENTAL_SYSTEM_PROMPT).toContain(section);
      expect(BRANCH_SUMMARIZATION_SYSTEM_PROMPT).toContain(section);
    }
  });
});

describe("session-structure instructions", () => {
  it("all three prompts contain session-structure instructions", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain("session-structure");
      expect(prompt).toContain("## Session Structure");
    }
  });

  it("instructs to verify file claims against files-touched list", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain(
        "Verify file claims against the files-touched list"
      );
    }
  });

  it("instructs to pay attention to friction signals", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain("friction signals");
    }
  });

  it("instructs to use stats for summary density calibration", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt).toContain("calibrate summary density");
    }
  });
});
