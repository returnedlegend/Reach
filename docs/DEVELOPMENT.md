# Reach development and maintenance

Reach uses Next.js 16, React 19, TypeScript, Node.js 24, Tailwind 4, DaisyUI 5, MapLibre, and a private SQLite store. This guide covers a local checkout, repeatable checks, focused UI changes, and publishing source safely. Integration-specific guides remain the authority for their provider configuration.

## Local setup

Run commands from the repository root, not the `docs` directory. Use Node 24 as specified by `.nvmrc` and `package.json`. Install Python if you want to reproduce the GTFS projection or run the full unit suite. Browser checks require Playwright Chromium.

```sh
npm ci
npx playwright install chromium
npm run dev
```

Open `http://127.0.0.1:3000`. The development script binds to loopback and selects Webpack unless explicitly overridden. Community is disabled by default; normal development respects `REACH_COMMUNITY_ENABLED` in the environment or `.env.local`. Use `REACH_COMMUNITY_ENABLED=false` to turn it off. `npm run dev:community` deliberately enables the pilot for that process, including the retained browser-test server. That does not authorize a public food-sharing deployment. Use `npm run dev -- --port 3001` when port 3000 is already occupied.

### Preserve private configuration

Optional settings are described in `.env.example`. Create `.env.local` only when it does not already exist; do not overwrite an existing file or copy real values into documentation. Next loads the private file for its process. Standalone worker commands need explicit environment loading.

For example, in PowerShell:

```powershell
if (-not (Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
```

Choose one local origin and use it consistently. `localhost` and `127.0.0.1` are different origins. If `REACH_APP_ORIGIN` is configured, its scheme, hostname and port must match the browser origin exactly; do not add a trailing slash or path. Production requires a canonical HTTPS origin. Never disable the same-origin guard to make a demonstration work.

## Understand optional integrations

`GET /api/ai/status` reports configuration without invoking a model. It is not a provider health or billing guarantee. Follow the provider guides before enabling external calls. Do not expose server keys through `NEXT_PUBLIC_` variables or browser code.

## Run checks

```sh
npm run data:validate
npm run typecheck
npm test
npm run build
```

`npm run check` runs those four stages in order and stops at the first failing stage. No separate lint command is currently configured. Use Prettier on the files you changed rather than reformatting unrelated historical reports.

### Start a production build

```sh
npm run build
npm start
```

`npm start` launches Next's generated `.next/standalone/server.js` directly, as required by `output: "standalone"`; it does not use `next start`. The launcher loads root Next environment files into the process without printing their values, then copies only `.next/static` and `public` into the standalone output. It does not copy root environment files or the private SQLite database. Relative database paths are resolved against the project root before the standalone server changes directory, preserving the existing local store. The default bind address is loopback (`127.0.0.1`). For a container or host that routes traffic to the process, opt in to an external bind address with `REACH_BIND_HOST=0.0.0.0 npm start`. `npm start -- --port 3100 --hostname 127.0.0.1` preserves the familiar CLI overrides; explicit CLI options take precedence over `PORT` and `REACH_BIND_HOST`.

The command runs the standalone production build locally; it does not establish production TLS, proxy headers, secret injection, provider connectivity, or a public deployment. Production account, access and assistant endpoints still require a canonical HTTPS `REACH_APP_ORIGIN`.

If Python is not available under the platform default name, specify its installed executable for the GTFS unit check:

```powershell
$env:REACH_PYTHON = 'C:\path\to\python.exe'
npm run check
```

On POSIX:

```sh
REACH_PYTHON=/absolute/path/to/python3 npm run check
```

### Focused browser checks

Start the development app in one terminal. In another, point Playwright at that same running instance:

```powershell
$env:REACH_TEST_URL = 'http://127.0.0.1:3000'
npm run test:e2e -- alignment-polish.spec.ts final-polish.spec.ts
```

On POSIX:

```sh
REACH_TEST_URL=http://127.0.0.1:3000 npm run test:e2e -- alignment-polish.spec.ts final-polish.spec.ts
```

The configured projects cover desktop, tablet, mobile, and Android-sized viewports; these are emulations, not physical-device tests. The focused files cover shared panel geometry, saved-state icon alignment, keyboard activation, light/dark accessibility, discovery, recovery, and the district boundary. Existing small-phone checks also exercise 320px width.

`PLAYWRIGHT_CHROMIUM_PATH` optionally selects an existing compatible Chromium binary. Otherwise use `npx playwright install chromium`. A bare production server over local HTTP cannot substitute for the HTTPS canonical-origin setup required by access/account/assistant endpoints. Keep authenticated-preview, live-service and community fixture requirements explicit; do not silently treat a skipped case as passed.

### Isolated tests and community opt-in

`npm test -- tests/<name>.test.ts` runs a focused Vitest file. Unit fixtures use their own temporary databases and clear the canonical-origin variables in Vitest's config. Keep test database paths under the test's temporary directory; do not point tests or admin scripts at a live database. Browser specs are `*.spec.ts`; `playwright.config.ts` runs Chromium projects for mobile, Android-sized, tablet and desktop viewports with two workers. Set `REACH_TEST_URL` to target an already running server; Playwright then does not start one. Without that setting, Playwright starts `npm run dev:community -- --port 3000` and may reuse an existing localhost server. Community browser workflows need that opt-in: a reused server must itself have been started with `npm run dev:community` or `REACH_COMMUNITY_ENABLED=true`, or the community API remains disabled. `dev:community` enables the feature only in its child process; it does not alter `.env.local`.

