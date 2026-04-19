# SCSP Registry API — Draft Specification

**Status**: Draft — V0.2 (HTTP API layer; V0.1 uses git-based registry, see Section 8)**  
**Last Updated**: 2026-04-19

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Endpoints](#2-core-endpoints)
3. [Version Snapshots](#3-version-snapshots)
4. [Semantic Search](#4-semantic-search)
5. [Pricing and Access Control](#5-pricing-and-access-control)
6. [Quality Signals](#6-quality-signals)
7. [Embeddable Community UI (Roadmap)](#7-embeddable-community-ui-roadmap)
8. [Git-Based Registry — V0.1 (Active)](#8-git-based-registry--v01-active)

---

## 1. Overview

The SCSP Registry is a store for capability packages (`.scsp` files). It serves three roles:

1. **Discovery**: Users and executor agents search for capabilities that match their host application's surfaces, anchors, and intent.
2. **Distribution**: Capability files are fetched and delivered to executor agents for installation.
3. **Reputation**: Install reports, quality signals, and author metrics create a trust layer that agents can use to rank and recommend capabilities.

### Decentralized by Design

Anyone can run a registry node. There is no central authority. A registry is identified by its URL, and executors can be pointed at any registry with `--registry {url}`. The protocol specifies the API contract; nodes are free to implement storage, search, and access control as they choose.

An executor pointing at a community node and an executor pointing at an enterprise-internal node use the same API. Private registries can restrict access via the `Authorization` header without any protocol changes.

### V0.1 vs V0.2 Implementation Path

| Feature | V0.1 (Active) | V0.2 (This Document) |
|---|---|---|
| Publish | Pull request to git registry repo | `POST /capabilities` |
| Fetch | `git clone` or raw file download | `GET /capabilities/:id/download` |
| Search | Read `index.json` | `GET /capabilities` + `POST /search` |
| Reports | Manual PR to `metadata.json` | `POST /capabilities/:id/report` |

The V0.1 git-based registry is fully functional and described in Section 8. This document specifies the V0.2 HTTP API, which is designed to be backwards compatible with the index structure used in V0.1.

---

## 2. Core Endpoints

### Base URL

```
https://{registry-host}/api/v1
```

All endpoints return `Content-Type: application/json` unless otherwise noted.

---

### GET /capabilities

Search and filter the capability index.

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `tag` | string | Filter by tag (e.g., `auth`, `ui`, `billing`) |
| `surface` | string | Filter by surface touched (e.g., `entities`, `ui_areas`) |
| `anchor` | string | Filter by anchor used (e.g., `auth.login.post_verify`) |
| `q` | string | Keyword search across name and tags |
| `author` | string | Filter by author public key (ed25519 hex prefix) |
| `limit` | integer | Max results (default: 20, max: 100) |
| `offset` | integer | Pagination offset (default: 0) |
| `sort` | string | `active_installs` (default), `compatibility_score`, `created` |

**Example Request**

```
GET /api/v1/capabilities?tag=auth&surface=entities&anchor=auth.login.post_verify
```

**Example Response**

```json
{
  "total": 3,
  "offset": 0,
  "limit": 20,
  "results": [
    {
      "id": "auth-totp-enforcement",
      "name": "TOTP Two-Factor Authentication",
      "version": "1.0.0",
      "tags": ["auth", "security", "mfa"],
      "author": {
        "name": "Alice Chen",
        "key_prefix": "ed25519:AAABBB"
      },
      "active_installs": 147,
      "compatibility_score": 0.94,
      "rollback_rate": 0.02,
      "pricing": { "model": "free" },
      "auto_review": {
        "schema_valid": true,
        "signed": true,
        "ncv_self_check": true
      }
    }
  ]
}
```

---

### GET /capabilities/:id

Retrieve full detail and metadata for a capability.

**Example Request**

```
GET /api/v1/capabilities/auth-totp-enforcement
```

**Example Response**

```json
{
  "id": "auth-totp-enforcement",
  "name": "TOTP Two-Factor Authentication",
  "version": "1.0.0",
  "tags": ["auth", "security", "mfa"],
  "created": "2026-04-19T08:00:00Z",
  "author": {
    "name": "Alice Chen",
    "key": "ed25519:AAABBBCCC..."
  },
  "env_hint": {
    "runtime": "node>=18",
    "frameworks": ["next>=14", "prisma>=5"]
  },
  "requires": {
    "manifest_version": ">=2.0.0",
    "surfaces": ["entities", "logic_domains"],
    "anchors": {
      "hooks": ["auth.password_login.post_verify"],
      "slots": ["settings.security_section"],
      "entities": ["User"]
    }
  },
  "conflicts": [
    {
      "id": "sso-only-auth",
      "reason": "Both inject into auth.password_login.post_verify"
    }
  ],
  "metadata": {
    "pricing": { "model": "free" },
    "preview_url": "https://example.com/totp-demo",
    "screenshots": ["https://example.com/screenshots/totp-settings.png"],
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
      "signed": true,
      "sandbox_test_result": {
        "probe_pass_rate": 1.0,
        "contract_pass_rate": 0.98,
        "ncv_violations": 0
      }
    }
  }
}
```

---

### GET /capabilities/:id/download

Download the raw `.scsp` file. For free capabilities, no authorization is required. For paid capabilities, a valid Bearer token is required.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | Conditional | `Bearer {access_token}` — required for paid capabilities |

**Success Response**: `200 OK` with `Content-Type: text/plain; charset=utf-8` and the `.scsp` file body.

**Error Responses**

```json
// 402 Payment Required — returned for paid capabilities without a valid token
{
  "error": "payment_required",
  "capability_id": "auth-totp-enforcement-pro",
  "pricing": {
    "model": "one-time",
    "amount_usd": 9.99
  },
  "payment_url": "https://registry.example.com/buy/auth-totp-enforcement-pro"
}
```

---

### POST /capabilities

Publish a new capability. Requires a valid `Authorization` header. The registry validates the signature against the author key declared in the capability's frontmatter.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | `Bearer {author_token}` |
| `Content-Type` | Yes | `text/plain` |

**Request Body**: The raw `.scsp` file content.

**Validation performed by the registry before accepting**:
1. Frontmatter is schema-valid (all required fields present, types correct)
2. `author.key` in frontmatter matches the authenticated user
3. `signature` is valid over the file content
4. `id` does not already exist (use `PATCH /capabilities/:id` for updates — V0.2+)
5. NCV self-check: the declared NCV rules are internally consistent
6. Dependency audit: declared `external_deps` exist in known package registries

**Success Response**: `201 Created`

```json
{
  "id": "auth-totp-enforcement",
  "version": "1.0.0",
  "registry_url": "https://registry.example.com/api/v1/capabilities/auth-totp-enforcement",
  "auto_review": {
    "schema_valid": true,
    "signed": true,
    "ncv_self_check": true,
    "dependency_audit": true
  }
}
```

**Error Response**: `422 Unprocessable Entity`

```json
{
  "error": "validation_failed",
  "details": [
    {
      "field": "requires.anchors.hooks[0]",
      "message": "Anchor ID 'auth.old_login.verify' does not follow naming convention {domain}.{entity_or_flow}.{hook_point}"
    }
  ]
}
```

---

### POST /capabilities/:id/report

Report the result of an install attempt. Used by executor agents to contribute to community quality signals. Reports are pseudonymous — no identifying host information is required.

**Request Body**

```json
{
  "capability_id": "auth-totp-enforcement",
  "capability_version": "1.0.0",
  "result": "success",
  "host": {
    "manifest_version": "2.4.1",
    "surfaces": ["entities", "logic_domains", "ui_areas"],
    "frameworks": ["next@14.2.0", "prisma@5.1.0"]
  },
  "phases": {
    "probe_pass_rate": 1.0,
    "dry_run_completed": true,
    "apply_completed": true,
    "contracts_pass_rate": 1.0,
    "rollback_triggered": false
  },
  "reported_at": "2026-04-19T09:00:00Z"
}
```

`result` must be one of: `"success"`, `"fail"`, `"rollback"`, `"cancelled"`.

**Success Response**: `204 No Content`

---

### DELETE /capabilities/:id

Revoke a capability. Only the author (verified via `Authorization` token) may revoke their capability. Revocation sets `revoked: true` in the stored frontmatter; the file is not deleted and remains fetchable by installs that have already downloaded it. New fetch requests return `410 Gone`.

**Response**: `200 OK`

```json
{
  "id": "auth-totp-enforcement",
  "revoked": true,
  "revoked_at": "2026-04-19T12:00:00Z"
}
```

---

### GET /capabilities/:id/preview

Retrieve preview metadata for display in UIs — screenshots, demo URL, and a short description.

**Example Response**

```json
{
  "id": "auth-totp-enforcement",
  "name": "TOTP Two-Factor Authentication",
  "short_description": "Adds TOTP-based 2FA to any SCSP-compatible app with one click.",
  "preview_url": "https://example.com/totp-demo",
  "screenshots": [
    {
      "url": "https://example.com/screenshots/totp-settings.png",
      "alt": "TOTP enrollment settings panel"
    },
    {
      "url": "https://example.com/screenshots/totp-verify.png",
      "alt": "TOTP verification prompt at login"
    }
  ]
}
```

---

### GET /authors/:key

Retrieve an author profile and reputation summary.

**Path Parameter**: `:key` is the full ed25519 public key (hex-encoded).

**Example Request**

```
GET /api/v1/authors/ed25519:AAABBBCCC...
```

**Example Response**

```json
{
  "key": "ed25519:AAABBBCCC...",
  "name": "Alice Chen",
  "verified": false,
  "joined": "2026-03-01T00:00:00Z",
  "capabilities": {
    "total": 4,
    "active": 4,
    "revoked": 0
  },
  "reputation": {
    "score": 0.91,
    "active_installs_total": 614,
    "rollback_rate_avg": 0.025,
    "fork_count_total": 18,
    "compatibility_score_avg": 0.93
  }
}
```

`verified` is a registry-layer display property indicating the registry has verified the author's identity through an out-of-band process. It is not a protocol-layer field.

---

## 3. Version Snapshots

Version snapshots let users find a curated combination of a base application with a tested set of capabilities installed. The primary UX is "I want an app that already has TOTP and dark mode — give me the best version."

### GET /snapshots

Find snapshots that include specific capabilities.

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `base` | string | Base application ID (e.g., `my-saas-app`) |
| `includes` | string | Comma-separated capability IDs that must be included |
| `limit` | integer | Max results (default: 10) |

**Example Request**

```
GET /api/v1/snapshots?base=my-saas-app&includes=auth-totp-enforcement,dark-theme-sidebar
```

**Example Response**

```json
{
  "total": 2,
  "results": [
    {
      "id": "my-saas-app-v2.5-totp-dark",
      "base": "my-saas-app@2.4.1",
      "patches_included": [
        "auth-totp-enforcement@1.0.0",
        "dark-theme-sidebar@1.2.0"
      ],
      "active_installs": 847,
      "preview_url": "https://demo.my-saas-app.com/preview/totp-dark",
      "compatibility_score": 0.96
    }
  ]
}
```

---

### GET /snapshots/:id

Retrieve full detail for a version snapshot, including lineage.

**Example Response**

```json
{
  "type": "version_snapshot",
  "id": "my-saas-app-v2.5-totp-dark",
  "base": "my-saas-app@2.4.1",
  "patches_included": [
    "auth-totp-enforcement@1.0.0",
    "dark-theme-sidebar@1.2.0"
  ],
  "lineage": {
    "origin": "my-saas-app@2.0.0",
    "parent": "my-saas-app-v2.4-totp",
    "patches_applied": ["auth-totp-enforcement@1.0.0"],
    "divergence_point": "2026-04-10T00:00:00Z"
  },
  "devguide_version": "2026-04-19",
  "active_installs": 847,
  "preview_url": "https://demo.my-saas-app.com/preview/totp-dark"
}
```

---

## 4. Semantic Search

Agent-native search endpoint. Accepts a natural-language query and optionally a context object describing the host application's current state. Returns ranked capabilities and snapshots.

### POST /search

**Request Body**

```json
{
  "query": "I want two-factor authentication and a dark theme sidebar",
  "base": "my-saas-app",
  "context": {
    "manifest_version": "2.4.1",
    "surfaces": ["entities", "ui_areas", "logic_domains"],
    "installed_capabilities": ["dark-theme-sidebar@1.2.0"],
    "frameworks": ["next@14.2.0", "prisma@5.1.0"]
  },
  "limit": 5
}
```

**Response**

```json
{
  "query_interpretation": {
    "intent_tags": ["auth", "mfa", "ui", "theme"],
    "surfaces_inferred": ["logic_domains", "ui_areas"],
    "anchors_inferred": ["auth.login.post_verify", "nav.sidebar"]
  },
  "capabilities": [
    {
      "id": "auth-totp-enforcement",
      "name": "TOTP Two-Factor Authentication",
      "rank_score": 0.97,
      "rank_reason": "Exact match for 2FA intent; compatible with declared frameworks; 147 active installs",
      "already_installed": false,
      "compatibility_score": 0.94
    }
  ],
  "snapshots": [
    {
      "id": "my-saas-app-v2.5-totp-dark",
      "name": "TOTP + Dark Theme bundle",
      "rank_score": 0.99,
      "rank_reason": "Pre-validated snapshot includes both requested capabilities"
    }
  ]
}
```

The registry may implement semantic search using any embedding or ranking strategy. The request/response schema is part of the protocol; the ranking algorithm is not.

---

## 5. Pricing and Access Control

### Pricing Models

The `pricing` object in `metadata.json` supports three models:

| Model | Description |
|---|---|
| `free` | No payment required; `download` endpoint is open |
| `one-time` | Single purchase grants permanent access token |
| `subscription` | Monthly or annual subscription; token expires and must be refreshed |

### Authorization Flow for Paid Capabilities

1. Executor agent calls `GET /capabilities/:id/download` without token.
2. Registry returns `402 Payment Required` with `payment_url`.
3. User completes payment in browser at `payment_url`.
4. Registry issues `access_token` (scoped to the capability ID).
5. Executor retries `GET /capabilities/:id/download` with `Authorization: Bearer {access_token}`.
6. Registry validates token and returns the `.scsp` file.

Access tokens are stored by the executor agent and reused for re-downloads and health checks. Subscription tokens include an `expires_at` field; the executor must refresh them before expiry.

### Token Scoping

Tokens are scoped to a `(author_key, capability_id)` pair. A token purchased for `auth-totp-enforcement` does not grant access to forks or successor capabilities.

---

## 6. Quality Signals

Quality signals help executor agents and users make informed decisions about which capabilities to install. They are divided into automated signals (computed by the registry) and community signals (aggregated from install reports).

### Automated Signals (auto_review)

```json
{
  "auto_review": {
    "schema_valid": true,
    "ncv_self_check": true,
    "dependency_audit": true,
    "signed": true,
    "sandbox_test_result": {
      "probe_pass_rate": 1.0,
      "contract_pass_rate": 0.98,
      "ncv_violations": 0
    }
  }
}
```

| Field | Description |
|---|---|
| `schema_valid` | Frontmatter validates against the SCSP JSON Schema for declared `scsp` version |
| `ncv_self_check` | NCV rules are internally consistent (no contradictory constraints) |
| `dependency_audit` | All `external_deps` exist in known public package registries at declared version ranges |
| `signed` | `signature` verifies against `author.key` using ed25519 |
| `sandbox_test_result.probe_pass_rate` | Fraction of probes that passed in sandbox environment (if registry runs sandbox testing) |
| `sandbox_test_result.contract_pass_rate` | Fraction of contracts that passed in sandbox environment |
| `sandbox_test_result.ncv_violations` | Number of NCV violations detected in sandbox execution |

### Community Signals

Community signals are derived from submitted install reports:

| Signal | Computation |
|---|---|
| `install_success_rate` | `success_count / total_reports` |
| `rollback_rate` | `rollback_count / total_reports` |
| `probe_pass_rate` | Average `phases.probe_pass_rate` across all reports |
| `contract_pass_rate` | Average `phases.contracts_pass_rate` across all reports |
| `compatibility_score` | Weighted average of probe pass rate and contract pass rate, weighted by sample recency |

Registries should display `compatibility_score` prominently, as it is the most useful single signal for whether a capability will install successfully on a given host.

---

## 7. Embeddable Community UI (Roadmap)

A future capability of the registry ecosystem is an embeddable UI that developers can embed directly in their application's admin panel or settings page. This allows end users to browse, install, and manage capabilities without leaving the host application.

### Planned Delivery

- **Web Component**: A `<scsp-marketplace>` custom element that renders a capability browser, search UI, and one-click install trigger.
- **iframe embed**: A hosted iframe pointing at `https://registry.example.com/embed?base={manifest-id}` for applications that prefer sandboxed embeds.
- **SDK**: A JavaScript SDK (`@scsp/registry-sdk`) that wraps the Registry API and provides typed methods for search, fetch, report, and install triggering.

### Design Principle

The Registry HTTP API defined in this document is the stable contract. The embeddable UI and SDK are convenience layers that call the same API. Developers who want full control can call the API directly; the UI is not required.

The protocol layer has no opinion on how capabilities are discovered or presented to users. The embeddable UI is a registry-layer feature.

---

## 8. Git-Based Registry — V0.1 (Active)

The V0.1 registry is fully functional and uses a plain git repository as its backing store. No server infrastructure is required to run a registry — a public git repository is sufficient.

### Directory Structure

```
registry/
├── capabilities/
│   └── {capability-id}/
│       ├── {capability-id}.scsp       # The signed capability package
│       └── metadata.json              # Registry metadata (installs, reviews, pricing)
├── index.json                         # Flat capability index for search
└── AUTHORS.json                       # Author registry
```

### index.json Format

```json
{
  "scsp_registry": "0.1",
  "updated_at": "2026-04-19T08:00:00Z",
  "capabilities": [
    {
      "id": "auth-totp-enforcement",
      "name": "TOTP Two-Factor Authentication",
      "version": "1.0.0",
      "tags": ["auth", "security", "mfa"],
      "surfaces": ["entities", "logic_domains"],
      "anchors": {
        "hooks": ["auth.password_login.post_verify"],
        "slots": ["settings.security_section"],
        "entities": ["User"]
      },
      "author_key": "ed25519:AAABBBCCC...",
      "active_installs": 147,
      "compatibility_score": 0.94,
      "pricing_model": "free",
      "signed": true
    }
  ]
}
```

### AUTHORS.json Format

```json
{
  "authors": [
    {
      "key": "ed25519:AAABBBCCC...",
      "name": "Alice Chen",
      "github": "alicechen",
      "verified": false,
      "capabilities": ["auth-totp-enforcement", "audit-log-export"]
    }
  ]
}
```

### Publish Flow (PR-Based)

1. **Fork** the registry repository.
2. Create directory `capabilities/{your-capability-id}/`.
3. Add `{your-capability-id}.scsp` (signed using `scsp publish --dry-run` to validate locally first).
4. Add `metadata.json` with at minimum: `id`, `name`, `version`, `pricing`, `auto_review: {}` (the bot fills `auto_review` fields).
5. Update `index.json` with a new entry for your capability.
6. Update `AUTHORS.json` if you are a new author.
7. Open a pull request against the registry's `main` branch.
8. The **registry bot** automatically:
   - Validates frontmatter schema
   - Verifies signature against the declared `author.key`
   - Runs NCV self-check
   - Runs dependency audit
   - Populates `auto_review` fields in `metadata.json`
   - Posts a review comment with results
9. If all checks pass, the bot auto-merges. If any check fails, the PR is left open with the failure details as a comment.

### Fetch Flow

```bash
# Fetch using the SCSP executor CLI
scsp fetch auth-totp-enforcement --registry https://github.com/example/scsp-registry

# Equivalent manual fetch via raw git URL
curl https://raw.githubusercontent.com/example/scsp-registry/main/capabilities/auth-totp-enforcement/auth-totp-enforcement.scsp
```

The executor CLI reads `index.json` to resolve the capability path, validates the signature locally, and stores the file in a local cache before passing it to the install pipeline.

### Running a Private Registry Node

Any git repository (public or private) with the above directory structure is a valid SCSP registry node. For internal enterprise use:

1. Create a private GitHub/GitLab repository with the directory structure.
2. Grant executor agents read access via a personal access token.
3. Optionally disable the auto-merge bot and require manual review of all PRs.
4. Point executor agents with `--registry {your-private-repo-url}`.

Private registries may omit the bot automation. Manual PR review is a valid alternative for small teams.

---

*SCSP Registry API Draft — V0.2 target specification. V0.1 git-based registry is active. Last updated 2026-04-19.*
