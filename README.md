# Event2People

Event2People, surfaced in the UI as **LANCHI SIGNAL**, is an event-first intelligence workspace for finding the people behind frontier projects.

Instead of starting from a company list or a CRM, the product starts from fresh public signals across **GitHub**, **arXiv**, and **Kickstarter**, then turns those signals into structured event cards, linked people profiles, and a lightweight action pipeline. The goal is simple: when something important starts moving, help you see **who is behind it**, **why it matters**, and **who you may want to contact next**.

The current UI is primarily Chinese, but the product flow and deployment model are documented here in English.

## What the product does

Event2People continuously watches three types of frontier signals:

- **GitHub Trending** for fast-moving open-source projects and maintainers
- **arXiv + Semantic Scholar** for fresh research papers, authors, and paper/code links
- **Kickstarter Technology** for demand-side signals around new hardware and AI-adjacent products

For each source, the app builds a structured event layer:

- normalizes raw source data into event cards
- extracts projects, papers, creators, authors, and contributors
- links events back to people
- attaches source links, metrics, and supporting evidence
- optionally uses OpenAI to enrich copy and summaries

The result is a workflow that looks like this:

1. **Discover signals** from public sources
2. **Resolve people** behind those signals
3. **Review context** on the event card
4. **Save interesting people** into the Pipeline
5. **Use contact links and generated summaries** for follow-up

## Core product surfaces

### Signal boards

- `/github` shows GitHub Trending projects ranked by daily momentum
- `/arxiv` shows recent papers filtered into an active pool and ranked with recency plus impact signals
- `/kickstarter` shows technology campaigns filtered for stronger AI/hardware relevance

### Pipeline

- `/pipeline` is the action workspace
- saved people keep source context, project links, and contact links when available
- each saved entry can be copied into an outreach or research workflow

### Settings

- `/settings` lets you store runtime API credentials from the UI
- saved settings are written to a local JSON file, not to the database

### Refresh operations

- users can trigger a manual refresh from the header or admin refresh API
- the app also starts an in-process background refresh scheduler when `AUTO_REFRESH_ENABLED` is not `false`

## Tech stack

- **Next.js 16 App Router**
- **React 19**
- **Prisma**
- **SQLite**
- **Playwright** for parts of the Kickstarter collection flow
- **OpenAI** for optional enrichment

## Local development

### Requirements

- Node.js `20.9+`
- npm
- a writable filesystem

### Fastest local setup

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

`npm run db:setup` is a **local bootstrap helper**. It recreates `prisma/dev.db`, applies the schema, and seeds sample data.

## Environment variables

Create a `.env` file from `.env.example` and update the values you need.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Prisma database connection. Default is SQLite at `file:./dev.db`, which resolves to `prisma/dev.db` in this repository. |
| `GITHUB_TOKEN` | Recommended | Improves GitHub API access for repo, contributor, and README enrichment. |
| `SEMANTIC_SCHOLAR_API_KEY` | Recommended | Improves arXiv paper enrichment and citation signals. |
| `TAVILY_API_KEY` | Recommended | Used for search-based enrichment, especially around people, papers, repos, and Kickstarter discovery. |
| `OPENAI_API_KEY` | Optional | Enables AI-written summaries and enrichment. |
| `OPENAI_MODEL` | Optional | Defaults to `gpt-5-mini`. |
| `OPENAI_BASE_URL` | Optional | Use this for an OpenAI-compatible gateway. |
| `AUTO_REFRESH_ENABLED` | Optional | Set to `false` to disable the background scheduler. |
| `AUTO_REFRESH_INTERVAL_MINUTES` | Optional | Background refresh interval. Defaults to `60`. |
| `NEXT_PUBLIC_APP_URL` | Optional | Public app URL; keep it accurate in production. |
| `EVENT2PEOPLE_SETTINGS_PATH` | Optional | Path for runtime settings storage. Defaults to `.local/settings.json`. |

## Data and persistence

There are **two local state locations** you should treat as persistent in deployment:

- the database file behind `DATABASE_URL`
- the runtime settings file at `.local/settings.json` by default

If either location is ephemeral, you may lose data or saved API credentials after a restart.

If the app starts with an empty database but the schema already exists, it can seed a sample dataset automatically on first use. That is useful for demos, but production deployments usually want real refresh runs and persistent storage.

## Deployment recommendation

### Recommended target

Use a **long-lived Node.js server** or a **container with persistent storage**.

This project is not a great fit for purely static hosting, and it is not ideal for short-lived serverless runtimes in its current form because it relies on:

- a writable SQLite database
- a writable local settings file
- an in-process refresh scheduler
- Playwright for parts of the Kickstarter ingestion path

Platforms such as a VM, Railway with persistent storage, Render with disk, Fly.io with a volume, or your own Docker host are a better fit than purely ephemeral deployments.

## Production deployment steps

### 1. Install dependencies

```bash
npm ci
```

### 2. Provide environment variables

At minimum, set:

```bash
DATABASE_URL="file:./dev.db"
NEXT_PUBLIC_APP_URL="https://your-domain.example"
```

Add the API keys you want for better signal quality and enrichment.

### 3. Initialize the database schema

Use Prisma directly in production:

```bash
npx prisma generate
npx prisma db push
```

Do **not** use `npm run db:push` or `npm run db:setup` in production if you want to preserve data. The helper scripts are designed for disposable local SQLite bootstrapping and can recreate the local database file.

### 4. Install Playwright browser binaries

If you want the full Kickstarter collection flow to work in production, install Chromium:

```bash
npx playwright install chromium
```

On some Linux hosts or containers, you may need:

```bash
npx playwright install --with-deps chromium
```

### 5. Build the app

```bash
npm run build
```

### 6. Start the server

```bash
npm run start
```

By default, Next.js will serve the app on port `3000`.

## Operational notes

### Background refresh

Automatic refresh only works while your Node process is running continuously. If you deploy to a platform that frequently suspends or replaces instances, scheduled refresh behavior will be unreliable.

### Manual refresh

Users can still trigger refresh manually from the UI or through the refresh API even if automatic refresh is disabled.

### Runtime settings UI

The Settings page writes provider credentials into a local JSON file. In production, make sure the path is writable and persisted, or manage credentials through environment variables instead.

## Project routes

| Route | Purpose |
| --- | --- |
| `/github` | GitHub signal board |
| `/arxiv` | Research signal board |
| `/kickstarter` | Kickstarter signal board |
| `/pipeline` | Saved people and action workspace |
| `/settings` | Runtime API settings |
| `/admin/refresh` | Refresh monitoring view |

## Suggested production checklist

- Use Node.js `20.9+`
- Mount persistent storage for the SQLite database
- Mount persistent storage for `.local/settings.json`, or use env vars only
- Run `npx prisma db push` before first start
- Install Playwright Chromium if Kickstarter matters for your deployment
- Keep `AUTO_REFRESH_ENABLED=true` only on a long-lived process

## License

No license file is currently included in this repository.
