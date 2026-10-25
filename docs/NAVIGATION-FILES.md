# AI Navigation file manifest

Historical implementation manifest. The October 25, 2026 DeepSeek migration replaced the listed OpenRouter adapter and related tests; see [current migration](DEEPSEEK-MIGRATION.md).
Compared with the pre-task Reach source archive. No source files or dependencies were removed. No dependencies were added. `package.json` changes only the browser test loader command. `.env.local` was preserved and extended with missing OpenRouter placeholders locally; it is ignored, mode 0600 and excluded from the download. Build outputs, accounts, databases, preview captures, traces and dependencies are excluded.

## Created

- `docs/AI-NAVIGATION.md`
- `docs/NAVIGATION-FILES.md`
- `docs/NAVIGATION-PROVIDERS.md`
- `docs/NAVIGATION-VERIFICATION.md`
- `docs/evidence/navigation-build.txt`
- `docs/evidence/navigation-catalog-check.json`
- `docs/evidence/navigation-checks.txt`
- `docs/evidence/navigation-desktop-driving-final.png`
- `docs/evidence/navigation-desktop-driving-result.png`
- `docs/evidence/navigation-desktop-needs-reviewed.png`
- `docs/evidence/navigation-desktop-shelter-limits.png`
- `docs/evidence/navigation-http.txt`
- `docs/evidence/navigation-live-driving.json`
- `docs/evidence/navigation-live-plan.json`
- `docs/evidence/navigation-mobile-driving-final.png`
- `docs/evidence/navigation-mobile-driving-result.png`
- `docs/evidence/navigation-mobile-needs-reviewed.png`
- `docs/evidence/navigation-mobile-shelter-limits.png`
- `docs/evidence/navigation-security.json`
- `src/components/navigation-guidance.tsx`
- `src/components/navigation-preferences.tsx`
- `src/components/navigation-ui.css`
- `src/lib/navigation-guidance-agent.ts`
- `src/lib/navigation-needs-agent.ts`
- `src/lib/navigation-ranking-agent.ts`
- `src/lib/navigation-resource-agent.ts`
- `src/lib/navigation-types.ts`
- `src/lib/openrouter-client.ts`
- `tests/navigation-driving.test.ts`
- `tests/navigation-flow.spec.ts`
- `tests/navigation-independent.test.ts`
- `tests/navigation-needs-agent.test.ts`
- `tests/navigation-ranking.test.ts`
- `tests/navigation-resource-agent.test.ts`
- `tests/openrouter-client.test.ts`

## Modified

- `.env.example`
- `README.md`
- `package.json`
- `src/app/api/access/assist/route.ts`
- `src/app/privacy/page.tsx`
- `src/components/access-planner.tsx`
- `src/lib/access-ai.ts`
- `src/lib/access-engine.ts`
- `src/lib/access-routing.ts`
- `src/lib/access-service.ts`
- `src/lib/access-types.ts`
- `tests/access-ai.test.ts`

## Removed

None.
