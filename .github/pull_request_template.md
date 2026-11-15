## Summary

<!-- What changed and why? -->

## Verification

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm --filter @360events/api run db:drift-check`
- [ ] `pnpm run test`
- [ ] Database migrations were generated intentionally, reviewed, and committed when the schema changed.
- [ ] Relevant authorization, failure, and concurrency cases are covered.

## Definition of Done

- [ ] Scope and acceptance criteria are satisfied.
- [ ] Tests cover the expected behaviour and important failure paths.
- [ ] No secrets, credentials, or unnecessary personal data are included.
- [ ] Documentation and migration artifacts are updated where applicable.
- [ ] No unrelated changes or generated artifacts are included.
- [ ] Risks, deployment considerations, and follow-up work are documented.

## Review notes

<!-- Risks, screenshots, migration notes, or follow-up work. -->
