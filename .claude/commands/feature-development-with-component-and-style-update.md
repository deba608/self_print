---
name: feature-development-with-component-and-style-update
description: Workflow command scaffold for feature-development-with-component-and-style-update in self_print.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-component-and-style-update

Use this workflow when working on **feature-development-with-component-and-style-update** in `self_print`.

## Goal

Develop a new feature or UI improvement that requires changes to a React component and associated CSS styling.

## Common Files

- `src/components/UploadForm.tsx`
- `src/components/JobDetail.tsx`
- `src/app/globals.css`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement or update the React component in src/components/*.tsx
- Update or add corresponding styles in src/app/globals.css

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.