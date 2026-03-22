const DEFAULT_DATABASE_URL = "file:./dev.db";

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  githubToken: process.env.GITHUB_TOKEN ?? "",
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY ?? "",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  adminRefreshSecret: process.env.ADMIN_REFRESH_SECRET ?? "event2people-admin",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export const hasOpenAiKey = Boolean(env.openAiApiKey);
