# Atlas

**An AI-powered Engineering Intelligence Platform.** Atlas connects to a company's AWS (read-only) and GitHub, builds a continuously-updated **knowledge graph** of their infrastructure, code, deployments, and dependencies, and lets engineers understand it through visualization, search, and a **cited AI interface**.

> The knowledge graph is the product. The AI is the interface.

## Status

📘 **Design blueprint complete** (19 docs, v1.0). Code not yet started.

## Start here

| If you want to… | Open |
|---|---|
| Understand the project & how we work | [`CLAUDE.md`](CLAUDE.md) |
| Navigate the full design | [`docs/README.md`](docs/README.md) |
| See current status & what's next | [`docs/PROJECT-BOARD.md`](docs/PROJECT-BOARD.md) |
| Read the vision | [`docs/00-project-overview.md`](docs/00-project-overview.md) |

## Working on Atlas (Claude Code)

- `/resume` — load project state and propose the next step
- `/board` — update the task board / activity log
- `/atlas-doc` — author or revise a design doc in house style

**Stack:** TypeScript · NestJS · Next.js + shadcn/ui · PostgreSQL · OpenSearch · Redis/BullMQ · S3 · ECS Fargate · Google OAuth · Claude.
