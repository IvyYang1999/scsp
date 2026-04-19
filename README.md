<p align="center">
  <img src="docs/banner.png" alt="SCSP" width="100%">
</p>

<p align="center">
  <strong>Software Capability Sharing Protocol</strong><br>
  Package any improvement to any open-source software. Share it. Let anyone install it in one command.<br>
  <em>改 → 打包 → 分享 → 一键装</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="MIT License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/version-0.2.0-6366f1?style=flat-square" alt="Version"></a>
  <a href="tsconfig.json"><img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="docs/PROTOCOL.md"><img src="https://img.shields.io/badge/protocol-language--agnostic-f59e0b?style=flat-square" alt="Protocol"></a>
  <a href="https://www.npmjs.com/package/@yytyyf/scsp"><img src="https://img.shields.io/badge/npm-@yytyyf%2Fscsp-cb3837?style=flat-square&logo=npm&logoColor=white" alt="npm"></a>
</p>

---

## The Problem

A user can ask an AI agent to add TOTP 2FA to their app in ten minutes. But sharing that improvement with a thousand other users of the same software still requires a pull request, a code review, and a maintainer who has time — a process measured in months, not seconds.

User knowledge evaporates. Every user rediscovers the same improvements, forever.

## The Solution

SCSP is a **language-agnostic protocol** for packaging, distributing, and installing software improvements as `.scsp` capability packages.

A `.scsp` file describes *intent*, not *code*. It specifies what an improvement does, where it connects to the host application, what constraints it must never violate, and how to roll it back. Any AI agent that understands SCSP can read a capability package and adapt it to any compatible codebase — regardless of language, framework, or version.

```
Developer declares extension points  ──▶  scsp-manifest.yaml
User builds a local improvement      ──▶  scsp pack  ──▶  my-feature.scsp
User publishes to the community      ──▶  scsp publish
Anyone installs in one command       ──▶  scsp install auth-totp-v1
```

---

## Install

```bash
npm install -g @yytyyf/scsp
```

Then install the Claude Code skills so you can run installs from inside any session:

```bash
scsp skills install --global
```

Available skills: `/scsp-onboard` · `/scsp-install` · `/scsp-explore` · `/scsp-sync` · `/scsp-review` · `/scsp-health`

---

## Demo

This is what installing a community TOTP two-factor authentication capability looks like:

```
$ scsp install auth-totp-v1

  Fetching auth-totp-v1...  ✓ signature verified (alice · ed25519)

  [1/6] PROBE — scanning extension points
        ✓ Entity: User (id, email)
        ✓ Hook:   auth.password_login.post_verify → src/routes/auth/login.ts:47
        ⚠  Slot: settings.security not found
              → totp-settings-ui will be skipped
              → backend enforcement still installs

  [2/6] VALIDATE
        ✓ surfaces, anchors, permissions — all clear
        ✓ no conflicts with installed capabilities

  [3/6] DRY-RUN
        + src/middleware/totp.ts
        + src/routes/auth/2fa.ts
        + migrations/20260419_add_totp.sql
        ~ src/routes/auth/login.ts   (+12 / -2)
        ~ src/models/user.ts         (+3 / -0)

  [4/6] CONFIRM
        Apply these changes? [y/N]: y

  [5/6] APPLY
        ✓ files written · migration applied · otplib@12.0.1 installed

  [6/6] VERIFY
        ✓ contract-enable-2fa
        ✓ contract-totp-verify-success
        ✓ contract-lockout-after-5-failures
        ✓ contract-recovery-code-single-use

  ✓  auth-totp-v1 v1.0.0 installed · rollback: scsp rollback auth-totp-v1
```

No forking. No migration docs. No reading someone else's codebase.

---

## How It Works

### The Six Stages

Every `scsp install` runs the same safe, reversible pipeline:

