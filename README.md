# Agentic Coding Starter Kit

A production-oriented starter kit for building AI-powered web apps with an agentic development workflow. It gives you a working Next.js app, authentication, PostgreSQL, Drizzle ORM, AI SDK integration, shadcn/ui components, and project instructions that help coding agents plan, split, implement, review, and verify changes.

The goal is simple: install the starter, describe the product you want to build, and let your coding agent help turn the boilerplate into your actual POC, MVP, or internal tool.

## Nueva app en 1 comando

Crea el repo de GitHub, la base de Neon, el proyecto de Vercel (+ Blob), el login con Google, el `.env` y el primer deploy:

```bash
git clone https://github.com/Julianchoo/agentic-coding-starter-kit mi-app
cd mi-app && pnpm i && pnpm bootstrap mi-app
```

Requisitos, opciones y detalles en [docs/bootstrap.md](docs/bootstrap.md).

## What You Get

- **Next.js 16 and React 19** with the App Router
- **TypeScript** and a strict project setup
- **Better Auth** with email/password enabled by default
- **PostgreSQL and Drizzle ORM** for schema and migrations
- **AI SDK and OpenRouter** for chat and AI features
- **shadcn/ui, Tailwind CSS, and Lucide icons** for the UI foundation
- **Local or Vercel Blob file storage** through one storage abstraction
- **Agent instructions** through `AGENTS.md` and `CLAUDE.md`
- **Agent skills** for specs, implementation, reviews, security scans, UI work, and shipping

## Quick Start

Create a new app with the CLI:

```bash
npx create-agentic-app@latest my-app
cd my-app
```

Or create the app in the current directory:

```bash
npx create-agentic-app@latest .
```

Then configure and run the app:

```bash
cp env.example .env
# edit .env: set POSTGRES_URL (Docker URL below) and BETTER_AUTH_SECRET
docker compose up -d
pnpm db:migrate
pnpm dev
```

