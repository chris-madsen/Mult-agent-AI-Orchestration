# Domain Model — enforce invariants and meaningful state

## Intent
Represent concepts that have rules, identities and permitted transitions, rather than bags of primitive fields. Use idiomatic types and immutable values in each language.

## Rules
1. Define aggregate identity and equality semantics.
2. Define invariant before choosing representation.
3. Distinguish known-valid state from unchecked external input.
4. Use value objects/branded types for values with domain constraints, not every integer/string.
5. Validate constructor/factory input and prohibit impossible states.
6. Defaults only where explicitly valid under business rules.
7. State transitions encode preconditions and postconditions.
8. Separate "not provided", "empty" and explicit deletion.
9. Prevent unvalidated persistence DTO from bypassing invariants.
10. Avoid public setters that enable illegal state without checks.
11. Preserve immutability where feasible, especially shared/read caches.
12. Use structured domain errors, not arbitrary magic error strings.
13. Use clocks/IDs as injected dependencies when deterministic test needs them.
14. Model cancellation and exceptional state in owning application layer.
15. Keep external provider identity as metadata, not domain truth when unsupported.
16. Represent uncertainty/incompleteness explicitly if user-visible.
17. Document state transitions before implementing concurrency.
18. Do not claim one successful fixture validates all invariant states.

## TypeScript / Effect example pattern
```ts
type WorkspaceId = string & { readonly __brand: "WorkspaceId" };

type ContextStatus =
  | { readonly kind: "complete"; readonly verifiedRevision: string }
  | { readonly kind: "partial"; readonly missingSources: readonly string[] }
  | { readonly kind: "unavailable"; readonly provider: string }
  | { readonly kind: "policy_denied"; readonly reason: string };
```
Use this as a concept, not a mandate to retrofit existing ACE types. A constructor can return Either/Effect/Result depending on established project style.

## Tests
- valid construction;
- missing and invalid values;
- transition from each allowed state;
- impossible transition rejected;
- no mutation on failed command;
- persistence round-trip integrity;
- identity semantics;
- concurrent calls if aggregate owns concurrency.

## Review verdict
Identify every new invariant, where it is enforced, how it is tested, and where external data is validated. No unjustified primitive obsession or builder ritual.
