# Go style

## Rules for Go projects
Use idiomatic Go naming, clear package ownership and explicit error handling. Prefer typed sentinel or wrapped errors where the existing project uses them. Avoid unexplained magic constants, ambiguous interfaces, hidden global state and comments that merely restate code. Tests must be deterministic and use the project's established runner and fixtures.

## Translation for ACE (TypeScript + Effect)
Do **not** apply Go naming or Go-specific libraries to ACE. Preserve the intent: idiomatic TypeScript, explicit and typed Effect failure channels, minimal abstraction, clear module ownership, existing ESLint/typecheck conventions, stable configuration and reproducible tests.

## Review
Review actual changed files and the project rules. Identify concrete violations with exact file:line and proposed minimal repair. Do not create Go-style Builders or mock frameworks unless justified by a separately approved design.
