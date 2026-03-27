import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { readStringArray } from "@/lib/json";
import { buildPersonLinks } from "@/lib/person-links";
import { parseLinks, parseMetrics } from "@/lib/seed";

describe("data safety helpers", () => {
  it("filters malformed string arrays and trims valid values", () => {
    expect(readStringArray([" Alice ", "", null, 42, "Bob"])).toEqual(["Alice", "Bob"]);
  });

  it("keeps only well-formed metric and link records", () => {
    expect(
      parseMetrics([
        { label: " today stars ", value: " +420 " },
        { label: "", value: "100" },
        { label: "contributors" },
      ] as Prisma.JsonValue),
    ).toEqual([{ label: "today stars", value: "+420" }]);

    expect(
      parseLinks([
        { label: " GitHub ", url: "https://github.com/example/open-manu" },
        { label: "", url: "https://invalid.example.com" },
        { label: "Broken" },
      ] as Prisma.JsonValue),
    ).toEqual([{ label: "GitHub", url: "https://github.com/example/open-manu" }]);
  });

  it("reuses fallback source urls only when no direct profile links exist", () => {
    expect(
      buildPersonLinks({
        email: "alice@example.com",
        sourceUrls: ["https://github.com/alice"],
      }),
    ).toEqual([{ label: "Email", url: "mailto:alice@example.com" }]);

    expect(
      buildPersonLinks({
        sourceUrls: ["https://github.com/alice", "https://alice.example.com"],
      }),
    ).toEqual([
      { label: "GitHub", url: "https://github.com/alice" },
      { label: "外链", url: "https://alice.example.com" },
    ]);
  });
});