| Stage | Name | What happens |
|-------|------|-------------|
| 1 | **PROBE** | Agent scans for declared extension points. Confirms requirements are met. |
| 2 | **VALIDATE** | Cross-checks capability against the host manifest. Detects conflicts. |
| 3 | **DRY-RUN** | Generates all changes. Produces a full diff. Nothing is written yet. |
| 4 | **CONFIRM** | Human gate. You review and approve. |
| 5 | **APPLY** | Files written, migrations run, dependencies installed, snapshot saved. |
| 6 | **VERIFY** | Runs declared contracts against the live system. On failure: auto-rollback. |

### The Three Artifacts

| Artifact | Who writes it | What it does |
|----------|--------------|-------------|
| `scsp-manifest.yaml` | App developer | Declares available surfaces, hooks, and slots |
| `host-snapshot.json` | Executor agent | Maps manifest declarations to concrete file locations |
| `my-feature.scsp` | Community user | Describes an improvement in the manifest's vocabulary |

This separation is what makes capabilities language-agnostic: they reference abstract surfaces like `auth` and `User`, not specific files like `src/models/user.ts`.

---

## Claude Code Skills

SCSP ships as a set of Claude Code skills — the executor runs directly in your coding session, with full codebase context and no separate API key needed.

```bash
scsp skills install --global   # available in every session
scsp skills install            # project-only
```

<details>
<summary><strong>/scsp-onboard</strong> — Initialize SCSP for a project</summary>

Deep-reads your codebase and generates a `scsp-manifest.yaml` and `host-snapshot.json` with real anchor locations. Asks clarifying questions only when the code is ambiguous. Replaces the `scsp init` command (which uses shallow file scanning).

```
/scsp-onboard
```

</details>

<details>
<summary><strong>/scsp-install</strong> — Install a capability package</summary>

Full six-stage pipeline running in your Claude Code session. Understands your exact codebase at the time of installation — not a snapshot from when the package was written.

```
/scsp-install auth-totp-v1
/scsp-install auth-totp-v1 --dry-run
/scsp-install ./my-local-capability.scsp
```

</details>

<details>
<summary><strong>/scsp-explore</strong> — Browse the registry with AI recommendations</summary>

