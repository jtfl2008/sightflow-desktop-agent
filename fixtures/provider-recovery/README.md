# Provider Recovery Fixtures

Crash-injection fixtures for startup provider lifecycle/settings reconciliation.

These fixtures are synthetic and must not contain real credentials, provider bundles, URL query strings, local absolute paths, raw chat, screenshots, or deployment manifests. Unsafe recovery inputs are represented only as redacted boolean summaries such as `manifestUrlHasRedactedQuery` and reason codes.

Run:

```bash
npx ts-node src/main/provider-security/provider-recovery-fixtures.mock-test.ts
```
