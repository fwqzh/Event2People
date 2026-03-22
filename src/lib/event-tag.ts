import type { EventTag } from "@/lib/types";

const TAG_RULES: Array<{ tag: EventTag; keywords: string[] }> = [
  { tag: "Coding Agent", keywords: ["coding agent", "codegen", "developer tool", "codex"] },
  { tag: "AI Agent", keywords: ["agent", "tool use", "computer use", "browser agent"] },
  { tag: "Embodied AI", keywords: ["embodied", "embodied ai"] },
  { tag: "Robotics", keywords: ["robot", "robotics", "manipulation", "locomotion"] },
  { tag: "Multimodal", keywords: ["multimodal", "vision-language", "vlm", "vision"] },
  { tag: "Reasoning", keywords: ["reasoning", "planning", "search"] },
  { tag: "Research Infra", keywords: ["benchmark", "eval", "dataset", "training stack", "inference infra"] },
  { tag: "Voice", keywords: ["voice", "speech", "audio"] },
  { tag: "Video", keywords: ["video", "diffusion video"] },
  { tag: "World Model", keywords: ["world model", "simulation", "simulator"] },
  { tag: "Open Source Infra", keywords: ["framework", "sdk", "orchestration", "infra"] },
];

export function classifyEventTag(inputs: string[]) {
  const haystack = inputs.join(" ").toLowerCase();

  for (const rule of TAG_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return { tag: rule.tag, confidence: 0.9 };
    }
  }

  return { tag: "Other" as EventTag, confidence: 0.35 };
}
