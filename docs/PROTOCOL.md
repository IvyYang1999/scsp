# SCSP Protocol Specification

**Software Capability Sharing Protocol — Version 0.1**

> 改 → 打包 → 分享 → 一键装  
> Modify → Pack → Share → One-Click Install

---

## Table of Contents

1. [Overview and Philosophy](#1-overview-and-philosophy)
2. [Core Concepts](#2-core-concepts)
3. [Three-Layer Separation Principle](#3-three-layer-separation-principle)
4. [Host Manifest Format](#4-host-manifest-format)
5. [Host Snapshot Format](#5-host-snapshot-format)
6. [Capability Package Format](#6-capability-package-format-scsp)
7. [Probes Specification](#7-probes-specification)
8. [Negative Constraint Verification (NCV)](#8-negative-constraint-verification-ncv)
9. [Contracts, Fixtures, and Interfaces](#9-contracts-fixtures-and-interfaces)
10. [Six-Stage Execution Model](#10-six-stage-execution-model)
11. [Installation Transaction Semantics](#11-installation-transaction-semantics)
12. [scsp pack Flow](#12-scsp-pack-flow)
13. [Registry: Publish and Fetch Protocol](#13-registry-publish-and-fetch-protocol)
14. [Metrics System](#14-metrics-system)
15. [Migration Patches](#15-migration-patches)
16. [Anchor Naming Convention](#16-anchor-naming-convention)
17. [Anchor Deprecation](#17-anchor-deprecation)
18. [Lineage and Version Snapshots](#18-lineage-and-version-snapshots)
19. [Executor Conformance Requirements](#19-executor-conformance-requirements)
20. [Version Compatibility Rules](#20-version-compatibility-rules)
21. [V0.1 Scope Declaration](#21-v01-scope-declaration)

---

## 1. Overview and Philosophy

Modern software development has a paradox at its core: users know exactly what they want their software to do, but making it happen requires either forking the entire project or waiting for the maintainer to agree. This friction silences an enormous amount of latent knowledge about how software should actually behave.

SCSP (Software Capability Sharing Protocol) is a protocol for decentralized software evolution. It provides a structured, agent-native format that allows users to customize software, package those improvements, and share them — so that any other user's agent can adopt the same improvement without needing to understand the target codebase.

### The Three Core Problems

**Problem 1: Software cannot be easily customized without forking.**  
Forking copies an entire codebase. For a single behavioral improvement — say, adding TOTP authentication or a dark mode sidebar — the cost is enormous. Users end up living with defaults, filing issues that stall for years, or abandoning software entirely.

**Problem 2: Improvements cannot be shared without knowledge of the target codebase.**  
Even when a user figures out how to make an improvement, sharing it with someone else means sharing raw diffs tied to a specific file structure, library version, and coding convention. The recipient has no portable way to apply that improvement to their own variant of the same software.

**Problem 3: There is no ecosystem for user-created software improvements.**  
App stores handle distributing entire applications. Package managers handle distributing libraries. Nothing handles distributing targeted behavioral improvements to a running application. The result is that user knowledge evaporates — every user rediscovers improvements independently.

### What SCSP Does

SCSP introduces a unit of sharing called a **capability package** (`.scsp` file). A capability package describes an improvement in terms of:

- What it does (intent, contracts)
- Where it connects to the host application (surfaces, anchors, probes)
- What it must not do (negative constraint verification)
- How to roll it back (stateless snapshots or stateful schema migrations)

The protocol is language-agnostic, signable, and designed to be executed by AI agents rather than humans directly. The agent handles the gap between a canonical capability description and the specific local variant of the target software.

---

## 2. Core Concepts

### Capability Package (.scsp file)

The atomic unit of the SCSP ecosystem. A `.scsp` file is a structured document with a YAML frontmatter block and a Markdown body. It describes a software improvement in a way that any conforming executor can interpret and apply. Capability packages are signable, versionable, and can declare lineage relationships to prior packages.

### Host Manifest (scsp-manifest.yaml)

A file authored by the software developer and committed to the application repository. The manifest declares what the application intentionally exposes for extension: which surfaces can be customized, which anchors exist, what conventions govern the codebase, and which external dependencies may be affected. The manifest is the developer's contract with the SCSP ecosystem.

### Host Snapshot (host-snapshot.json)

A machine-generated file produced by an executor agent by analyzing the actual codebase. The snapshot maps the manifest's canonical declarations to concrete file locations. It records currently installed capabilities and a hash of the base codebase. While the manifest is authoritative for naming, the snapshot is authoritative for current state.

### Surfaces

Surfaces are coarse-grained capability areas. They answer the question "what general domain does this capability touch?" and serve as the first filter for compatibility checking. The three surface categories are:

- **entities**: Data models and schema definitions
- **ui_areas**: Visual regions and interactive components
- **logic_domains**: Business logic, workflows, and behavioral rules

### Anchors

Anchors are canonical named extension points declared in the manifest. They are more precise than surfaces and come in three types:

- **hooks**: Named call sites in logic where a capability can inject behavior (e.g., `auth.password_login.post_verify`)
- **slots**: Named locations in the UI where a capability can mount components (e.g., `nav.sidebar`)
- **entities**: Named data models a capability may extend (e.g., `User`)

Anchors follow a structured naming convention: `{domain}.{entity_or_flow}.{hook_point}`.

### Probes

Probes are the verification-and-location mechanism. Before applying any changes, an executor runs each capability's probes to confirm that the expected extension points exist in the actual codebase. A probe combines an `anchor_ref` (which canonical anchor it targets), an `intent` (semantic description), and `check_hints` (language-specific patterns to locate the anchor). Probes decouple the canonical name from the physical location.

### NCV (Negative Constraint Verification)

Negative Constraint Verification is a safety check system that verifies a capability does NOT do certain things. While probes verify what is present, NCV verifies what is absent. It enforces constraints such as "this capability must not write to the filesystem" or "this component must not make outbound network requests." NCV checks are run during the dry-run phase before any code is applied.

### Contracts

Contracts are structured behavioral assertions that define the expected behavior of a capability's components. A contract specifies a precondition (the state before), an action (calling an interface with specific inputs), and a set of assertions (what the output must satisfy). Executors generate executable tests from contracts using the declared fixtures and interfaces.

### Registry

The registry is a decentralized store for capability packages. In V0.1, the reference implementation is git-based (a repository with a defined directory structure). Anyone can run a registry node. The protocol specifies the minimum publish/fetch interface; community UI, payment processing, and reputation systems are registry-layer concerns, not protocol-layer concerns.

---

## 3. Three-Layer Separation Principle

SCSP draws a hard boundary between three conceptual layers. Confusion between layers is the most common source of protocol misuse.

### Protocol Layer

The protocol layer consists of:
- The `.scsp` capability package format
- The `scsp-manifest.yaml` host manifest format
- The `host-snapshot.json` host snapshot format
- The six-stage execution model semantics

Protocol-layer artifacts are language-agnostic, cryptographically signable, and version-controlled under semver. A `.scsp` file contains no executor-specific instructions. An executor reads the capability and decides how to apply it using its own understanding of the target language and framework.

### Executor Layer

The executor layer consists of agent or runtime implementations that read protocol-layer artifacts and perform actual code modifications. Executor behavior — how it generates code, which LLM it uses, how it handles ambiguous probes — is intentionally NOT specified by the protocol. This layer is where implementation diversity lives. Multiple executors can be conformant while taking entirely different approaches to code generation.

The only executor requirements imposed by the protocol are the conformance rules in Section 19.

### Community Layer

The community layer consists of:
- Registry nodes and their APIs
- Metrics and reputation systems
- Author profiles and trust signals
- Payment and licensing mechanisms
- Discovery UI and recommendation engines

None of these belong inside a capability package. A `.scsp` file does not know its own popularity, price, or author reputation. These are registry-layer properties stored in `metadata.json` alongside the capability file.

---

## 4. Host Manifest Format

The host manifest is `scsp-manifest.yaml`, committed to the root of the application repository (or a declared subdirectory). It is the developer's declaration of intent for extensibility.

```yaml
scsp-manifest: "0.1"
name: "my-saas-app"
version: "2.4.1"
repo: "https://github.com/example/my-saas-app"

surfaces:
  entities:
    - User
    - Project
    - Subscription
  ui_areas:
    - settings_panel
    - nav_sidebar
    - dashboard_widgets
  logic_domains:
    - authentication
    - billing
    - notifications

anchors:
  hooks:
    - id: "auth.password_login.post_verify"
      description: "Called after password verification succeeds, before session creation. Useful for MFA, audit logging, or login enrichment."
    - id: "billing.subscription.on_upgrade"
      description: "Called when a user upgrades their subscription tier."
    - id: "notifications.send.pre_dispatch"
      description: "Called before a notification is dispatched. Can mutate or suppress the notification."
  slots:
    - id: "nav.sidebar"
      description: "Left navigation sidebar. Accepts React components that receive the current user as a prop."
    - id: "settings.security_section"
      description: "Security section of the user settings page."
  entities:
    - id: "User"
      core_fields:
        - id
        - email
        - created_at
        - role
    - id: "Project"
      core_fields:
        - id
        - name
        - owner_id
        - created_at

hints:
  architecture: "Next.js 14 app router with a Prisma ORM layer and PostgreSQL. API routes in /app/api, server components in /app, client components co-located with their routes."
  conventions:
    routes: "app/api/{resource}/route.ts"
    models: "prisma/schema.prisma"
    components: "app/components/{ComponentName}.tsx"
    tests: "tests/{feature}.test.ts using Vitest"

external_dependencies:
  - id: "prisma"
    description: "ORM used for all database access. Schema changes must go through Prisma migrations."
    version_constraint: ">=5.0.0"
    impact_scope: ["entities"]
  - id: "next-auth"
    description: "Authentication library. Auth hook integrations must be compatible with next-auth session handling."
    version_constraint: ">=4.0.0"
    impact_scope: ["authentication", "User"]
```

---

## 5. Host Snapshot Format

The host snapshot is `host-snapshot.json`, generated by an executor agent by scanning the live codebase. It maps canonical anchor IDs from the manifest to concrete file locations. The snapshot is the executor's working memory about the current state of the host application.

```json
{
  "scsp_host_snapshot": "0.1",
  "generated_at": "2026-04-19T08:00:00Z",
  "generated_by": "scsp-agent/0.1.0",
  "manifest_ref": "https://github.com/example/my-saas-app/blob/main/scsp-manifest.yaml",
  "manifest_version": "2.4.1",
  "snapshot_hash": "sha256:a1b2c3d4e5f6...",
  "base_version_hash": "sha256:git:abc1234def5678...",

  "entities": [
    {
      "id": "User",
      "fields": ["id", "email", "created_at", "role", "totp_secret"],
      "location_hint": "prisma/schema.prisma:model User",
      "extensible": true
    },
    {
      "id": "Project",
      "fields": ["id", "name", "owner_id", "created_at"],
      "location_hint": "prisma/schema.prisma:model Project",
      "extensible": true
    }
  ],

  "ui_slots": [
    {
      "id": "nav.sidebar",
      "framework": "react",
      "location_hint": "app/components/NavSidebar.tsx:SlotNavSidebar",
      "mount_type": "inject_children"
    },
    {
      "id": "settings.security_section",
      "framework": "react",
      "location_hint": "app/settings/security/page.tsx:SecuritySection",
      "mount_type": "inject_children"
    }
  ],

  "logic_hooks": [
    {
      "id": "auth.password_login.post_verify",
      "location_hint": "app/api/auth/[...nextauth]/route.ts:signInCallback",
      "signature_hint": "async (user: User, account: Account) => void | boolean",
      "lang": "typescript"
    },
    {
      "id": "billing.subscription.on_upgrade",
      "location_hint": "lib/billing/subscriptions.ts:handleUpgrade",
      "signature_hint": "async (userId: string, newTier: string) => void",
      "lang": "typescript"
    }
  ],

  "installed_capabilities": [
    {
      "id": "dark-theme-sidebar",
      "version": "1.2.0",
      "installed_at": "2026-04-10T14:30:00Z",
      "anchors_used": ["nav.sidebar"],
      "rollback_type": "stateless"
    }
  ]
}
```

### Interoperability Rules for Snapshots

- All entity, slot, and hook IDs in the snapshot **must** use the canonical IDs declared in the manifest. Executors must not invent anchor IDs.
- `location_hint` is **advisory only**. Capability packages must not hardcode location hints. Probes are the authoritative location mechanism.
- `snapshot_hash` reflects the state of the snapshot file itself. `base_version_hash` reflects the git commit hash of the application codebase at snapshot generation time.
- If a capability installation modifies the codebase, `base_version_hash` is stale relative to the installed state. The snapshot's `installed_capabilities` array records what has been applied on top.

---

## 6. Capability Package Format (.scsp)

A `.scsp` file consists of two parts: a **YAML frontmatter** block (delimited by `---`) and a **Markdown body**. The frontmatter is machine-readable and schema-validated. The body contains human-readable intent sections interleaved with fenced YAML blocks that the executor parses.

### 6.1 Frontmatter Schema

```yaml
---
scsp: "0.1"
id: "auth-totp-enforcement"
name: "TOTP Two-Factor Authentication"
version: "1.0.0"
tags:
  - auth
  - security
  - mfa

# Lineage — for evolution and forking
extends: null
parent_id: null

# Authorship and integrity
author:
  name: "Alice Chen"
  key: "ed25519:AAABBBCCC..."
signature: "base64:SIGBYTES..."
created: "2026-04-19T08:00:00Z"
revoked: false

# Environment hints (informational, not enforced by protocol)
env_hint:
  runtime: "node>=18"
  frameworks:
    - "next>=14"
    - "prisma>=5"

# Compatibility requirements
requires:
  manifest_version: ">=2.0.0"
  surfaces:
    - entities
    - logic_domains
  anchors:
    hooks:
      - "auth.password_login.post_verify"
    slots:
      - "settings.security_section"
    entities:
      - "User"

# Components this capability installs
components:
  - id: "totp-user-fields"
    layer: "module"
    optional: false
    depends_on: []
    surfaces_touched:
      - entities
    anchors_used:
      - "User"
    blast_radius:
      structural_impact: "schema_migration"
      dependency_depth: 1
    rollback:
      stateless: false
      stateful:
        schema_migration:
          down: |
            ALTER TABLE "User" DROP COLUMN IF EXISTS "totp_secret";
            ALTER TABLE "User" DROP COLUMN IF EXISTS "totp_enabled";
    permissions:
      surfaces_writable:
        - entities
      schema_migration: true
      external_deps: []

  - id: "totp-verify-hook"
    layer: "behavior"
    optional: false
    depends_on:
      - "totp-user-fields"
    surfaces_touched:
      - logic_domains
    anchors_used:
      - "auth.password_login.post_verify"
    blast_radius:
      structural_impact: "hook_injection"
      dependency_depth: 2
    rollback:
      stateless: true
    permissions:
      surfaces_writable:
        - logic_domains
      schema_migration: false
      external_deps:
        - "otplib"

  - id: "totp-settings-ui"
    layer: "component"
    optional: true
    depends_on:
      - "totp-user-fields"
    surfaces_touched:
      - ui_areas
    anchors_used:
      - "settings.security_section"
    blast_radius:
      structural_impact: "slot_injection"
      dependency_depth: 1
    rollback:
      stateless: true
    permissions:
      surfaces_writable:
        - ui_areas
      schema_migration: false
      external_deps:
        - "qrcode"

# Known conflicts with other capabilities
conflicts:
  - id: "sso-only-auth"
    surfaces_overlap:
      - logic_domains
    anchors_overlap:
      - "auth.password_login.post_verify"
    reason: "Both capabilities inject into post_verify. sso-only-auth disables password auth entirely, which conflicts with TOTP enforcement on the same flow."

# Risk factors (auto-derived from permissions and blast_radius; human may add)
risk_factors:
  auto_derived: true
  additional:
    - "Requires adding otplib dependency. Verify license compatibility."
---
```

### 6.2 Markdown Body Structure

The Markdown body contains named sections. Executors parse each section by its heading. Fenced code blocks with language tags `yaml` are parsed as structured data; plain prose is passed to the executor as context.

```markdown
## Intent

**Motivation**: Password-only authentication is insufficient for applications handling sensitive data. This capability enforces time-based one-time passwords (TOTP) as a second factor for all password-based logins.

**Design Principles**:
- TOTP secret is stored encrypted at rest using the application's existing encryption key
- Enforcement is opt-in per user during transition; admin can set mandatory deadline
- UI component is optional — the hook component still enforces TOTP if the UI is skipped (users must enroll via alternative flow)

**Behavior State Machine**:
- `UNENROLLED` → user logs in normally; if mandatory deadline passed, login is rejected
- `ENROLLED` → user logs in with password, then prompted for TOTP code
- `VERIFIED` → session is created with `totp_verified: true` claim

```yaml probes:
- anchor_ref: "auth.password_login.post_verify"
  intent: "Find the post-password-verification callback where session enrichment occurs"
  check_hints:
    - lang: typescript
      type: grep
      patterns:
        - "signIn.*callback"
        - "post.*verify"
        - "afterVerify"
      paths:
        - "app/api/auth"
        - "lib/auth"
  on_fail: abort

- anchor_ref: "User"
  intent: "Find the User model definition to add totp_secret and totp_enabled fields"
  check_hints:
    - lang: typescript
      type: grep
      patterns:
        - "model User"
        - "interface User"
      paths:
        - "prisma"
        - "types"
        - "models"
  on_fail: abort

- anchor_ref: "settings.security_section"
  intent: "Find the security settings page slot for mounting the TOTP enrollment UI"
  check_hints:
    - lang: typescript
      type: ast
      patterns:
        - "SecuritySection"
        - "SlotSecuritySection"
      paths:
        - "app/settings"
        - "app/components"
  on_fail: warn
  fallback: "Skip totp-settings-ui component installation. Enrollment must be handled via API."
```

```yaml ncv:
- id: "no-filesystem-write"
  description: "TOTP verification logic must not write to the filesystem"
  severity: critical
  enforcement:
    universal:
      type: grep_negative
      pattern: "fs\\.write|writeFile|createWriteStream"
    variants:
      javascript:
        type: grep_negative
        pattern: "require\\(['\"]fs['\"]\\)"
      typescript:
        type: grep_negative
        pattern: "import.*from ['\"]fs['\"]"

- id: "no-outbound-network"
  description: "TOTP verification must not make outbound HTTP calls"
  severity: critical
  enforcement:
    universal:
      type: outbound_audit
      semantic: "no_http_calls_in_generated_code"
```

```yaml fixtures:
- id: "enrolled_user"
  data:
    id: "user_123"
    email: "alice@example.com"
    totp_secret: "JBSWY3DPEHPK3PXP"
    totp_enabled: true
    role: "user"

- id: "unenrolled_user"
  data:
    id: "user_456"
    email: "bob@example.com"
    totp_secret: null
    totp_enabled: false
    role: "user"
```

```yaml contracts:
- name: "valid_totp_allows_login"
  component: "totp-verify-hook"
  precondition:
    entity_state: "User"
    fixture: "enrolled_user"
  action:
    interface: "verifyTotpHook"
    args:
      user: "$fixture.enrolled_user"
      token: "$valid_totp_for_secret"
  assertions:
    - field: "result.allowed"
      operator: eq
      value: true
    - field: "result.session_claims.totp_verified"
      operator: eq
      value: true

- name: "invalid_totp_rejects_login"
  component: "totp-verify-hook"
  precondition:
    entity_state: "User"
    fixture: "enrolled_user"
  action:
    interface: "verifyTotpHook"
    args:
      user: "$fixture.enrolled_user"
      token: "000000"
  assertions:
    - field: "result.allowed"
      operator: eq
      value: false
    - field: "result.error"
      operator: contains
      value: "invalid_totp"
```

```yaml interfaces:
- name: "verifyTotpHook"
  component: "totp-verify-hook"
  input:
    fields:
      - name: user
        type: User
        required: true
      - name: token
        type: string
        required: true
  output:
    fields:
      - name: allowed
        type: boolean
      - name: session_claims
        type: object
      - name: error
        type: string
  errors:
    - code: "invalid_totp"
      description: "The provided TOTP token is incorrect"
    - code: "totp_expired"
      description: "The TOTP token has expired (>30s window)"
```
```

---

## 7. Probes Specification

Probes are the bridge between canonical anchor IDs and physical code locations. Every anchor a capability uses must have at least one probe.

| Field | Type | Description |
|---|---|---|
| `anchor_ref` | string | Canonical anchor ID from the manifest |
| `intent` | string | Human-readable semantic description of what to locate |
| `check_hints` | array | Language-specific search strategies |
| `on_fail` | enum | `"abort"` or `"warn"` |
| `fallback` | string | Required when `on_fail: warn`; describes degraded behavior |

### check_hints Entry Fields

| Field | Type | Description |
|---|---|---|
| `lang` | string | Target language (`typescript`, `python`, `go`, etc.) |
| `type` | enum | `"grep"` (text search) or `"ast"` (structural parse) |
| `patterns` | array | Search patterns (regex for grep, AST node types for ast) |
| `paths` | array | Relative paths to search within the repository |

An executor runs check_hints in order and stops at the first match. Executors that do not support `ast` type may fall back to `grep` patterns from the same check_hints entry if both are provided.

---

## 8. Negative Constraint Verification (NCV)

NCV enforces what a capability **must not** do. It is a safety layer that runs during the dry-run phase, before any code is applied to the actual codebase.

### NCV Entry Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier for this constraint |
| `description` | string | Human-readable explanation |
| `severity` | enum | `"critical"` (abort on violation) or `"warning"` (surface to user) |
| `enforcement.universal` | object | Applies to all languages |
| `enforcement.variants` | object | Language-specific overrides, keyed by language name |

### NCV Types

| Type | Semantics | Executor Requirements |
|---|---|---|
| `grep_negative` | Scans generated files for a forbidden pattern. Fails if pattern is found. | Text search in generated/modified files |
| `outbound_audit` | Verifies generated code makes no outbound network calls in specified scope. | Static analysis or sandboxed execution |
| `structural_check` | AST-level verification (e.g., no dynamic `require`, no `eval`). | AST parser for target language |

All `critical` severity NCV checks must be run during dry-run. A single critical violation causes a full dry-run abort. Warning violations are surfaced to the user at the human confirmation step.

---

## 9. Contracts, Fixtures, and Interfaces

### Fixtures

Fixtures are named test data objects. They represent entity states used as preconditions in contracts. Fixtures are defined once in the `fixtures:` section and referenced by `$fixture.{id}` throughout contracts.

### Contracts

Contracts are behavioral assertions. They are used by executors to generate executable tests after applying the capability.

| Field | Description |
|---|---|
| `name` | Unique contract name |
| `component` | The component ID this contract tests |
| `precondition` | Entity state and fixture to set up |
| `action` | Interface method to call with arguments |
| `assertions` | Array of `{field, operator, value}` checks on the output |
| `then` | Optional array of sequential follow-up assertions |

**Constraint**: Contracts may only reference fields declared in the `interfaces` section. This allows executors to validate contracts structurally before executing them.

### Interfaces

Interfaces declare the typed API surface of each component. They are the contract between a capability's components and the outside world.

| Field | Description |
|---|---|
| `name` | Interface method name |
| `component` | The component that implements this interface |
| `input.fields` | Typed input parameters |
| `output.fields` | Typed output fields |
| `errors` | Named error codes with descriptions |

---

## 10. Six-Stage Execution Model

Installing a capability is a six-stage transaction. Each stage must complete successfully before the next begins. The executor must not skip stages, reorder them, or apply partial results.

### Phase 1: PROBE

1. Read all probe entries from the capability's `probes:` section.
2. Validate that all anchors referenced in `requires.anchors` exist in the host snapshot.
3. Execute each probe's `check_hints` against the actual codebase.
4. All probes with `on_fail: abort` must pass before proceeding. Failure at this stage returns `PROBE_FAILED` with the failing anchor ID and the patterns that found no match.
5. Probes with `on_fail: warn` that fail are recorded; their corresponding optional components are marked for skip in Phase 5.

### Phase 2: VALIDATE

1. Compare `requires.surfaces` against surfaces declared in the host manifest. Any required surface not in the manifest causes `INCOMPATIBLE_HOST` error.
2. Compare `requires.anchors` against anchors in the host snapshot. Any required anchor not found causes `MISSING_ANCHOR` error.
3. Check `conflicts` array against `installed_capabilities` in the snapshot. Conflicting capability installed → `CONFLICT_DETECTED` error with conflict details.
4. Check component permissions against what the manifest allows. Unauthorized surface write causes `PERMISSION_DENIED` error.

### Phase 3: DRY-RUN

1. Generate all code changes in a temporary branch or in-memory filesystem. No changes are made to the live codebase.
2. Output `dry_run_report`:

```json
{
  "affected_files": ["prisma/schema.prisma", "app/api/auth/[...nextauth]/route.ts"],
  "diff_summary": "Added 2 fields to User model; injected TOTP check in signIn callback",
  "new_dependencies": ["otplib@^12.0.0"],
  "skipped_components": ["totp-settings-ui"],
  "skipped_reason": "Probe for settings.security_section not found"
}
```

3. Run all NCV checks against generated code. Any `critical` violation aborts dry-run.

### Phase 4: HUMAN CONFIRM

1. Present `dry_run_report` to the user.
2. Auto-derive `risk_factors` from component permissions and blast_radius values. Append any `risk_factors.additional` declared in the frontmatter.
3. User choices:
   - **Apply all**: Proceed with all non-skipped components.
   - **Skip optional**: Proceed but skip all `optional: true` components.
   - **Cancel**: Abort with no changes made.

### Phase 5: APPLY

1. Apply changes to the live codebase in component dependency order.
2. Execute schema migrations for all components with `schema_migration: true`.
3. Install declared `external_deps` (e.g., `npm install otplib`).
4. Executor generates executable tests from the `contracts:` and `fixtures:` sections using the `interfaces:` declarations.
5. Run generated tests.

### Phase 6: VERIFY AND FINALIZE

| Outcome | Condition | Action |
|---|---|---|
| Core success | All `optional: false` contracts pass | Update snapshot, report success |
| Partial success | Optional contract fails but side effects are isolated | Update snapshot with warning; surface to user |
| Full rollback | Any NCV violation triggered during apply, or `optional: false` contract fails | Execute rollback for all applied components; execute schema migration `down` SQL for stateful components; remove `external_deps`; report `INSTALL_FAILED` |

On success, the executor updates `installed_capabilities` in `host-snapshot.json`.

### HEALTH-CHECK (Periodic / Post-Base-Update)

The executor may run a health check at any time after installation:

1. Re-run all probes for all installed capabilities.
2. Re-run all contracts for all installed capabilities.
3. Detect contract drift: contracts that passed at install time but fail now.
4. Output `health_report` listing any drifted capabilities with their failing contracts.

---

## 11. Installation Transaction Semantics

### Default: Serial Installation

When installing multiple capabilities at once, the executor installs them in dependency order (topological sort of `depends_on` relationships across packages). If capability B `depends_on` capability A's component, A must complete Phase 6 before B begins Phase 1.

### Parallel Prohibition

Two capabilities that share any element in their `anchors_used` arrays **must not** be installed in parallel. The same anchor cannot be in simultaneous mutation. Executors must detect and serialize such overlapping installations.

### Optional: Atomic-Batch Mode

When the user requests atomic installation of multiple capabilities:

1. All capabilities complete Phases 1–4 (dry-run and confirm) before any begins Phase 5.
2. All Phase 5 applies proceed.
3. Any Phase 6 verify failure for any capability triggers full rollback for all capabilities in the batch.
4. Atomic-batch mode is an executor-level feature; it is not required for conformance.

---

## 12. scsp pack Flow

`scsp pack` produces a new capability package from local modifications.

### Step 1: Analyze Git Diff

The executor agent compares the current working state (or a specified branch) against the declared base branch. It identifies:

- Which files were modified
- Whether changes touched schema files, API routes, components, or hook locations
- Which manifest anchors correspond to the changed files (cross-referenced via snapshot)

### Step 2: Identify Affected Surfaces and Anchors

Using the host snapshot as a lookup table, the agent maps modified files to anchor IDs. Modified Prisma models → entity anchors. Modified `signIn` callback → hook anchor. Modified sidebar component → slot anchor.

### Step 3: Generate .scsp Draft

The agent auto-populates frontmatter from the diff analysis:

- `surfaces_touched` and `anchors_used` from the anchor mapping
- `blast_radius` estimated from number of files changed and dependency graph depth
- `permissions` inferred from surface types touched
- `intent` seeded from commit messages and branch name
- `probes` generated from the current file locations of each anchor (converted to patterns, not hardcoded paths)
- `contracts` drafted from changed interface signatures
- `ncv` defaults applied based on permissions (e.g., if no filesystem permission, generate `no-filesystem-write` NCV automatically)

### Step 4: Two Pack Modes

**Quick Pack** produces a minimal capability for rapid sharing:
- Frontmatter with all required fields
- `## Intent` section
- Minimal probes (one per required anchor, grep-only, `on_fail: warn`)
- No contracts, no fixtures

**Full Pack** produces a production-quality capability:
- Complete frontmatter
- Full intent with state machine description
- Probes with both `grep` and `ast` check_hints
- NCV for all permission-implied constraints
- Fixtures and contracts generated from interface changes
- Interfaces section

### Step 5: User Review and Edit

The generated draft is opened in the user's editor. The agent annotates `# TODO` comments at sections requiring human input (intent motivation, state machine description, contract assertions).

### Step 6: Sign and Output

After user approval, the executor:
1. Validates the frontmatter against the protocol schema
2. Signs the file using the author's ed25519 key (`author.key`)
3. Sets `signature` in frontmatter
4. Writes the final `.scsp` file

---

## 13. Registry: Publish and Fetch Protocol

### Directory Structure (Git-Based Registry, V0.1)

```
registry/
├── capabilities/
│   └── {capability-id}/
│       ├── {capability-id}.scsp
│       └── metadata.json
├── index.json
└── AUTHORS.json
```

### metadata.json Structure

```json
{
  "id": "auth-totp-enforcement",
  "name": "TOTP Two-Factor Authentication",
  "version": "1.0.0",
  "pricing": {
    "model": "free"
  },
  "preview_url": "https://example.com/totp-demo",
  "screenshots": [
    "https://example.com/screenshots/totp-settings.png"
  ],
  "reports": {
    "success": 142,
    "fail": 8,
    "rollback": 3,
    "sample_size": 153
  },
  "installs": 153,
  "active_installs": 147,
  "fork_count": 12,
  "stack_depth": 0,
  "compatibility_score": 0.94,
  "auto_review": {
    "schema_valid": true,
    "ncv_self_check": true,
    "dependency_audit": true,
    "signed": true
  }
}
```

### Commands

```bash
# Publish a capability to a registry
scsp publish auth-totp-enforcement.scsp --registry https://github.com/example/scsp-registry

# Fetch a capability from a registry
scsp fetch auth-totp-enforcement --registry https://github.com/example/scsp-registry
```

In the git-based registry, publishing is implemented as: fork the registry repository, place the `.scsp` file and `metadata.json` in the correct directory, open a pull request. An automated bot validates the package (schema check, NCV self-check, signature verification) and auto-merges on pass.

---

## 14. Metrics System

The following metrics are tracked at the registry layer (not inside capability packages).

| Metric | Definition |
|---|---|
| `installs` | Total number of install attempts that reached Phase 5 |
| `active_installs` | Install attempts where capability remains in the host snapshot (not rolled back) |
| `rollback_rate` | `rollback_count / installs` |
| `fork_count` | Number of capabilities that declare this capability as `parent_id` |
| `stack_depth` | Maximum depth of lineage chain from origin to this capability |
| `compatibility_score` | Rolling average of probe pass rate across reported installs |
| `author_reputation` | Aggregate score computed from: rollback_rate, fork_count of author's capabilities, community ratings |

---

## 15. Migration Patches

When a host application releases a new version that breaks installed capabilities, a migration patch can be published to repair the breakage.

Migration patches have `type: "migration"` in their frontmatter and an additional `migration:` block:

```yaml
---
scsp: "0.1"
id: "auth-totp-enforcement-migration-next15"
type: "migration"
name: "TOTP auth-totp-enforcement → Next.js 15 compatibility"

migration:
  trigger:
    dependency: "next"
    from_version: ">=14.0.0 <15.0.0"
    to_version: ">=15.0.0"
  affected_surfaces:
    - logic_domains
  affected_anchors:
    - "auth.password_login.post_verify"
  capability_impact:
    revalidate:
      - "auth-totp-enforcement"
    known_breaks:
      - capability: "auth-totp-enforcement"
        version: "<1.1.0"
        reason: "signIn callback signature changed in Next.js 15"
  rollback_possible: true
  rollback_reason: "Downgrade requires reverting Next.js version, which is out of scope"
---
```

### Migration Patch Execution Stages

1. **NOTIFY**: Surface the migration patch to affected users
2. **INVENTORY**: Identify all installed capabilities affected by the trigger
3. **PROBE**: Run probes for all affected capabilities against the new codebase version
4. **VALIDATE**: Check compatibility of all affected capabilities against updated manifest
5. **DRY-RUN**: Generate migration changes
6. **HUMAN CONFIRM**: Show impact report and user choices
7. **APPLY**: Apply migration changes, re-run affected capability's migrations if needed
8. **VERIFY**: Re-run all affected capability contracts; update snapshot

---

## 16. Anchor Naming Convention

All anchor IDs follow a three-segment dot-notation:

```
{domain}.{entity_or_flow}.{hook_point}
```

| Segment | Description | Examples |
|---|---|---|
| `domain` | Functional domain of the application | `auth`, `billing`, `nav`, `settings` |
| `entity_or_flow` | The specific entity or user flow | `password_login`, `subscription`, `sidebar`, `security` |
| `hook_point` | Where in the lifecycle the anchor sits | `post_verify`, `on_upgrade`, `pre_dispatch` |

**Examples**:

| Anchor ID | Meaning |
|---|---|
| `auth.password_login.post_verify` | After password verification, before session creation |
| `billing.subscription.on_upgrade` | When a user upgrades their subscription |
| `notifications.send.pre_dispatch` | Before a notification is dispatched |
| `settings.security` | The security section of the settings UI (slot) |
| `nav.sidebar` | The navigation sidebar (slot) |

Two-segment anchors (e.g., `nav.sidebar`, `settings.security`) are valid for UI slots where there is no lifecycle phase — just a location.

---

## 17. Anchor Deprecation

When a developer renames or restructures an anchor, they must declare the old anchor as deprecated in the manifest, providing the new canonical ID and a sunset date.

```yaml
anchors:
  hooks:
    - id: "auth.password_login.post_verify"
      deprecated_by: "auth.login.post_verify"
      sunset: "2026-07-01"
    - id: "auth.login.post_verify"
      description: "Canonical replacement for auth.password_login.post_verify. Covers all login methods."
```

Executor behavior for deprecated anchors:
- Before sunset date: executor warns user; capability still installs; executor maps deprecated ID to new location.
- After sunset date: executor treats the anchor as `MISSING_ANCHOR` and aborts unless the capability has been updated to use the replacement ID.
- The registry health check surfaces capabilities that reference anchors past their sunset date.

---

## 18. Lineage and Version Snapshots

### Lineage

Capabilities can track their evolutionary history through the `lineage` block:

```yaml
lineage:
  origin: "auth-totp-enforcement"
  parent: "auth-totp-enforcement@1.0.0"
  patches_applied:
    - "auth-totp-enforcement-migration-next15"
  divergence_point: "2026-04-15T10:00:00Z"
```

### Version Snapshots

A version snapshot represents a curated, tested combination of a base application version with a set of installed capabilities. It is the SCSP equivalent of a "release bundle."

```json
{
  "type": "version_snapshot",
  "id": "my-saas-app-v2.5-with-totp-dark",
  "base": "my-saas-app@2.4.1",
  "patches_included": [
    "auth-totp-enforcement@1.0.0",
    "dark-theme-sidebar@1.2.0"
  ],
  "devguide_version": "2026-04-19",
  "active_installs": 847,
  "preview_url": "https://demo.my-saas-app.com/preview/totp-dark"
}
```

### Developer Updates Are Also Patches

A key philosophical commitment of SCSP: the protocol layer has no distinction between "official" and "community" updates. A developer releasing version 2.5 of their application is, from the protocol's perspective, publishing a patch against version 2.4.1. The `verified_author` badge is a display-layer concept implemented by registries; it is not encoded in the protocol. This design ensures the protocol remains neutral and extensible.

---

## 19. Executor Conformance Requirements

A conforming SCSP executor must satisfy all of the following:

1. **Probe-first**: Execute all `on_fail: abort` probes before making any modification to the codebase.
2. **Dry-run before apply**: Complete a full dry-run (Phase 3) and generate a `dry_run_report` before entering Phase 5.
3. **NCV in dry-run**: Run all NCV checks against generated code during dry-run. Do not defer NCV to post-apply.
4. **Human confirmation**: If `risk_factors` is non-empty (auto-derived or additional), must obtain explicit user confirmation before Phase 5.
5. **Rollback support**: Must support rollback for all stateful operations. Must execute `down` SQL for schema migrations on rollback.
6. **Snapshot update**: Must update `installed_capabilities` in `host-snapshot.json` on successful installation. Must remove the entry on successful rollback.
7. **Dependency ordering**: Must install components in topological order of `depends_on` declarations.
8. **Conflict detection**: Must check `conflicts` array against `installed_capabilities` before applying.

Executors may extend this behavior (e.g., adding additional NCV checks, richer test generation) as long as they do not skip any required stage.

---

## 20. Version Compatibility Rules

### Protocol Version (scsp field)

The `scsp` field in both frontmatter and manifests follows [Semantic Versioning](https://semver.org/):

- **Patch versions** (0.1.0 → 0.1.1): Bug fixes in schema validation. No new required fields.
- **Minor versions** (0.1.x → 0.2.x): New optional fields may be added. Executors conformant to 0.1 must ignore unknown fields rather than rejecting the document.
- **Major versions** (0.x → 1.0): Breaking changes to required fields or execution semantics. Executors must reject capabilities with incompatible major versions.

### Manifest Version Constraint

A capability's `requires.manifest_version` uses [node-semver](https://github.com/npm/node-semver) range syntax:

```yaml
requires:
  manifest_version: ">=2.0.0 <3.0.0"
```

The executor must compare this range against the `version` field in the host manifest. A mismatch causes `INCOMPATIBLE_HOST` error at Phase 2.

---

## 21. V0.1 Scope Declaration

### In Scope (V0.1)

The following are fully specified and stable in V0.1:

- Capability package format (`.scsp` frontmatter and body structure)
- Host manifest format (`scsp-manifest.yaml`)
- Host snapshot format (`host-snapshot.json`)
- Six-stage execution model semantics
- NCV type system
- Contract, fixture, and interface format
- `scsp pack` flow
- Publish/fetch minimum protocol
- Git-based registry directory structure

### Out of Scope (Deferred to V0.2 and Later)

The following are intentionally deferred and should not be implemented as protocol-layer features in V0.1:

- **Snapshot generation tooling**: The reference implementation of automatic snapshot generation from a codebase is a V0.2 deliverable.
- **Community UI components**: Embeddable marketplace widgets and in-app browsing UI are registry-layer, not protocol-layer.
- **Payment integration**: Paid capability access, licensing tokens, and author revenue sharing are registry-layer concerns.
- **A2A (Agent-to-Agent) Protocol**: Direct negotiation between executor agents on different hosts is a V0.2 research item.

---

*SCSP Protocol Specification V0.1 — Last updated 2026-04-19*
