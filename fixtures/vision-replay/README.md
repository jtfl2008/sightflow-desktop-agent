# Vision Replay Fixtures

Repository fixtures are local-only test inputs for the vision replay and evaluation runner.

## Included Suites

- `synthetic-basic`: passing synthetic sample used by `npm run test:vision-eval`.
- `privacy-raw-blocked`: privacy gate failure for a full screenshot without explicit consent.
- `hash-mismatch`: image hash mismatch fixture for report/store blocked states.
- `schema-invalid`: invalid manifest fixture for schema invalid states.

## Repository Intake Rules

- Commit only `synthetic` or `manual_redacted` samples.
- Do not commit real user full screenshots, raw screenshots, avatars, QR codes, contact names, phone numbers, email addresses, addresses, tokens, secrets, API keys, or full chat transcripts.
- Do not embed `data:image/*;base64` payloads in manifests, reports, audit context, Markdown, or JSON.
- Do not reference repository paths named `raw`, `raw_opt_in`, `original`, `unredacted`, `full-screenshot`, or `full-screen`.
- Full screenshot samples are only allowed in local user data with explicit consent and must not be added to this repository.
- Hash-only or intentionally invalid fixtures must keep content synthetic and must be documented by suite name.

## Verification

Default passing suite:

```bash
npm run test:vision-eval
```

Privacy blocked suite should exit with code `3`:

```bash
npx ts-node scripts/vision-eval.ts --suite fixtures/vision-replay/suites/privacy-raw-blocked --report-dir /tmp/sf-vision-privacy-report
```

Hash mismatch suite should exit with code `4`:

```bash
npx ts-node scripts/vision-eval.ts --suite fixtures/vision-replay/suites/hash-mismatch --report-dir /tmp/sf-vision-hash-report
```

Schema invalid suite should exit with code `2`:

```bash
npx ts-node scripts/vision-eval.ts --suite fixtures/vision-replay/suites/schema-invalid --report-dir /tmp/sf-vision-schema-report
```
