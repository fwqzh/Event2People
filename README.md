# Event2People

Event-first frontier tracking app for GitHub / arXiv discovery, people mapping, and Pipeline action.

## Stack

- Next.js App Router
- TypeScript
- Prisma + SQLite
- Vitest

## Local setup

```bash
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
npm install
npm run db:setup
npm run dev
```

Open:

- `/` Event Board
- `/pipeline` Pipeline
- `/admin/refresh` manual refresh panel

## Environment

Use `.env` or copy `.env.example`.

Required for local demo:

- `DATABASE_URL="file:./dev.db"`
- `ADMIN_REFRESH_SECRET`

Optional for live refresh:

- `GITHUB_TOKEN`
- `TAVILY_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (defaults to `gpt-5-mini`)
- `OPENAI_BASE_URL` (optional, for OpenAI-compatible providers)

## Commands

```bash
npm run dev
npm run lint
npm test
npm run build
npm run db:setup
```

## Notes

- Homepage is event-first and split into GitHub / arXiv sections.
- Event Detail allows saving people to Pipeline only.
- Pipeline is the only page with contact workflow.
- All Chinese display copy is precomputed or template-generated before render.
- When `OPENAI_API_KEY` is configured, refresh runs use the OpenAI Responses API to enrich event and person Chinese copy before publish.
- Refresh uses dataset versioning so the UI keeps serving the previous active dataset until the new one is published.
