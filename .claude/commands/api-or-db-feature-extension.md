---
name: api-or-db-feature-extension
description: Workflow command scaffold for api-or-db-feature-extension in self_print.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /api-or-db-feature-extension

Use this workflow when working on **api-or-db-feature-extension** in `self_print`.

## Goal

Add or extend backend functionality by updating database logic and/or API endpoints, often with corresponding test updates.

## Common Files

- `src/lib/db-supabase.ts`
- `src/lib/db.ts`
- `src/app/api/jobs/route.ts`
- `src/app/api/uploads/sign/route.ts`
- `src/lib/db.bulk.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update or add logic in src/lib/db*.ts (database logic)
- Update or add API endpoint in src/app/api/**/*.ts
- Update or add tests in src/lib/*.test.ts

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.