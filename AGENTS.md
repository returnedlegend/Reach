<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## GitHub delivery preference

The user requests that completed repository changes be committed and pushed to GitHub after every prompt. Run relevant checks, exclude secrets and private environment files, push the current task branch, and update its pull request when applicable. Do not create empty commits for questions that cause no file changes. This preference does not authorize merging or deployment and can be overridden by a later user instruction.
