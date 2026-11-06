# Go Style — applicable only to isolated Go components

## Go coding rules
1. Follow package naming/Go idioms, not generic Java/C# patterns.
2. Keep exported API minimal and documented where needed.
3. Return errors explicitly; wrap with context without leaking secrets.
4. Prefer typed/sentinel errors for stable decisions over string comparison.
5. Manage context cancellation and deadlines across network boundaries.
6. Close network/file resources and check Close errors when important.
7. Avoid global mutable state and hidden init effects.
8. Avoid magic constants and silent default values.
9. Keep concurrency ownership clear, avoid goroutine leaks.
10. Protect shared state with correct synchronization.
11. Use table-driven test cases for variations.
12. Exercise actual cancellation, retries and idempotency.
13. Run gofmt, go test and go vet when relevant.
14. Check module version and license for dependencies.
15. Don't mandate comments that merely repeat code.
16. Don't use a Builder where a simple constructor is clearer.
17. Keep provider DTOs outside domain entities.
18. Avoid fabricated PASS for tests not executed.

## ACE scope
The TypeScript + Effect core is **not** Go. Apply this reference only to `integrations/bifrost/ace-connector` or another explicitly approved Go component. The broader ideas translate to TS idioms, but Go-specific syntax/tools must never be mandatory for an unrelated TS change.
