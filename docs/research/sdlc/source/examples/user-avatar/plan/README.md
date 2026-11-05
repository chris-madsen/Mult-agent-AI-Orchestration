# Code Plan: User Avatar Upload

## Scope
Implement upload/delete and get avatar URLs with S3 storage, image resizing, User avatarKey, boundary interfaces and adapter/controller wiring.

## Phase Strategy
Bottom-up: Domain → Boundary → Adapters → UseCase → RepoModel/Response → Controller → Init/Routing. Phases must be small and independently verifiable.

| Phase | Focus | Layer | Dependency | Status |
|---|---|---|---|---|
| 01 | AvatarKey VO + User Entity Extension | Domain | none | NOT-RUN |
| 02 | Boundary Interfaces & Models | Boundary | 01 | NOT-RUN |
| 03 | ImageProcessor Adapter | Adapter | 02 | NOT-RUN |
| 04 | S3 FileStorage Adapter | Adapter | 02 | NOT-RUN |
| 05 | Use cases: Upload / Delete / Get Avatar URL | Use case | 02,03,04 | NOT-RUN |
| 06 | Repository Model + Response | Persistence/response | 01 | NOT-RUN |
| 07 | Controller Upload/Delete | Controller | 05,06 | NOT-RUN |
| 08 | Init / Dependency Injection / Routing | Bootstrap | 03,04,05,07 | NOT-RUN |

## Verification and change management
- A phase is complete only when its applicable build/test/lint, architecture, security and plan-compliance gates have actual PASS evidence.
- Record new/modified files per phase in that file, then reconcile with whole-design file map.
- No framework-dependent TeamCreate required to use phase files; implementation process can remain single-agent with human sign-off.
- Carry forward identifiers, error codes and C4/sequence constraints; run final cross-phase review and smoke tests.

## Source map