Or skip all of that with `pnpm bootstrap mi-app` (see [Nueva app en 1 comando](#nueva-app-en-1-comando)).

Open [http://localhost:3000](http://localhost:3000).

The CLI copies the starter files, installs dependencies with your selected package manager, and prepares the environment file. If you use `npm`, replace the `pnpm` commands above with `npm run`.

## Guided Setup with Claude Code (Optional)

If you use Claude Code, you can install the `create-agentic-app` skill and have Claude walk you through the entire setup — folder strategy, package manager, PostgreSQL (Docker / Neon / Vercel / BYO), `.env` config, migrations, optional integrations (OpenRouter, Vercel Blob, Polar, email), build verification, and dev-server check — ending at a verified `http://localhost:3000`.

Install the skill:

```bash
npx skills add leonvanzyl/agentic-coding-starter-kit@create-agentic-app --agent claude-code
```

The `--agent claude-code` flag is required. Without it, the installer drops the skill into 37+ IDE adapter folders at the project root.

Once installed, ask Claude something like:

```text
Scaffold a new Agentic Coding Starter Kit project here.
```

Claude will run the skill end-to-end and ask you the few decisions it actually needs to make.

## Prerequisites

- Node.js 18 or newer
- Git
- PostgreSQL, either through the included Docker Compose file or a hosted provider
- A package manager: `pnpm`, `npm`, or `yarn`
- Optional: an OpenRouter API key for AI chat features
- Optional: a Vercel account for deployment, hosted Postgres, and Blob storage

## Environment Variables

Start from `env.example` and update values for your environment:

```env
# Database (Neon pooled URL; `pnpm bootstrap` fills it in)
POSTGRES_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require

# Authentication - Better Auth
BETTER_AUTH_SECRET=

# Google OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# AI Integration via OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL="openai/gpt-5-mini"

# Optional - for vector search only
OPENAI_EMBEDDING_MODEL="text-embedding-3-large"

# App URL
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# File storage
BLOB_READ_WRITE_TOKEN=

# Polar payment processing
POLAR_WEBHOOK_SECRET=polar_
POLAR_ACCESS_TOKEN=polar_
```

`pnpm bootstrap` fills in these values for you (see [docs/bootstrap.md](docs/bootstrap.md)). To use the included `docker-compose.yml` instead, set `POSTGRES_URL=postgresql://dev_user:dev_password@localhost:5432/postgres_dev`.

`BETTER_AUTH_SECRET` ships empty. Generate one with `openssl rand -base64 32` (`pnpm bootstrap` does this for you).

## Default Auth

The starter now defaults to **email and password authentication** through Better Auth. This keeps the first setup small and helps you start building POCs and MVPs without creating OAuth credentials up front.

The current auth setup includes:

- user registration
- email/password login
- protected routes
- password reset flow
- email verification flow

In development, verification and password reset links are logged to the terminal instead of being sent through an email provider. When you are ready for production, ask your coding agent to connect an email service and update the Better Auth email callbacks.

### Google OAuth

Google sign-in is built in but only turns on when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. A "Continue with Google" button then appears on `/login` and `/register`. The OAuth redirect URI is `<app url>/api/auth/callback/google`. `pnpm bootstrap` creates the Google Cloud project and walks you through creating the OAuth client.

## Build With an Agent

This starter is designed to be used with coding agents. The generated project includes instructions that tell agents how to plan, ask questions, split work, use sub-agents when useful, follow the design system, and verify changes.

- `AGENTS.md` is the main instruction file for Codex, Cursor, and other agent-compatible tools.
- `CLAUDE.md` points Claude users to the same project guidance.
- `.agents/skills/` and `.claude/skills/` include optional workflows for more specialized tasks.
- `DESIGN.md` defines the UI design system agents should follow.

The default workflow does not require slash commands or a separate spec file.

### Recommended Default Workflow

1. Install the starter and open the project in your coding-agent environment.
2. Switch your agent tool to planning mode.
3. Describe the app you want to build in plain language.
4. Let the agent ask clarifying questions and shape a clear plan.
5. Confirm the plan once the goal, scope, constraints, and success criteria are clear.
6. Switch your agent tool to edit mode.
7. Ask the agent to implement the approved plan.
8. The main agent should split the work into parallel streams, silos, or feature chunks that fit within context.
9. The agent should use sub-agents to implement those chunks in parallel where useful, then coordinate the results.
10. The agent should run quality checks such as lint, typecheck, and build.
11. Review the result in the browser and iterate.

You do not need a special command for this default workflow. The project instructions already tell the agent how to plan, split implementation work, use sub-agents, and verify the result.

## Starter Prompt

Use this as a first message to your coding agent after installing the starter:

```text
I am using the Agentic Coding Starter Kit. Treat the existing app as boilerplate that should be replaced by the product I describe.

Use the project instructions in AGENTS.md or CLAUDE.md. During planning, ask clarifying questions before making assumptions. During implementation, split the work into small chunks, use sub-agents where useful, follow DESIGN.md for UI, preserve the existing tech stack unless there is a good reason to change it, and run lint, typecheck, and build before finishing.

What I want to build:
[Describe your app here]
```

For example:

```text
What I want to build:
A lightweight CRM for solo consultants. It should let users manage clients, track deals, write notes, set follow-up reminders, and view a simple dashboard of open opportunities.
```

## When to Use Specs

For most POCs and MVPs, the normal agent workflow is enough. Use a spec when the feature is large, long-running, risky, or needs to be split across multiple implementation sessions.

The starter includes two skills for that workflow:

- `create-spec`: turns a planning conversation into `specs/{feature}/` with requirements, task files, dependency waves, and manual action notes.
- `implement-feature`: reads a spec folder and coordinates implementation wave by wave with review gates.

Use this workflow when:

- the feature spans many files or modules
- multiple agents should work in parallel
- the implementation may take more than one session
- you need resumable progress tracking
- you want a written implementation record before coding starts

Example agent request:

```text
Create a spec for the billing and subscriptions feature we just planned. Break it into parallel implementation waves and include any manual setup steps.
```

Then:

```text
Implement the billing and subscriptions spec from specs/billing-subscriptions.
```

## Project Structure

```text
src/
├── app/
│   ├── (auth)/
│   │   ├── forgot-password/
│   │   ├── login/
│   │   ├── register/
│   │   └── reset-password/
│   ├── api/
│   │   ├── auth/
│   │   ├── chat/
│   │   └── diagnostics/
│   ├── chat/
│   ├── dashboard/
│   ├── profile/
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── auth/
│   ├── ui/
│   ├── site-footer.tsx
│   └── site-header.tsx
├── hooks/
└── lib/
    ├── auth.ts
    ├── auth-client.ts
    ├── db.ts
    ├── env.ts
    ├── schema.ts
    ├── session.ts
    ├── storage.ts
    └── utils.ts
```

Important root files:

- `AGENTS.md`: coding-agent behavior rules
- `CLAUDE.md`: Claude entrypoint for the same guidance
- `DESIGN.md`: UI design system and component guidance
- `drizzle.config.ts`: Drizzle migration configuration
- `docker-compose.yml`: local PostgreSQL service
- `env.example`: environment variable template
- `components.json`: shadcn/ui configuration

## Available Scripts

```bash
pnpm dev           # Start the development server with Turbopack
pnpm build         # Run migrations, then build for production
pnpm build:ci      # Build without running migrations
pnpm start         # Start the production server
pnpm lint          # Run ESLint
pnpm typecheck     # Run TypeScript without emitting files
pnpm check         # Run lint and typecheck
pnpm format        # Format the repository
pnpm format:check  # Check formatting
pnpm setup         # Run the setup script
pnpm db:generate   # Generate Drizzle migrations
pnpm db:migrate    # Run Drizzle migrations
pnpm db:studio     # Open Drizzle Studio
```

The repository also contains Drizzle push/reset helper scripts for local experimentation. For schema changes you intend to keep, prefer:

```bash
pnpm db:generate
pnpm db:migrate
```

Do not use schema push as a replacement for migrations in real project work.

## Database Workflow

For local development:

```bash
docker compose up -d
pnpm db:migrate
```

When your app needs schema changes, ask your agent to update `src/lib/schema.ts`, generate a migration, and run it:

```bash
pnpm db:generate
pnpm db:migrate
```

If you deploy to Vercel or another hosted environment, set `POSTGRES_URL` in that environment before running migrations or building the app.

## AI Features

The starter uses the Vercel AI SDK with OpenRouter. Set these variables to enable AI chat:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_MODEL="openai/gpt-5-mini"
```

OpenRouter lets you switch models without changing the application code. Update `OPENROUTER_MODEL` when you want to try a different model.

## File Storage

The starter includes a storage abstraction that can use local storage in development or Vercel Blob in production.

For local development, leave `BLOB_READ_WRITE_TOKEN` empty. Files are stored under `public/uploads/`.

For Vercel Blob:

1. Create a Blob store in Vercel.
2. Copy the `BLOB_READ_WRITE_TOKEN`.
3. Add it to your production environment variables.

The app chooses the storage backend based on whether `BLOB_READ_WRITE_TOKEN` is configured.

## Deployment

Vercel is the recommended deployment target.

```bash
npm install -g vercel
vercel --prod
```

Set the required production environment variables:

- `POSTGRES_URL`
- `BETTER_AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `OPENROUTER_API_KEY`, if using AI features
- `OPENROUTER_MODEL`, if using AI features
- `BLOB_READ_WRITE_TOKEN`, if using Vercel Blob
- `POLAR_WEBHOOK_SECRET` and `POLAR_ACCESS_TOKEN`, if using Polar payments

The default `pnpm build` script runs database migrations before `next build`. If your CI or host should not run migrations during build, use `pnpm build:ci` and run migrations as a separate deployment step.

## Troubleshooting

### The app cannot connect to Postgres

Confirm Docker is running and start the database:

```bash
docker compose up -d
```

Then check that `POSTGRES_URL` in `.env` matches the database connection string.

### Auth reset or verification emails are not arriving

In development, links are logged to the terminal. This is intentional. Connect an email provider before using password reset or verification in production.

### AI chat is not working

Set `OPENROUTER_API_KEY` and restart the dev server. Also confirm `OPENROUTER_MODEL` is a model available to your OpenRouter account.

### My agent is preserving too much boilerplate

Tell the agent directly that the starter UI is scaffolding and should be replaced:

```text
Replace the starter UI with the actual product UI. Do not keep setup checklists, placeholder navigation, demo content, or boilerplate copy unless I explicitly ask for it.
```

### I need Google login

Ask your agent to add Google OAuth through Better Auth while keeping email/password enabled. You will need Google OAuth credentials and production callback URLs.

## Video Tutorial

Watch the original walkthrough:

[Agentic Coding Boilerplate Tutorial](https://youtu.be/zVZotTk6ZWU)

Some details in older videos may differ from the current starter. This README is the source of truth for the current default workflow.

## Support This Project

If this starter kit helped you build something useful, you can support the project here:

[Buy me a coffee](https://www.buymeacoffee.com/leonvanzyl)

## Contributing

1. Fork this repository.
2. Create a feature branch.
3. Make your changes.
4. Run the relevant checks.
5. Open a pull request.

## License

This project is licensed under the MIT License.

## Need Help?

- Check the repository issues: [github.com/leonvanzyl/agentic-coding-starter-kit/issues](https://github.com/leonvanzyl/agentic-coding-starter-kit/issues)
- Review `AGENTS.md`, `CLAUDE.md`, and `DESIGN.md`
- Open a new issue with the exact setup steps, error output, and environment details
