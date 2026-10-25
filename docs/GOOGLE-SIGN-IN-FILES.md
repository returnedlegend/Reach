# Google sign-in file manifest

Compared by content hash with the source archive before this task; no source files were deleted. The private ignored `.env.local` was also extended with missing empty Google OAuth client placeholders, preserving existing values. It is omitted from the source download.

## Created

- `docs/GOOGLE-SIGN-IN-FILES.md`
- `docs/GOOGLE-SIGN-IN-VERIFICATION.md`
- `docs/GOOGLE-SIGN-IN.md`
- `docs/evidence/google-desktop-consent.png`
- `docs/evidence/google-desktop-unconfigured.png`
- `docs/evidence/google-mobile-consent.png`
- `docs/evidence/google-mobile-unconfigured.png`
- `docs/evidence/google-sign-in-checks.json`
- `src/app/api/auth/google/[action]/route.ts`
- `src/components/google-sign-in.tsx`
- `src/lib/google-auth-config.ts`
- `src/lib/google-auth.ts`
- `src/lib/google-identity.ts`
- `tests/google-auth-independent.test.ts`
- `tests/google-identity.test.ts`
- `tests/google-sign-in.spec.ts`

## Modified

- `.env.example`
- `README.md`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `src/app/privacy/page.tsx`
- `src/components/account-panel.css`
- `src/components/account-panel.tsx`
- `src/components/outreach-panel.tsx`
- `src/lib/account.ts`

## Purpose

## Visible button follow-up

The screenshot follow-up modifies `src/components/google-sign-in.tsx`, `src/components/account-panel.css`, `tests/google-sign-in.spec.ts`, and the Google setup/verification documentation. It adds `public/google-g.png` from Google’s official branding assets, makes the existing sign-in action visible when unconfigured, and adds an owner setup panel. The OAuth backend and its security rules remain unchanged. Existing Google consent/unconfigured screenshots are refreshed after browser verification.
