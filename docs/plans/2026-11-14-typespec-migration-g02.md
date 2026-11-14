# ACE TypeSpec staged adoption — TS-00 inventory, G02 and executable acceptance

**Date:** 2026-11-14  
**Source baseline:** `main@6df583fad7d45a4cda6586632240b6f364c08a8a`  
**Risk tier:** T2 (versioned public contract/tooling and protocol boundary).  
**Authority:** ADR-019 (Accepted), ADR-017, OpenSpec changes 001/009, `docs/research/sdlc/TYPESPEC-CODEGEN-COVERAGE.md`, `docs/operations/ai-assisted-sdlc.md`.  
**Owner direction:** implement staged codegen without breaking the existing ACE runtime or blocking agent delivery due to unavailable token counters. Do not change existing merge-protection policy.

## TS-00 audited source-of-truth matrix

| Surface and version | Present authority (pre-migration) | Runtime reader / client | Target TypeSpec owner | Status at baseline |
|---|---|---|---|---|
| Gateway Projection HTTP v1 `POST /internal/ace-gateway/v1/project` | `contracts/ace-gateway/v1/projection-request.schema.json` and `projection-decision.schema.json`; `src/domain/gateway-projection.ts` validates request | `src/transport/gateway-projection-http.ts`; Go connector under `integrations/bifrost` | `typespec/ace-gateway/v1/main.tsp` | Handwritten; discrepancies must fail migration |
| Gateway health/capabilities v1 | `src/transport/gateway-projection-http.ts` | HTTP clients, local agents | Separate TypeSpec operation after project slice | Existing, no claimed migration |
| Gateway delivery recording v1 | HTTP returns 501, not certified | Bifrost connector | **No generated successful send contract** until real final-send evidence | Not implemented/certified |
| Explicit MCP tool plane | `src/gateway/mcp-gateway.ts` Effect schemas, official MCP SDK transport | `src/transport/mcp-sdk-stdio.ts` | Gradual TypeSpec schema emitter → SDK mapping **if faithful** | Distinct plane, no alternate MCP transport |
| Hermes native JSONL bridge and receipts | `src/bin/ace-context-bridge.ts`, `integrations/hermes/ace_context_engine` | Hermes Python ContextEngine and ACE stdio | Versioned JSON schema where compiler semantics fit | Distinct plane; no assumption of native TypeSpec emitter |
| Domain ADTs, policies and error interpretation | Domain TypeScript + accepted OpenSpec | Effect application use cases | **NOT GENERATED** | Existing source of behavior, preserved |

Existing gateway request constraints that must survive: strict object fields; enums as strings; required/optional/null distinction; SHA256/base64 bounds; provider/session/attestation identity; exact `projectionMode` variants; no fabricated `BLOCK`/success; 4 MiB raw body limit; wire passthrough of unknown *provider body* fields; `record-delivery` remains 501. TypeSpec cannot replace semantic byte/hash/ownership validation.

## Pre-code G02 crosswalk

| AC | Owner / accepted decision | Interface/state | Phase | Deterministic oracle | Real provider requirement |
|---|---|---|---|---|---|
| TSP-01/02 TypeSpec genuinely compiles reproducibly | ADR-019 / project owner | `typespec/` pinned compiler, emitters, lockfile, generated OpenAPI/Schema and typed SDK | TS-01, TS-05 | `npm ci`, `tsp compile`, drift diff/check | No (tool chain only) |
| TSP-03/04 public contract remains compatible | ADR-017 / Gateway v1 OpenSpec | Generated DTO SDK and exhaustive gateway wire mapping | TS-01/02/06 | Good/bad fixtures, unknown variants, every field/enum, mapping failure | Bifrost mock wire; real final send separate |
| TSP-05/07 permissions and invalid input are not silently accepted | ADR-017 + `src/domain/policy.ts` | TypeSpec metadata is descriptive; existing runtime guard remains authoritative | TS-03, TS-04 | Negative unknown/denied/partial tests against actual adapter | Real provider if claiming egress |
| TSP-06/08 existing native/MCP/Go consumers continue to work | ADR-014/016/017, official MCP SDK | Protocol boundary mapping to generated schemas; old v1 artifacts available | TS-04, TS-06 | Contract roundtrip across DTO→domain→adapter, SDK serialization, Go contract tests | Hermes/Go E2E needed for production claims |
| ARCH-01 migration never inserts implementation into domain | ADR-019 Functional DDD | application-owned ports, adapters separate; no new provider I/O in domain | each slice | architecture rules, dependency scan and negative fixtures | No |
| PERF-01 token-savings telemetry remains nonblocking | explicit owner decision 2026-11-14 | Hermes receipts / reporting only; do not merge closed #239 | all | no budget-induced BLOCK test | Usage measurement separate from approval |

**Decision:** first vertical slice is Gateway Projection request/decision. Do not flip the runtime to generated decoding until TSP parity checks pass. Existing JSON schema and TypeScript/Go code remain authoritative during the spike. Promote TypeSpec to *sole* wire authority for each migrated surface only after an observed passing regeneration + compatibility gate. Generated code may describe a protocol but must not claim final provider-wire certification.

## Sequencing and truth conditions

1. **TS-00:** inventory and accepted contract baseline (this memo).
2. **TS-01:** pinned stable TypeSpec compiler 1.17.0, official HTTP/OpenAPI/JSON Schema emitters, pinned Hey API TypeScript SDK generator; real Gateway v1 operation; generate and validate outputs. Version numbers require lockfile and CI proof.
3. **TS-02:** field/enum exhaustiveness, missing vs null, negative DTO mapping fixtures; do not silently default fields.
4. **TS-03:** scope/classification metadata only if supported in TypeSpec/OpenAPI, not an invented policy. Runtime deny remains independent.
5. **TS-04:** evaluate JSON Schema outputs for official MCP SDK and Hermes JSONL; only migrate one if real version/variant parity can be proved; no homegrown MCP emitter.
6. **TS-05:** deterministic `generate`, check-generated drift, generated artifact ownership and scope-aware CI. False-positive and intentionally broken-output fixture.
7. **TS-06:** incremental migration of verified surfaces only. Remove handwritten duplicated sources **after** verified compatibility; compatibility shims require documented removal points.

**Blockers are explicit:** If generated schemas cannot express the existing exact wire grammar or unsupported generators cannot produce necessary DTO/validation output, mark the individual TSP gate `NOT-RUN/BLOCKED`, not PASS, and retain working contract. Full agent/provider E2E is never inferred from SDK generation.

## Four reviews

- BUILD: reproducible install, compile, generated drift, null/enum/field completeness.
- ARCH: TS+Effect functional core unchanged; generator output stays in boundary folder, no duplicate transport.
- SEC: no new authorization shortcuts; policy still rechecked on real send path, no fabricated claims.
- PLAN: each TSP-01..08 with exact source SHA, job run and explicit negative fixtures; unresolved phases visible.

**Implementation evidence:** attach tested HEAD/merge SHA, command/output and failure fixtures to PR. This pre-code G02 text intentionally precedes the implementation commit.
