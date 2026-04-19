# SCSP — Software Capability Sharing Protocol

> **软件能力共享协议** · 去中心化的软件进化基础设施

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Protocol](https://img.shields.io/badge/protocol-language--agnostic-orange.svg)](docs/PROTOCOL.md)

---

## 任何开源软件，用户都能一键安装社区改进，也能一键分享自己的改进。

**Any open-source software can have community-driven improvements installed in one command — and users can share their own improvements just as easily.**

Software that grows from user needs, not product managers.

---

## The Problem

Software customization in 2026 is broken in three specific ways:

- **AI agents make coding trivial, but sharing is still prehistoric.** A user can ask an agent to add TOTP 2FA to their app in minutes. But sharing that improvement with a thousand other users of the same software still requires forking the repo, writing migration docs, and hoping the maintainer merges it — a process measured in months, not seconds.

- **Plugin systems require upfront architectural commitment.** Developers must design extension points before shipping. Most production software has no plugin system at all. If it wasn't planned from day one, users are locked out — no matter how good the improvement.

- **There is no universal protocol for "here's what I changed and how your agent can replicate it."** Raw diffs are tied to specific file paths and library versions. There is no portable, intent-driven format that an AI agent can pick up and adapt to a different variant of the same codebase.

The result: user knowledge evaporates. Every user rediscovers the same improvements independently, forever.

---

## The Solution

**SCSP** is a language-agnostic protocol for packaging, distributing, and installing software improvements as **capability packages** (`.scsp` files).

A `.scsp` file describes *intent*, not *code*. It specifies what an improvement does, where it connects to the host application, what constraints it must never violate, and how to roll it back. Any AI agent that understands SCSP can read a capability package and apply it to any codebase — regardless of language, framework, or version.

```
┌────────────────────────────────────────────────────────────────────┐
│                    SCSP Ecosystem Overview                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Developer adds scsp-manifest.yaml  ──▶  Declares extension points │
│                                                                    │
│  User modifies local code           ──▶  scsp pack                 │
│                                          └──▶  my-feature.scsp     │
│                                                                    │
│  User shares capability             ──▶  scsp publish              │
│                                          └──▶  registry            │
│                                                                    │
│  Any user installs in one command   ──▶  scsp install auth-totp-v1 │
│                                          └──▶  6-stage execution   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### The Six-Stage Execution Model

When a user runs `scsp install <id>`, the executor agent follows a strict, safe, reversible pipeline:

| Stage | Name | What Happens |
|-------|------|-------------|
| 1/6 | **PROBE** | Agent scans the codebase for declared extension points (hooks, slots, entities). Confirms the capability's requirements are met. |
| 2/6 | **VALIDATE** | Cross-checks the capability against the host manifest and snapshot. Detects conflicts with already-installed capabilities. |
| 3/6 | **DRY-RUN** | Generates all changes in a temporary branch. Produces a full diff for human review. No permanent changes made. |
| 4/6 | **CONFIRM** | Human gate. User reviews the diff and explicitly approves before anything is applied. |
| 5/6 | **APPLY** | Changes applied, database migrations run, dependencies installed. A snapshot is taken for rollback. |
| 6/6 | **VERIFY** | Runs the capability's declared contracts and test fixtures against the live system. On failure, automatic rollback triggers. |

Every stage is logged. Every installation is reversible. No silent changes.

### The Three-Layer Architecture

SCSP separates concerns across three artifacts:

| Artifact | Author | Purpose |
|----------|--------|---------|
| `scsp-manifest.yaml` | App developer | Declares what surfaces, hooks, and slots are available for extension |
| `host-snapshot.json` | Executor agent | Maps manifest declarations to concrete file locations in the current codebase |
| `my-feature.scsp` | Community user | Describes an improvement in terms of the manifest's vocabulary |

This separation is what makes SCSP language-agnostic: capability packages reference abstract surfaces like `auth` and `User`, not specific files like `src/models/user.ts`.

---

## Quick Start

```bash
npm install -g @yytyyf/scsp
```

### Validate a capability package

```bash
scsp validate my-feature.scsp
```

### Inspect a capability's parsed structure

```bash
scsp inspect examples/capabilities/auth-totp.scsp
```

### Pack your local changes into a capability

```bash
scsp pack --mode quick --out my-feature.scsp
```

### Publish to the community registry

```bash
scsp publish my-feature.scsp --registry https://github.com/scsp-community/registry
```

### Install a capability from the registry

```bash
scsp install auth-totp-v1
```

---

## Example: Install TOTP 2FA in One Command

This is what it looks like when a user installs the community-contributed TOTP two-factor authentication capability into their Express or Next.js application.

```shell
$ scsp install auth-totp-v1

  Fetching auth-totp-v1 from registry...
  ✓ Signature verified (alice · ed25519)
  ✓ Capability schema valid

  [1/6] PROBE — scanning codebase for extension points
        ✓ Entity: User (id: string, email: string)
        ✓ Hook:   auth.password_login.post_verify
        ⚠  Slot:  settings.security not found
              → totp-settings-ui component will be skipped
              → Backend TOTP enforcement will still be installed

  [2/6] VALIDATE — checking host manifest compatibility
        ✓ manifest_version >=0.1 satisfied (host: 0.1)
        ✓ No conflicts with installed capabilities
        ✓ surfaces_writable: [auth, User] — permitted
        ✓ schema_migration: true — permitted by manifest

  [3/6] DRY-RUN — generating changes in temporary branch
        + src/middleware/totp.ts                 (new file)
        + src/routes/auth/2fa.ts                 (new file)
        + migrations/20260419_add_totp_fields.sql (new file)
        ~ src/routes/auth/login.ts               (+12 / -2 lines)
        ~ src/models/user.ts                     (+3 / -0 lines)
        ✓ Dry-run complete — 3 files added, 2 modified

  [4/6] CONFIRM — review diff and approve

        Diff preview at: /tmp/scsp-dryrun-auth-totp-v1/
        Schema migration: ALTER TABLE users ADD COLUMN totp_secret TEXT...

        Apply these changes? [y/N]: y

  [5/6] APPLY — applying changes
        ✓ Files written
        ✓ Migration applied (users.totp_secret, users.totp_enabled, recovery_codes)
        ✓ Dependency installed: otplib@12.0.1
        ✓ Snapshot saved → .scsp-state/auth-totp-v1.snapshot.json

  [6/6] VERIFY — running contracts against live system
        ✓ contract-enable-2fa           (POST /auth/2fa/enable → 200)
        ✓ contract-totp-verify-success  (valid code → authenticated session)
        ✓ contract-lockout-after-5      (429 on 6th attempt)
        ✓ contract-recovery-code        (single-use enforcement)

  ────────────────────────────────────────────────────────
  ✓ auth-totp-v1 installed successfully
    4 contracts passing · rollback available via: scsp rollback auth-totp-v1
  ────────────────────────────────────────────────────────
```

No forking. No reading someone else's codebase. No migration docs. One command.

---

## Capability Package Format

A `.scsp` file is a structured document: YAML frontmatter followed by a Markdown body with fenced YAML sections. Here is an excerpt from `auth-totp.scsp`:

```yaml
---
scsp: "0.1"
id: auth-totp-v1
name: "TOTP Two-Factor Authentication"
version: "1.0.0"
tags: ["auth", "security", "2fa"]

author:
  name: alice
  key: "ed25519:MCowBQYDK2VwAyEA4k7jBKJFvF2xRqmH9pLnZdTsWuIoYeCgXbNvPqRsT3U="
signature: "ed25519:3d9f2a..."
created: "2026-04-01T12:00:00Z"
revoked: false

env_hint:
  runtime: ["node>=18", "python>=3.10", "go>=1.21"]
  frameworks: [express, fastapi, gin, nextjs]

requires:
  manifest_version: ">=0.1"
  surfaces:
    entities: [User]
    logic_domains: [auth]
    ui_areas: [settings]
  anchors:
    hooks: [auth.password_login.post_verify]
    slots: [settings.security]
    entities: [User]

components:
  - id: totp-backend
    layer: module
    optional: false
    surfaces_touched: [auth, User]
    anchors_used: [auth.password_login.post_verify, User]
    blast_radius:
      structural_impact: [Route, Middleware, DatabaseSchema]
      dependency_depth: 2
    rollback:
      stateless: snapshot-based
      stateful:
        - type: schema_migration
          down: |
            ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;
            ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled;
            DROP TABLE IF EXISTS recovery_codes;
    permissions:
      surfaces_writable: [auth, User]
      schema_migration: true
      external_deps: [otplib, pyotp, otp]

conflicts:
  - id: auth-passwordless-v1
    reason: "Both modify login flow entry point — simultaneous installation
             would create a double-intercept on post_verify."
---

## Intent

TOTP Two-Factor Authentication adds RFC 6238-compliant time-based one-time
password support to the host application's login flow...
```

The body continues with fenced YAML blocks for `probes:`, `ncv:` (negative constraints), `contracts:`, `fixtures:`, and `interfaces:` — each section parsed and validated independently by the executor.

### Key sections in a `.scsp` file

| Section | Purpose |
|---------|---------|
| **Frontmatter** | Identity, author, signature, environment hints, required surfaces and anchors, component declarations, conflict graph |
| `probes:` | Checks the executor runs against the host codebase before touching anything. Fail = abort; warn = skip optional component |
| `ncv:` | Negative Constraint Verification — things the implementation must *never* do (e.g. log secrets, bypass auth) |
| `contracts:` | Behavioral specifications expressed as given/when/then scenarios. Run during VERIFY stage |
| `fixtures:` | Test data needed to run contracts |
| `interfaces:` | Public API surface the capability exposes, with request/response schemas |

---

## Included Examples

Four production-quality capability packages ship with this repository:

| File | Type | Description |
|------|------|-------------|
| [`auth-totp.scsp`](examples/capabilities/auth-totp.scsp) | Module | TOTP 2FA with schema migration, brute-force lockout, single-use recovery codes, and OWASP ASVS 2.8 compliance constraints |
| [`calendar-week-view.scsp`](examples/capabilities/calendar-week-view.scsp) | Component | 7-day week view with drag-and-drop event rescheduling, compatible with React, Vue, and Svelte |
| [`approval-workflow.scsp`](examples/capabilities/approval-workflow.scsp) | Behavior | Multi-step approval state machine (draft → review → approved/rejected) with audit trail and email notifications |
| [`perf-image-lazy-load.scsp`](examples/capabilities/perf-image-lazy-load.scsp) | Improvement | IntersectionObserver-based lazy loading for image-heavy pages; zero dependencies, progressive enhancement |

Each example includes full probes, contracts, fixtures, and negative constraints — they are not stubs.

### Host Manifest Examples

| File | Description |
|------|-------------|
| [`examples/manifests/express-app.manifest.yaml`](examples/manifests/express-app.manifest.yaml) | Node.js / Express application with auth, user, and settings surfaces declared |
| [`examples/manifests/nextjs-app.manifest.yaml`](examples/manifests/nextjs-app.manifest.yaml) | Next.js full-stack application with App Router conventions |

---

## Validation

The CLI validates `.scsp` files against the JSON Schema spec and runs consistency checks across sections:

```bash
$ npm test

✓ examples/capabilities/auth-totp.scsp [auth-totp-v1]
✓ examples/capabilities/calendar-week-view.scsp [calendar-week-view-v1]
✓ examples/capabilities/approval-workflow.scsp [approval-workflow-v1]
✓ examples/capabilities/perf-image-lazy-load.scsp [perf-image-lazy-load-v1]

All 4 file(s) valid.
```

Validation catches:

- Schema violations (required fields, type mismatches, enum values)
- Consistency errors (component references a surface not declared in `requires`, anchor used but not listed, etc.)
- Cross-section integrity (fixture referenced in contract must exist in `fixtures:`)

Output as JSON for CI integration:

```bash
scsp validate examples/capabilities/*.scsp --json
```

---

## Registry Protocol

### V0.1 — Git-based Registry (current)

The reference registry is a public GitHub repository. Publishing a capability is a pull request:

```
scsp-community/registry/
└── capabilities/
    └── auth-totp-v1/
        ├── auth-totp-v1.scsp      ← the capability package
        └── metadata.json          ← install count, avg rating, tags
```

A GitHub Actions workflow validates every PR against the JSON Schema before merge. No human review required for structurally valid packages.

```bash
# Step-by-step (what scsp publish guides you through in V0.1)
git clone https://github.com/scsp-community/registry
cp auth-totp-v1.scsp registry/capabilities/auth-totp-v1/auth-totp-v1.scsp
# ... create metadata.json ...
# submit pull request → bot validates → auto-merge on pass
```

### V0.2 — HTTP Registry API (planned)

```
POST /v1/capabilities          → publish
GET  /v1/capabilities/:id      → fetch by ID
GET  /v1/capabilities?tag=auth → search by tag
POST /v1/capabilities/:id/rate → rate after install
```

Full spec draft at [`docs/REGISTRY-API.draft.md`](docs/REGISTRY-API.draft.md).

---

## Project Structure

```
scsp/
│
├── docs/
│   ├── PROTOCOL.md              # Complete protocol specification (21 sections)
│   └── REGISTRY-API.draft.md   # HTTP registry API design (V0.2)
│
├── spec/
│   ├── scsp-capability.schema.json    # JSON Schema for .scsp files
│   ├── scsp-manifest.schema.json      # JSON Schema for scsp-manifest.yaml
│   └── scsp-host-snapshot.schema.json # JSON Schema for host-snapshot.json
│
├── examples/
│   ├── capabilities/
│   │   ├── auth-totp.scsp             # TOTP 2FA capability
│   │   ├── calendar-week-view.scsp    # Week view UI component
│   │   ├── approval-workflow.scsp     # Approval state machine
│   │   └── perf-image-lazy-load.scsp # Lazy loading improvement
│   └── manifests/
│       ├── express-app.manifest.yaml  # Express host manifest
│       └── nextjs-app.manifest.yaml   # Next.js host manifest
│
├── src/
│   ├── parser.ts    # .scsp file parser (frontmatter + fenced section extraction)
│   └── cli.ts       # scsp CLI (validate, inspect, pack, publish, install, health)
│
├── package.json
└── tsconfig.json
```

---

## Making Your Software SCSP-Compatible

If you maintain an open-source project, adding a `scsp-manifest.yaml` allows your users to share improvements without forking your repo.

### Minimal manifest

```yaml
# scsp-manifest.yaml — commit this to your repo root
scsp_manifest: "0.1"
app:
  name: my-app
  description: "My open-source application"
  repo: https://github.com/you/my-app

surfaces:
  entities:
    - name: User
      description: "Core user model"
  logic_domains:
    - name: auth
      description: "Authentication and session management"
  ui_areas:
    - name: settings
      description: "User settings pages"

anchors:
  hooks:
    - id: auth.password_login.post_verify
      description: "Fires after password is verified, before session is created"
      signature:
        receives: [user_id, session_context]
        can_short_circuit: true
  slots:
    - id: settings.security
      description: "Security settings panel injection point"
      accepts: [panel, card]

permissions:
  allow_schema_migration: true
  allow_external_deps: true
```

That's it. Your software now has a stable extension contract that AI agents and community users can build against — without you writing a single plugin API.

### Validation

```bash
# Validate your manifest against the spec
scsp validate --manifest scsp-manifest.yaml
```

---

## Roadmap

### V0.1 — Protocol Foundation (current)

- [x] Complete protocol specification (`docs/PROTOCOL.md`, 21 sections)
- [x] `.scsp` file format with YAML frontmatter + fenced section body
- [x] JSON Schema for capability packages, manifests, and host snapshots
- [x] CLI: `validate`, `inspect`, `pack`, `publish`, `install`, `health`
- [x] 4 production-quality example capability packages
- [x] Git-based registry protocol
- [x] 6-stage execution model specification
- [x] Negative Constraint Verification (NCV) system
- [x] Conflict graph and blast radius declarations

### V0.2 — Executor & Registry API

- [ ] HTTP Registry API (`POST /v1/capabilities`, `GET /v1/capabilities/:id`)
- [ ] Full executor agent integration (Claude / GPT-4 / local models)
- [ ] Automatic probe execution against live codebases
- [ ] Contract runner with live system verification
- [ ] `scsp rollback <id>` with automatic migration reversal
- [ ] Capability dependency resolution
- [ ] Signed install receipts

### V0.3 — Ecosystem & Economics

- [ ] Community UI: capability browser, install stats, lineage graph visualization
- [ ] Micropayment model: capability authors earn per install (Stripe / crypto)
- [ ] Lineage graph: trace capability evolution across forks and adaptations
- [ ] Capability composition: install multiple capabilities as a bundle
- [ ] Capability marketplace SDK for platform developers
- [ ] `scsp audit`: security review of installed capabilities

---

## Contributing

### Adding capabilities to the registry

1. Fork [scsp-community/registry](https://github.com/scsp-community/registry)
2. Write your `.scsp` file (use `scsp pack` to generate a draft from your git diff)
3. Validate: `scsp validate your-capability.scsp`
4. Submit a PR — the bot validates and merges automatically if the schema passes

### Adding SCSP support to your project

Commit a `scsp-manifest.yaml` to your repository root (see [Making Your Software SCSP-Compatible](#making-your-software-scsp-compatible) above). Open an issue in this repo to be listed as an officially supported host application.

### Improving the protocol

The protocol specification lives in [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Open a discussion issue before proposing changes to core concepts — especially the execution model and anchor naming conventions, which have downstream compatibility implications.

### Development

```bash
git clone https://github.com/scsp-community/scsp
cd scsp
npm install

# Run the validator on all examples
npm test

# Build TypeScript
npm run build

# Run the CLI in development
npx ts-node src/cli.ts validate examples/capabilities/auth-totp.scsp
npx ts-node src/cli.ts inspect examples/capabilities/auth-totp.scsp --section probes
```

---

## Why This Matters

> *"The best software features were built by users who needed them. SCSP is the infrastructure that lets those features escape the user's machine."*

We are at an inflection point. AI agents can write production-quality code from a description. The bottleneck is no longer implementation — it is distribution. A user can add TOTP 2FA to their app in ten minutes with an AI agent. But today, that improvement dies on their machine. It never reaches the next user who wants the same thing.

SCSP is the missing layer: a protocol that lets the agent's output become a portable, shareable, installable artifact. The `.scsp` file is to software improvements what `.deb` and `.pkg` are to software itself — a standardized container that any compatible system can consume.

The vision is a world where:
- Popular open-source projects have thriving capability ecosystems, independent of their maintainers' roadmaps
- Users earn credit (and eventually income) for improvements they contribute
- Software evolves at the speed of user needs, not the speed of pull request reviews

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built at a hackathon. Designed for the long run.*

> 改 → 打包 → 分享 → 一键装  
> Modify → Pack → Share → One-Click Install