Community sharing is disabled by default. `npm run dev` respects `REACH_COMMUNITY_ENABLED` from the process environment or Next's loaded environment files, while `npm run dev:community` forces it on for that server process. Use a disposable private database for local community exercises, and stop the opt-in server when finished. This switch does not establish moderation, safety, or public-launch readiness. See [community](COMMUNITY.md) and [food-sharing safety](FOOD-SHARING-SAFETY.md) for the feature's boundaries.

### Configuration precedence

Start from `.env.example` and consult the integration guide before setting an optional provider. Next loads environment variables for the application process; shell-provided values take precedence over the corresponding `.env*` value. Worker and admin commands run as separate Node processes, so load their environment explicitly when needed. Do not assume edits to a loaded environment file change an already-running process; restart it after configuration changes.

Some application settings have their own code-level selection rules:

### API and access boundaries

Use this map to find the handler family. Dynamic account, pantry, community and outreach handlers validate the requested subpath internally; their accepted operations and roles are documented in their focused guides.

Private handlers return no-store responses and sanitize failures. When debugging a `400`, check the documented request shape and body size; for `403`, check the exact browser origin and session/role; for `503`, check configuration, database availability and provider readiness without exposing credentials. Read the corresponding guide before changing an authorization boundary.

`npm run test:e2e` runs all browser suites. Some historical or service-specific suites require isolated accounts, preview mail, a test database, or their documented configuration. Do not run real email or consent-changing workflows against production accounts simply to make the suite green.

## Maintain the visual system

Styles enter through `src/app/reach-theme.css`: Tailwind/DaisyUI themes, preserved legacy feature styles, then shared polish. Discovery-specific styles live in `src/components/guided-reach.module.css`. Follow the installed Next guides in `node_modules/next/dist/docs/` before changing framework code.

- Keep the established teal/slate palette, system font stack, readable contrast and 44px control targets.
- Reuse `--reach-focus-width` for the centered 820px guided-flow rail. Keep maps and result comparisons wide where useful.
- Center panels with an explicit width/max-width and automatic inline margins. Do not use arbitrary left offsets or transforms to hide a layout mismatch.
- Body copy, requirements and directions remain left-aligned. Footer branding and empty-state illustrations can be centered independently.
- Under the CSS reset, SVGs are block-level. Parent `text-align: center` is not sufficient; use automatic inline margins or an appropriate flex/grid alignment rule.
- Check the actual cascade before adding another override. Layered global rules and unlayered CSS Modules have different precedence.
- Test a compact step as well as the large homepage hero so desktop heading rules do not accidentally enlarge the compact view.
- Preserve all states: selected, disabled, loading, empty, error, light/dark, keyboard focus and reduced motion.

Before handing off a visual change, inspect desktop, tablet, and small-phone screenshots, verify no horizontal overflow, and compare copy, hierarchy, type, colors, spacing and wrapping. Account for the stable scrollbar gutter when measuring usable content centering.

## Troubleshoot common local problems

| Symptom                                             | What to check                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Port already in use                                 | Reuse your known running server or start a different port; update the test URL and canonical local origin together               |
| Account origin is not configured                    | Confirm the exact configured origin and production HTTPS requirement; do not weaken the guard                                    |
| Browser executable missing                          | Install Playwright Chromium or set an explicit supported binary path                                                             |
| GTFS reproduction cannot start Python               | Verify Python installation and `REACH_PYTHON`; the npm import script itself uses `python3`                                       |
| AI unavailable despite a configured status          | Check provider credentials, privacy acknowledgement, model compatibility and quota; configuration is not a successful completion |
| An email says preview only                          | That is an intentional non-delivery state; configure and verify the real provider separately                                     |
| Temporary SQLite files cannot be removed on Windows | Close the database connections first; do not suppress authorization assertions to hide cleanup failures                          |
| Changes appear missing in a screenshot              | Confirm the target port/build, theme, viewport, cached tab and completion of any HMR reload                                      |
| Git push returns 403                                | The Git credential account needs repository write access; commit author identity is not authentication                           |

For storage permissions, coherent WAL backups, migration and restore, use [pantry database operations](PANTRY-DATABASE.md). Windows NTFS privacy needs appropriate operator ACLs; passing POSIX-mode tests on another platform is not an ACL audit.

## Publish changes safely

1. Inspect `git status`, the current branch and `git remote -v` before staging.
2. Review a targeted diff. Preserve unrelated user edits; do not stage everything merely to make the working tree clean.
3. Run the relevant checks and record the actual scope of results. Keep mocked service outcomes distinct from live observations.
4. Stage source, tests, maintained documentation and sanitized evidence. Exclude `.env.local`, `.local/`, databases, message previews, private keys, tokens, `.claudian/`, local `.obsidian/` state and temporary test output.
5. Review the staged diff and `git diff --cached --check`, commit, then push normally. Do not force-push over collaborators' work.
6. Verify the remote branch points to the intended commit before reporting that publication succeeded.

If Git reports a permission error, use an account authorized for the repository or have the owner grant access. Never place a password or access token in a remote URL, source file, documentation, screenshot, or chat message.
