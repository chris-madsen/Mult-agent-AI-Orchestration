# semantic-verification — Spec Delta

## Purpose

Tree-sitter AST, LSP facts and dynamic uncertainty.

## ADDED Requirements

### Requirement: Structural facts

The system SHALL use Tree-sitter/ast-grep for structural code evidence, preserving exact symbol boundaries and source revisions.

#### Scenario: Function span

- **WHEN** a candidate refers to a current TypeScript function
- **THEN** the structural adapter returns its exact span and syntax kind with source digest

### Requirement: LSP definition and references

The system SHALL support definition, references, type information and diagnostics through an approved language semantics adapter.

#### Scenario: Two methods named save

- **WHEN** different classes contain equally named methods
- **THEN** symbol resolution does not merge references solely because names match

#### Scenario: Provider not yet approved

- **WHEN** Serena vs native TypeScript semantics has not passed its spike
- **THEN** production wiring is not presented as decided or complete

### Requirement: Dynamic call incompleteness

The system SHALL represent unknown dynamic dispatch and DI references as uncertainty rather than negative proof.

#### Scenario: No references returned

- **WHEN** LSP finds no references for a dynamically registered handler
- **THEN** ACE does not assert that the handler cannot be called

### Requirement: Live consistency checks

The system SHALL compare indexed digests with current source digests before marking evidence current.

#### Scenario: Candidate source differs

- **WHEN** Qdrant returns digest D1 and current file is D2
- **THEN** the resolver reads current D2 or reports stale/changed_during_request without marking D1 current

---

### Requirement: Definition/reference correctness on live semantic provider

The system SHALL distinguish declaration identity, reference sites, write accesses and dynamic uncertainty via approved live language-service semantics.

#### Scenario: DBC-04 two same-named methods

- **WHEN** two distinct classes contain methods of the same name and one write access is not a declaration
- **THEN** resolution preserves the correct declaration identity and SHALL NOT map `isWriteAccess` to `isDefinition`
