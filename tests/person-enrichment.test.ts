import { describe, expect, it } from "vitest";

import { parseHomepageSignals, pickBestSearchResult } from "@/lib/sources/github-people";

describe("github owner enrichment helpers", () => {
  it("extracts public contact and profile links from homepage html", () => {
    const html = `
      <html>
        <head>
          <title>Alice Chen</title>
          <meta name="description" content="Robotics engineer building embodied agents at OpenAI" />
        </head>
        <body>
          <a href="mailto:alice@alicechen.ai">Email</a>
          <a href="https://www.linkedin.com/in/alice-chen">LinkedIn</a>
          <a href="https://scholar.google.com/citations?user=alice">Scholar</a>
          <a href="https://x.com/alicechen">X</a>
          <a href="https://github.com/alice-chen">GitHub</a>
        </body>
      </html>
    `;

    const result = parseHomepageSignals(html, "https://alicechen.ai");

    expect(result.email).toBe("alice@alicechen.ai");
    expect(result.linkedinUrl).toBe("https://www.linkedin.com/in/alice-chen");
    expect(result.scholarUrl).toBe("https://scholar.google.com/citations?user=alice");
    expect(result.xUrl).toBe("https://x.com/alicechen");
    expect(result.githubUrl).toBe("https://github.com/alice-chen");
  });

  it("keeps only high-confidence search profile matches", () => {
    const context = {
      login: "alice-chen",
      ownerUrl: "https://github.com/alice-chen",
      repoNames: ["open/alpha"],
      repoDescriptions: ["Embodied agent runtime"],
    };

    const url = pickBestSearchResult(
      [
        {
          title: "Alice Chen - LinkedIn",
          url: "https://www.linkedin.com/in/alice-chen",
          content: "Alice Chen, GitHub alice-chen, builder of open alpha",
        },
        {
          title: "Alice Johnson - LinkedIn",
          url: "https://www.linkedin.com/in/alice-johnson",
          content: "Finance and operations leader",
        },
      ],
      context,
      "Alice Chen",
      "OpenAI",
      "linkedin",
    );

    expect(url).toBe("https://www.linkedin.com/in/alice-chen");
  });
});
