const DEFAULT_DATABASE_URL = "file:./dev.db";

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  githubToken: process.env.GITHUB_TOKEN ?? "",
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY ?? "",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  autoRefreshEnabled: process.env.AUTO_REFRESH_ENABLED !== "false",
  autoRefreshIntervalMinutes: parsePositiveInteger(process.env.AUTO_REFRESH_INTERVAL_MINUTES, 60),
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export const hasOpenAiKey = Boolean(env.openAiApiKey);