Reads your manifest and recommends capabilities that fit your actual codebase — not just tag matches. Explains why each capability is (or isn't) a good fit.

```
/scsp-explore
/scsp-explore auth
```

</details>

<details>
<summary><strong>/scsp-sync</strong> — Sync manifest after refactors</summary>

Detects drifted anchor locations, new extension points, and signature changes. Updates `host-snapshot.json` to match the current codebase.

```
/scsp-sync
```

</details>

<details>
<summary><strong>/scsp-health</strong> — Check installed capabilities</summary>

Re-runs all probes for installed capabilities. Identifies which ones have degraded or broken due to recent code changes.

```
/scsp-health
/scsp-health auth-totp-v1
/scsp-health --contracts
```

</details>

<details>
<summary><strong>/scsp-review</strong> — Peer-review a capability package</summary>

Validates probes, blast radius, NCV coverage, and contract completeness before publishing.

```
/scsp-review ./my-feature.scsp
```

</details>

---

## Community SDK

Add a capability browser to any project's docs site in one line:

```html
<script src="https://unpkg.com/@yytyyf/scsp/community-sdk/widget.js"></script>
<scsp-community
  registry="https://raw.githubusercontent.com/IvyYang1999/scsp/main/registry/index.json"
  theme="auto"
  max-height="600px"
></scsp-community>
```

The `<scsp-community>` web component is a self-contained Shadow DOM widget — no external CSS, no framework dependencies, light/dark/auto theme support. Drop it into any HTML page.

**Live example:** [Swob Community](https://github.com/IvyYang1999/swob/blob/main/docs/community/index.html) — the Claude Code session manager uses SCSP to let users install capabilities like [AI Session Summarizer](registry/capabilities/swob-session-summarizer-v1/).

---

## Making Your Software SCSP-Compatible

Add a `scsp-manifest.yaml` to your repo root. That's it — your project now has a stable extension contract that AI agents and community users can build against, without you writing a single plugin API.

```yaml
# scsp-manifest.yaml
scsp_manifest: "0.1"
name: my-app
version: "1.0.0"
repo: https://github.com/you/my-app

surfaces:
  entities: [User]
  logic_domains: [auth]
  ui_areas: [settings]

anchors:
  hooks:
    - id: auth.password_login.post_verify
      description: "Fires after password verification, before session creation"
  slots:
    - id: settings.security
      description: "Security settings panel injection point"
```

Or generate it automatically with:

```bash
# In your project, inside a Claude Code session:
/scsp-onboard
```

---

## Capability Package Format

A `.scsp` file is a structured document: YAML frontmatter followed by fenced YAML sections.

```yaml
---
scsp: "0.1"
id: auth-totp-v1
name: "TOTP Two-Factor Authentication"
version: "1.0.0"
tags: ["auth", "security", "2fa"]

author:
  name: alice
  key: "ed25519:MCowBQYDK2VwAyEA4k7..."
signature: "ed25519:3d9f2a1b..."

env_hint:
  runtime: ["node>=18", "python>=3.10", "go>=1.21"]
  frameworks: [express, fastapi, gin, nextjs]

requires:
  surfaces:
    entities: [User]
    logic_domains: [auth]
  anchors:
    hooks: [auth.password_login.post_verify]

components:
  - id: totp-backend
    layer: module
    optional: false
    blast_radius:
      structural_impact: [Route, Middleware, DatabaseSchema]
    rollback:
      stateful:
        - type: schema_migration
          down: |
            ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;
            DROP TABLE IF EXISTS recovery_codes;
---

## Intent

TOTP Two-Factor Authentication adds RFC 6238-compliant time-based one-time
password support to the host application's login flow...
```

The body continues with fenced `probes:`, `ncv:`, `contracts:`, `fixtures:`, and `interfaces:` sections.

<details>
<summary><strong>Section reference</strong></summary>

| Section | Purpose |
|---------|---------|
| **Frontmatter** | Identity, author, signature, environment hints, required surfaces and anchors, component declarations, conflict graph |
| `probes:` | Checks run against the codebase before touching anything. `on_fail: abort` stops installation; `on_fail: warn` skips optional components |
| `ncv:` | Negative Constraint Verification — things the implementation must *never* do (log secrets, bypass auth, etc.) |
| `contracts:` | Behavioral specifications as given/when/then. Run during VERIFY stage against the live system |
| `fixtures:` | Test data needed to run contracts |
| `interfaces:` | Public API surface the capability exposes, with request/response schemas |

</details>

---

## Registry

The reference registry lives at [`IvyYang1999/scsp`](https://github.com/IvyYang1999/scsp/tree/main/registry). Currently includes:

| Capability | Type | Description |
|-----------|------|-------------|
| [`auth-totp-v1`](registry/capabilities/auth-totp-v1/) | Module | TOTP 2FA with schema migration, brute-force lockout, single-use recovery codes, OWASP ASVS 2.8 compliance |
| [`approval-workflow-v1`](registry/capabilities/approval-workflow-v1/) | Behavior | Multi-step approval state machine with audit trail and notifications |
| [`calendar-week-view-v1`](registry/capabilities/calendar-week-view-v1/) | Component | 7-day week view with drag-and-drop event rescheduling |
| [`perf-image-lazy-load-v1`](registry/capabilities/perf-image-lazy-load-v1/) | Improvement | IntersectionObserver lazy loading, zero dependencies |
| [`swob-session-summarizer-v1`](registry/capabilities/swob-session-summarizer-v1/) | Module | AI-generated session summaries for [Swob](https://github.com/IvyYang1999/swob) |

### Publishing a capability

```bash
# From inside a Claude Code session (recommended):
/scsp-review ./my-feature.scsp    # validate before submitting

# Then open a PR to add your capability under:
# registry/capabilities/<your-id>/
```

A GitHub Actions workflow validates every PR against the JSON Schema before merge.

---

## Project Structure

```
scsp/
├── src/
│   ├── cli.ts          # scsp CLI (validate, inspect, pack, publish, skills)
│   └── skills.ts       # skills install/list/uninstall
│
├── skills/             # Claude Code skill files (.md)
│   ├── scsp-onboard.md
│   ├── scsp-install.md
│   ├── scsp-explore.md
│   ├── scsp-sync.md
│   ├── scsp-health.md
│   └── scsp-review.md
│
├── registry/           # Reference capability registry
│   ├── index.json
│   └── capabilities/
│       └── auth-totp-v1/
│           ├── auth-totp-v1.scsp
│           └── metadata.json
│
├── community-sdk/      # Embeddable web component
│   ├── widget.js       # <scsp-community> custom element
│   ├── index.html      # Standalone community page
│   └── styles.css
│
├── spec/               # JSON Schemas
│   ├── scsp-capability.schema.json
│   ├── scsp-manifest.schema.json
│   └── scsp-host-snapshot.schema.json
│
├── docs/
│   ├── PROTOCOL.md             # Full protocol spec (21 sections)
│   └── REGISTRY-API.draft.md  # HTTP registry API (V0.3 planned)
│
└── examples/
    ├── capabilities/           # Full example .scsp files
    └── manifests/              # Example host manifests
```

---

## Roadmap

<details>
<summary><strong>V0.1 — Protocol Foundation ✓</strong></summary>

- [x] Complete protocol specification (21 sections)
- [x] `.scsp` file format with YAML frontmatter + fenced sections
- [x] JSON Schema for capability packages, manifests, and snapshots
- [x] CLI: `validate`, `inspect`, `pack`, `publish`, `install`, `skills`
- [x] 5 production-quality example capability packages
- [x] Git-based registry protocol
- [x] 6-stage execution model
- [x] Negative Constraint Verification (NCV)
- [x] Conflict graph and blast radius declarations

</details>

<details>
<summary><strong>V0.2 — Skills & Community SDK ✓ (current)</strong></summary>

- [x] 6 Claude Code skills (`/scsp-onboard`, `/scsp-install`, `/scsp-explore`, `/scsp-sync`, `/scsp-health`, `/scsp-review`)
- [x] `<scsp-community>` embeddable web component
- [x] Standalone community page with dark/light theme
- [x] Real-world integration: [Swob](https://github.com/IvyYang1999/swob) + `swob-session-summarizer-v1`

</details>

<details>
<summary><strong>V0.3 — HTTP Registry & Executor</strong></summary>

- [ ] HTTP Registry API (`POST /v1/capabilities`, `GET /v1/capabilities/:id`, search by tag)
- [ ] Full executor agent integration (Claude / local models)
- [ ] Automatic probe execution against live codebases
- [ ] `scsp rollback <id>` with automatic migration reversal
- [ ] Capability dependency resolution
- [ ] Signed install receipts

</details>

<details>
<summary><strong>V0.4 — Ecosystem</strong></summary>

- [ ] Capability lineage graph: trace evolution across forks and adaptations
- [ ] Capability composition: install multiple capabilities as a bundle
- [ ] `scsp audit`: security review of installed capabilities
- [ ] Micropayment model: authors earn per install

</details>

---

## Development

```bash
git clone https://github.com/IvyYang1999/scsp
cd scsp
npm install

npm test           # validate all example capabilities
npm run build      # compile TypeScript
```

---

## Why This Matters

> *The bottleneck is no longer implementation — it is distribution.*

AI agents can write production-quality code from a description. A user can add TOTP 2FA to their app in ten minutes. But that improvement dies on their machine. It never reaches the next user who wants the same thing.

SCSP is the missing layer: a protocol that lets the agent's output become a portable, shareable, installable artifact. The `.scsp` file is to software improvements what `.deb` is to software itself — a standardized container that any compatible system can consume.

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built at a hackathon. Designed for the long run.*
