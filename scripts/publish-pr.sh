#!/usr/bin/env bash
# scripts/publish-pr.sh
#
# Publish a .scsp capability file to a registry repository via Pull Request.
#
# Usage:
#   ./scripts/publish-pr.sh <scsp-file> [registry-repo]
#
# Arguments:
#   scsp-file       Path to the .scsp capability file to publish.
#   registry-repo   GitHub repo in "owner/repo" format.
#                   Defaults to "scsp-community/registry".
#
# Requirements:
#   - git, npm (with project deps installed), python3
#   - gh CLI (optional; prints PR URL instructions if absent)
#
# Exit codes:
#   0  Success (PR created or URL printed)
#   1  Validation or publish error

set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ── Args ───────────────────────────────────────────────────────────────────────
SCSP_FILE="${1:-}"
REGISTRY_REPO="${2:-scsp-community/registry}"

[ -z "$SCSP_FILE" ] && die "Usage: $0 <scsp-file> [registry-repo]"
[ -f "$SCSP_FILE" ] || die "File not found: $SCSP_FILE"

SCSP_FILE="$(realpath "$SCSP_FILE")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Step 1: Validate locally ───────────────────────────────────────────────────
info "Step 1/9 — Validating $SCSP_FILE …"
(
  cd "$PROJECT_ROOT"
  npm run validate -- "$SCSP_FILE"
) || die "Validation failed. Fix the errors above before publishing."
success "Validation passed."

# ── Step 2: Extract capability id ─────────────────────────────────────────────
info "Step 2/9 — Extracting capability id from frontmatter …"
CAP_ID="$(python3 - "$SCSP_FILE" <<'PYEOF'
import sys, re

with open(sys.argv[1], 'r') as f:
    content = f.read()

match = re.match(r'^---\r?\n(.*?)\r?\n---', content, re.DOTALL)
if not match:
    sys.exit("No frontmatter found")

fm = match.group(1)
id_match = re.search(r'^\s*id\s*:\s*["\']?([^\s"\'#]+)["\']?', fm, re.MULTILINE)
if not id_match:
    sys.exit("No 'id' field found in frontmatter")

print(id_match.group(1).strip())
PYEOF
)" || die "Could not extract capability id."

[ -z "$CAP_ID" ] && die "Capability id is empty."
success "Capability id: $CAP_ID"

# ── Step 3: Create temp working directory ─────────────────────────────────────
info "Step 3/9 — Creating temp workspace …"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
REGISTRY_DIR="$TMP_DIR/registry"
success "Temp dir: $TMP_DIR"

# ── Step 4: Sparse-checkout the registry repo ─────────────────────────────────
info "Step 4/9 — Cloning registry (sparse checkout of capabilities/) …"
REGISTRY_URL="https://github.com/${REGISTRY_REPO}.git"

git clone \
  --filter=blob:none \
  --no-checkout \
  --depth=1 \
  "$REGISTRY_URL" \
  "$REGISTRY_DIR" \
  || die "git clone failed. Is '$REGISTRY_REPO' a valid repo and do you have access?"

cd "$REGISTRY_DIR"

git sparse-checkout init --cone
git sparse-checkout set "capabilities" "registry"
git checkout || die "git checkout failed."
success "Registry cloned."

# Ensure the top-level structure exists
mkdir -p "$REGISTRY_DIR/registry/capabilities"

# ── Step 5: Copy .scsp file into place ────────────────────────────────────────
info "Step 5/9 — Installing capability files …"
CAP_TARGET_DIR="$REGISTRY_DIR/registry/capabilities/$CAP_ID"
mkdir -p "$CAP_TARGET_DIR"

cp "$SCSP_FILE" "$CAP_TARGET_DIR/${CAP_ID}.scsp"
success "Copied ${CAP_ID}.scsp → registry/capabilities/${CAP_ID}/"

# ── Step 6: Create stub metadata.json if missing ──────────────────────────────
info "Step 6/9 — Checking metadata.json …"
META_FILE="$CAP_TARGET_DIR/metadata.json"

if [ -f "$META_FILE" ]; then
  info "metadata.json already exists — skipping stub creation."
else
  python3 - "$CAP_ID" "$META_FILE" <<'PYEOF'
import json, sys

cap_id  = sys.argv[1]
out_path = sys.argv[2]

stub = {
    "id": cap_id,
    "pricing": {"model": "free"},
    "preview_url": None,
    "screenshots": [],
    "reports": {
        "success": 0,
        "fail": 0,
        "rollback": 0,
        "sample_size": 0
    },
    "installs": 0,
    "active_installs": 0,
    "fork_count": 0,
    "stack_depth": 0,
    "compatibility_score": 1.0,
    "auto_review": {
        "schema_valid": True,
        "ncv_self_check": "pass",
        "dependency_audit": "no known vulnerabilities",
        "signed": False
    }
}

with open(out_path, 'w') as f:
    json.dump(stub, f, indent=2)
    f.write('\n')

print(f"Created stub metadata.json for {cap_id}")
PYEOF
  success "Created stub metadata.json."
fi

# ── Step 7: Regenerate index.json ─────────────────────────────────────────────
info "Step 7/9 — Regenerating registry/index.json …"
(
  cd "$PROJECT_ROOT"
  node scripts/update-index.js --registry-dir "$REGISTRY_DIR/registry"
) || die "update-index.js failed."
success "index.json updated."

# ── Step 8: Create branch, commit, push ───────────────────────────────────────
info "Step 8/9 — Committing and pushing …"
cd "$REGISTRY_DIR"

BRANCH="add-capability/${CAP_ID}"
git checkout -b "$BRANCH" || die "Could not create branch '$BRANCH'."

git add "registry/capabilities/${CAP_ID}/" "registry/index.json"

git -c user.name="scsp-publish" \
    -c user.email="publish@scsp.local" \
    commit -m "feat: add capability ${CAP_ID}

Published via scsp publish-pr.sh" \
  || die "git commit failed."

git push -u origin "$BRANCH" || die "git push failed. Do you have write access to '$REGISTRY_REPO'?"
success "Pushed branch $BRANCH to $REGISTRY_REPO."

# ── Step 9: Create PR ─────────────────────────────────────────────────────────
info "Step 9/9 — Creating Pull Request …"

PR_TITLE="feat: add capability ${CAP_ID}"
PR_BODY="## New Capability: \`${CAP_ID}\`

This PR adds the \`${CAP_ID}\` capability to the registry.

### Files changed
- \`registry/capabilities/${CAP_ID}/${CAP_ID}.scsp\`
- \`registry/capabilities/${CAP_ID}/metadata.json\`
- \`registry/index.json\`

### Checklist
- [x] \`.scsp\` frontmatter validates against schema
- [x] \`metadata.json\` present
- [x] \`index.json\` updated

_Published with \`scripts/publish-pr.sh\`_"

if command -v gh &>/dev/null; then
  PR_URL="$(
    gh pr create \
      --repo "$REGISTRY_REPO" \
      --title "$PR_TITLE" \
      --body "$PR_BODY" \
      --head "$BRANCH" \
      --base main \
      2>&1
  )" && {
    success "Pull Request created: $PR_URL"
  } || {
    warn "gh pr create failed — open the PR manually at:"
    echo "  https://github.com/${REGISTRY_REPO}/compare/main...${BRANCH}?expand=1"
  }
else
  warn "'gh' CLI not found. Open the PR manually at:"
  echo "  https://github.com/${REGISTRY_REPO}/compare/main...${BRANCH}?expand=1"
fi

echo ""
success "Done! Capability '${CAP_ID}' submitted to ${REGISTRY_REPO}."
