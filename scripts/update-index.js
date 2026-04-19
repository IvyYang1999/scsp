#!/usr/bin/env node
/**
 * scripts/update-index.js
 *
 * Scans registry/capabilities/ and regenerates registry/index.json.
 *
 * Usage:
 *   node scripts/update-index.js
 *   node scripts/update-index.js --registry-dir /path/to/registry
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ── Resolve paths ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let registryDir = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--registry-dir' && args[i + 1]) {
    registryDir = path.resolve(args[i + 1]);
    i++;
  }
}

if (!registryDir) {
  // Default: sibling registry/ directory next to this script's project root
  const projectRoot = path.resolve(__dirname, '..');
  registryDir = path.join(projectRoot, 'registry');
}

const capabilitiesDir = path.join(registryDir, 'capabilities');
const indexPath       = path.join(registryDir, 'index.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from a .scsp file.
 * Returns { data, content } where data is the parsed YAML object and
 * content is the markdown body after the closing `---`.
 */
function parseFrontmatter(fileContent) {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('No valid YAML frontmatter found');
  }
  const data    = yaml.load(match[1]);
  const content = match[2];
  return { data, content };
}

/**
 * Extract a plain-text description from the ## Intent section.
 * Returns the first non-empty, non-heading paragraph line found under
 * "## Intent" (or "## Motivation" as fallback), trimmed to 200 chars.
 */
function extractDescription(content) {
  // Split into lines and find the ## Intent heading
  const lines = content.split(/\r?\n/);
  let inIntent = false;

  for (const line of lines) {
    // Detect the intent/motivation heading
    if (/^##\s+(Intent|Motivation)/i.test(line)) {
      inIntent = true;
      continue;
    }

    // Stop at the next ## heading
    if (inIntent && /^##\s+/.test(line)) {
      break;
    }

    if (inIntent) {
      // Skip blank lines, bold markers, code fences, and sub-headings
      const stripped = line
        .replace(/^\*\*.*?\*\*\.?\s*/, '')  // strip **Bold.** prefix
        .replace(/^\s*[-*#`>]+\s*/, '')     // strip list/code/quote markers
        .trim();

      if (stripped.length > 10) {
        return stripped.length > 200 ? stripped.slice(0, 197) + '...' : stripped;
      }
    }
  }

  return '';
}

/**
 * Flatten the `surfaces` field from the .scsp frontmatter.
 * The field can be either an array of strings or an object whose keys
 * are surface names.
 */
function extractSurfaces(requires) {
  if (!requires || !requires.surfaces) return [];
  const s = requires.surfaces;
  if (Array.isArray(s)) return s;
  if (typeof s === 'object') return Object.keys(s);
  return [];
}

/**
 * Extract the primary layer from the first component entry.
 */
function extractLayer(components) {
  if (!Array.isArray(components) || components.length === 0) return null;
  return components[0].layer || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!fs.existsSync(capabilitiesDir)) {
  console.error(`Capabilities directory not found: ${capabilitiesDir}`);
  process.exit(1);
}

const capabilityDirs = fs
  .readdirSync(capabilitiesDir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

if (capabilityDirs.length === 0) {
  console.warn('No capability directories found. Writing empty index.');
}

// Load existing index so we can preserve any manually-set fields not produced
// by this script (e.g. signed: true set by a bot).
let existingIndex = { capabilities: [] };
if (fs.existsSync(indexPath)) {
  try {
    existingIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (err) {
    console.warn(`Warning: could not parse existing index.json — starting fresh. (${err.message})`);
  }
}

const existingById = {};
for (const cap of (existingIndex.capabilities || [])) {
  if (cap.id) existingById[cap.id] = cap;
}

const capabilities = [];
const errors       = [];

for (const capId of capabilityDirs) {
  const capDir   = path.join(capabilitiesDir, capId);
  const scspFile = path.join(capDir, `${capId}.scsp`);
  const metaFile = path.join(capDir, 'metadata.json');

  // ── Read .scsp ─────────────────────────────────────────────────────────────
  if (!fs.existsSync(scspFile)) {
    console.warn(`  [skip] ${capId}: no matching .scsp file at ${scspFile}`);
    continue;
  }

  let frontmatter, content;
  try {
    const raw = fs.readFileSync(scspFile, 'utf8');
    ({ data: frontmatter, content } = parseFrontmatter(raw));
  } catch (err) {
    errors.push(`${capId}: failed to parse frontmatter — ${err.message}`);
    console.error(`  [error] ${capId}: ${err.message}`);
    continue;
  }

  // ── Read metadata.json ─────────────────────────────────────────────────────
  let meta = {};
  if (fs.existsSync(metaFile)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (err) {
      console.warn(`  [warn] ${capId}: could not parse metadata.json — ${err.message}`);
    }
  } else {
    console.warn(`  [warn] ${capId}: no metadata.json found`);
  }

  // ── Build index entry ──────────────────────────────────────────────────────
  const existing    = existingById[capId] || {};
  const description = extractDescription(content);
  const surfaces    = extractSurfaces(frontmatter.requires);
  const layer       = extractLayer(frontmatter.components);

  // Anchors: collapse requires.anchors structure
  const anchors = frontmatter.requires && frontmatter.requires.anchors
    ? frontmatter.requires.anchors
    : undefined;

  const entry = {
    id:                  frontmatter.id            || capId,
    name:                frontmatter.name          || capId,
    version:             frontmatter.version       || '0.0.0',
    tags:                frontmatter.tags          || [],
    layer:               layer                     || existing.layer    || null,
    description:         description               || existing.description || '',
    surfaces,
    ...(anchors ? { anchors } : {}),
    author_name:         frontmatter.author && frontmatter.author.name
                           ? frontmatter.author.name
                           : (existing.author_name || null),
    author_key:          frontmatter.author && frontmatter.author.key
                           ? frontmatter.author.key
                           : (existing.author_key || null),
    active_installs:     meta.active_installs      ?? existing.active_installs     ?? 0,
    installs:            meta.installs             ?? existing.installs            ?? 0,
    fork_count:          meta.fork_count           ?? existing.fork_count          ?? 0,
    compatibility_score: meta.compatibility_score  ?? existing.compatibility_score ?? 1.0,
    pricing_model:       meta.pricing && meta.pricing.model
                           ? meta.pricing.model
                           : (existing.pricing_model || 'free'),
    signed:              frontmatter.signature
                           ? true
                           : (existing.signed || false),
    revoked:             frontmatter.revoked       || false,
  };

  capabilities.push(entry);
  console.log(`  [ok] ${entry.id}  v${entry.version}`);
}

// ── Write index.json ──────────────────────────────────────────────────────────

const index = {
  scsp_registry: '0.1',
  updated_at:    new Date().toISOString(),
  capabilities,
};

fs.mkdirSync(path.dirname(indexPath), { recursive: true });
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');

console.log(`\nWrote ${capabilities.length} capabilities to ${indexPath}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) encountered:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
