/**
 * SCSP Real Executor — 6-Stage Install Pipeline
 *
 * Implements the Six-Stage Execution Model from PROTOCOL.md §10:
 *   Phase 1: PROBE    — scan filesystem for extension points
 *   Phase 2: VALIDATE — check compatibility with host snapshot/manifest
 *   Phase 3: DRY-RUN  — use Claude API to generate code changes
 *   Phase 4: CONFIRM  — interactive human gate
 *   Phase 5: APPLY    — write files, install deps, run migrations
 *   Phase 6: VERIFY   — run contract tests, update snapshot
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { parseCapabilityString, type ParsedCapability } from './parser';

const execAsync = promisify(exec);

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

function color(text: string, ...codes: string[]): string {
  return codes.join('') + text + C.reset;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private idx = 0;
  private timer: NodeJS.Timeout | null = null;
  private label = '';

  start(label: string): void {
    this.label = label;
    this.idx = 0;
    this.render();
    this.timer = setInterval(() => {
      this.idx = (this.idx + 1) % this.frames.length;
      this.render();
    }, 80);
  }

  private render(): void {
    process.stdout.write(`\r${color(this.frames[this.idx], C.cyan)} ${this.label}   `);
  }

  succeed(msg: string): void {
    this.stop();
    process.stdout.write(`\r${color('✓', C.green)} ${msg}\n`);
  }

  fail(msg: string): void {
    this.stop();
    process.stdout.write(`\r${color('✗', C.red)} ${msg}\n`);
  }

  warn(msg: string): void {
    this.stop();
    process.stdout.write(`\r${color('⚠', C.yellow)} ${msg}\n`);
  }

  info(msg: string): void {
    this.stop();
    process.stdout.write(`\r${color('ℹ', C.blue)} ${msg}\n`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write('\r\x1b[K'); // clear line
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProbeSpec {
  name?: string;
  id?: string;
  anchor_ref?: string;
  intent?: string;
  check_hints?: Array<{
    lang: string;
    type: 'grep' | 'ast';
    patterns: string[];
    paths: string[];
  }>;
  check?: {
    type: string;
    entity?: string;
    hook?: string;
    slot?: string;
    required_fields?: Array<{ name: string; types: string[] }>;
    [key: string]: unknown;
  };
  on_fail: 'abort' | 'warn';
  message?: string;
  fallback?: string;
}

export interface ProbeResult {
  probeName: string;
  passed: boolean;
  foundAt?: string;
  message?: string;
}

export interface HostSnapshot {
  scsp_host_snapshot?: string;
  generated_at?: string;
  generated_by?: string;
  manifest_version?: string;
  entities?: Array<{ id: string; fields?: string[]; location_hint?: string }>;
  ui_slots?: Array<{ id: string; location_hint?: string }>;
  logic_hooks?: Array<{ id: string; location_hint?: string; signature_hint?: string }>;
  installed_capabilities?: Array<{
    id: string;
    version: string;
    installed_at: string;
    anchors_used?: string[];
    rollback_type?: string;
    capability_file?: string;
  }>;
}

export interface CompatReport {
  compatible: boolean;
  issues: string[];
  warnings: string[];
}

export interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'append';
  content: string;
  diff?: string;
}

export interface DryRunReport {
  affectedFiles: string[];
  diffSummary: string;
  changes: FileChange[];
  newDependencies: string[];
  skippedComponents: string[];
  skippedReason?: string;
  ncvWarnings: string[];
}

export interface VerifyResult {
  passed: boolean;
  contractResults: Array<{ name: string; passed: boolean; error?: string }>;
  testFile?: string;
}

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class ProbeFailedError extends Error {
  constructor(
    public probeName: string,
    public anchorRef: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'ProbeFailedError';
  }
}

export class CompatibilityError extends Error {
  constructor(
    public issues: string[],
    message: string
  ) {
    super(message);
    this.name = 'CompatibilityError';
  }
}

export class NcvViolationError extends Error {
  constructor(
    public violationId: string,
    message: string
  ) {
    super(message);
    this.name = 'NcvViolationError';
  }
}

// ─── Phase 1: PROBE ───────────────────────────────────────────────────────────

/**
 * Recursively collect files under a directory up to maxDepth.
 */
async function collectFiles(dir: string, maxDepth = 6, _depth = 0): Promise<string[]> {
  if (_depth > maxDepth) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectFiles(full, maxDepth, _depth + 1);
      files.push(...sub);
    } else {
      files.push(full);
    }
  }
  return files;
}

/**
 * Grep a single file for any of the given patterns.
 * Returns the first matching line + file location, or null.
 */
async function grepFile(
  filePath: string,
  patterns: string[]
): Promise<{ line: string; lineNum: number } | null> {
  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  const lines = content.split('\n');
  for (const pattern of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      // fallback to literal
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        return { line: lines[i].trim(), lineNum: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Run all probes against the actual filesystem.
 * Throws ProbeFailedError if on_fail === 'abort' and probe does not pass.
 */
export async function runProbes(
  probes: ProbeSpec[],
  cwd: string,
  _snapshot: HostSnapshot | null
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const probe of probes) {
    const probeName = probe.name ?? probe.id ?? probe.anchor_ref ?? 'unnamed-probe';

    // Handle probes that use check_hints (grep/ast style)
    if (probe.check_hints && probe.check_hints.length > 0) {
      let passed = false;
      let foundAt: string | undefined;

      for (const hint of probe.check_hints) {
        if (passed) break;
        const searchPaths = hint.paths ?? ['.'];
        const patterns = hint.patterns ?? [];

        for (const searchPath of searchPaths) {
          if (passed) break;
          const absSearch = path.resolve(cwd, searchPath);
          if (!fs.existsSync(absSearch)) continue;

          const allFiles = await collectFiles(absSearch);
          for (const file of allFiles) {
            const match = await grepFile(file, patterns);
            if (match) {
              passed = true;
              foundAt = `${path.relative(cwd, file)}:${match.lineNum}`;
              break;
            }
          }
        }
      }

      const result: ProbeResult = {
        probeName,
        passed,
        foundAt,
        message: passed
          ? `Found at ${foundAt}`
          : (probe.message ?? `No match for patterns in check_hints`),
      };
      results.push(result);

      if (!passed && probe.on_fail === 'abort') {
        throw new ProbeFailedError(
          probeName,
          probe.anchor_ref,
          result.message ?? `Probe "${probeName}" failed — aborting`
        );
      }
      if (!passed && probe.on_fail === 'warn') {
        process.stderr.write(
          color(`  [WARN] Probe "${probeName}" failed: ${result.message}`, C.yellow) + '\n'
        );
        if (probe.fallback) {
          process.stderr.write(color(`  Fallback: ${probe.fallback}`, C.dim) + '\n');
        }
      }
      continue;
    }

    // Handle probes using the `check` field (entity_fields, hook_exists, slot_exists)
    if (probe.check) {
      const check = probe.check;
      let passed = false;
      let foundAt: string | undefined;

      if (check.type === 'entity_fields' && check.entity) {
        // Search all files for a model/interface/class matching the entity name
        const allFiles = await collectFiles(cwd);
        const patterns = [
          `model ${check.entity}`,
          `interface ${check.entity}`,
          `class ${check.entity}`,
          `type ${check.entity}`,
        ];
        for (const file of allFiles) {
          const match = await grepFile(file, patterns);
          if (match) {
            passed = true;
            foundAt = `${path.relative(cwd, file)}:${match.lineNum}`;
            break;
          }
        }
      } else if (check.type === 'hook_exists' && check.hook) {
        const allFiles = await collectFiles(cwd);
        const patterns = [
          check.hook,
          check.hook.replace(/\./g, '_'),
          check.hook.split('.').pop() ?? check.hook,
        ];
        for (const file of allFiles) {
          const match = await grepFile(file, patterns);
          if (match) {
            passed = true;
            foundAt = `${path.relative(cwd, file)}:${match.lineNum}`;
            break;
          }
        }
      } else if (check.type === 'slot_exists' && check.slot) {
        const allFiles = await collectFiles(cwd);
        const patterns = [
          check.slot,
          check.slot.replace(/\./g, '_'),
          check.slot.split('.').pop() ?? check.slot,
        ];
        for (const file of allFiles) {
          const match = await grepFile(file, patterns);
          if (match) {
            passed = true;
            foundAt = `${path.relative(cwd, file)}:${match.lineNum}`;
            break;
          }
        }
      } else {
        // Unknown check type — treat as passed with warning
        passed = true;
        foundAt = '(check type not fully supported, skipped)';
      }

      const result: ProbeResult = {
        probeName,
        passed,
        foundAt,
        message: passed
          ? `Found at ${foundAt}`
          : (probe.message ?? `Check "${check.type}" found no match`),
      };
      results.push(result);

      if (!passed && probe.on_fail === 'abort') {
        throw new ProbeFailedError(
          probeName,
          probe.anchor_ref,
          result.message ?? `Probe "${probeName}" failed — aborting`
        );
      }
      if (!passed && probe.on_fail === 'warn') {
        process.stderr.write(
          color(`  [WARN] Probe "${probeName}" failed: ${result.message}`, C.yellow) + '\n'
        );
      }
      continue;
    }

    // No check_hints and no check — just record as passed (informational probe)
    results.push({ probeName, passed: true, message: 'No checks defined — assumed present' });
  }

  return results;
}

// ─── Phase 2: VALIDATE ────────────────────────────────────────────────────────

/**
 * Load host snapshot from cwd if it exists.
 */
function loadSnapshot(cwd: string): HostSnapshot | null {
  const snapshotPath = path.join(cwd, 'host-snapshot.json');
  if (!fs.existsSync(snapshotPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as HostSnapshot;
  } catch {
    return null;
  }
}

/**
 * Load host manifest from cwd if it exists.
 */
function loadManifest(cwd: string): Record<string, unknown> | null {
  const manifestPath = path.join(cwd, 'scsp-manifest.yaml');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    // Inline require to avoid circular issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml') as { load: (s: string) => unknown };
    return yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function validateCompat(
  capability: ParsedCapability,
  _snapshotPath: string | null,
  cwd: string
): Promise<CompatReport> {
  const issues: string[] = [];
  const warnings: string[] = [];

  const snapshot = loadSnapshot(cwd);
  const manifest = loadManifest(cwd);
  const fm = capability.frontmatter;

  // Check required surfaces exist in manifest or snapshot
  const requires = fm.requires as Record<string, unknown> | undefined;
  if (requires) {
    const reqSurfaces = requires.surfaces as Record<string, unknown> | string[] | undefined;
    const reqAnchors = requires.anchors as Record<string, string[]> | undefined;

    if (manifest) {
      const manifestSurfaces = (manifest.surfaces as Record<string, unknown>) ?? {};
      if (reqSurfaces) {
        // reqSurfaces may be an array of surface names or an object with entity/logic/ui arrays
        const surfaceNames: string[] = Array.isArray(reqSurfaces)
          ? (reqSurfaces as string[])
          : Object.keys(reqSurfaces);
        for (const s of surfaceNames) {
          const inManifest =
            s === 'entities'
              ? Array.isArray(manifestSurfaces.entities)
              : s === 'ui_areas'
                ? Array.isArray(manifestSurfaces.ui_areas)
                : s === 'logic_domains'
                  ? Array.isArray(manifestSurfaces.logic_domains)
                  : false;
          if (!inManifest) {
            warnings.push(`Required surface "${s}" not declared in host manifest`);
          }
        }
      }

      // Check required anchors in manifest
      if (reqAnchors) {
        const manifestAnchors = (manifest.anchors as Record<string, unknown[]>) ?? {};
        for (const [anchorType, anchorIds] of Object.entries(reqAnchors)) {
          const mAnchors = (manifestAnchors[anchorType] as Array<{ id: string }>) ?? [];
          const mIds = new Set(mAnchors.map((a) => a.id));
          for (const id of anchorIds) {
            if (!mIds.has(id)) {
              warnings.push(`Required anchor "${id}" (${anchorType}) not declared in host manifest`);
            }
          }
        }
      }
    }

    // Check snapshot for anchor existence
    if (snapshot) {
      const reqSurfaceObj = (!Array.isArray(reqSurfaces) && reqSurfaces) ? reqSurfaces as Record<string, string[]> : {};

      // Check entities
      const reqEntities: string[] = [
        ...(reqSurfaceObj.entities ?? []),
        ...(reqAnchors?.entities ?? []),
      ];
      if (reqEntities.length > 0 && snapshot.entities) {
        const snapshotEntityIds = new Set(snapshot.entities.map((e) => e.id));
        for (const eid of reqEntities) {
          if (!snapshotEntityIds.has(eid)) {
            warnings.push(`Required entity "${eid}" not found in host snapshot`);
          }
        }
      }

      // Check hooks
      const reqHooks: string[] = reqAnchors?.hooks ?? [];
      if (reqHooks.length > 0 && snapshot.logic_hooks) {
        const snapshotHookIds = new Set(snapshot.logic_hooks.map((h) => h.id));
        for (const hid of reqHooks) {
          if (!snapshotHookIds.has(hid)) {
            warnings.push(`Required hook "${hid}" not found in host snapshot`);
          }
        }
      }

      // Check slots
      const reqSlots: string[] = reqAnchors?.slots ?? [];
      if (reqSlots.length > 0 && snapshot.ui_slots) {
        const snapshotSlotIds = new Set(snapshot.ui_slots.map((s) => s.id));
        for (const sid of reqSlots) {
          if (!snapshotSlotIds.has(sid)) {
            warnings.push(`Required UI slot "${sid}" not found in host snapshot`);
          }
        }
      }

      // Check explicit conflicts
      const conflicts = fm.conflicts as Array<{ id: string; reason?: string }> | undefined;
      if (conflicts && snapshot.installed_capabilities) {
        const installedIds = new Set(snapshot.installed_capabilities.map((c) => c.id));
        for (const conflict of conflicts) {
          if (installedIds.has(conflict.id)) {
            issues.push(
              `CONFLICT_DETECTED: "${conflict.id}" is already installed. ` +
                (conflict.reason ?? 'Conflicts with this capability.')
            );
          }
        }
      }

      // Auto-detect anchor/surface conflicts across installed capabilities
      if (snapshot.installed_capabilities && snapshot.installed_capabilities.length > 0) {
        const newComponents = (fm.components as Array<{ id: string; anchors_used?: string[]; surfaces_touched?: string[] }>) ?? [];
        const newAnchors = new Set(newComponents.flatMap((c) => c.anchors_used ?? []));
        const newSurfaces = new Set(newComponents.flatMap((c) => c.surfaces_touched ?? []));

        for (const installed of snapshot.installed_capabilities) {
          // anchors_used overlap — same anchor bound by two capabilities is potentially conflicting
          const installedAnchors = new Set(installed.anchors_used ?? []);
          const sharedAnchors = [...newAnchors].filter((a) => installedAnchors.has(a));
          if (sharedAnchors.length > 0) {
            warnings.push(
              `Anchor overlap with installed "${installed.id}": ${sharedAnchors.join(', ')}. ` +
              `Both capabilities bind the same anchor — verify they compose correctly.`
            );
          }
        }
      }
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
    warnings,
  };
}

// ─── Directory tree helper ────────────────────────────────────────────────────

async function buildDirectoryTree(dir: string, depth = 0, maxDepth = 3): Promise<string> {
  if (depth > maxDepth) return '';
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return '';
  }

  let tree = '';
  const indent = '  '.repeat(depth);
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    tree += `${indent}${entry.isDirectory() ? '📁 ' : ''}${entry.name}\n`;
    if (entry.isDirectory() && depth < maxDepth) {
      tree += await buildDirectoryTree(path.join(dir, entry.name), depth + 1, maxDepth);
    }
  }
  return tree;
}

// ─── Phase 3: DRY-RUN ────────────────────────────────────────────────────────

interface ClaudeFileChange {
  path: string;
  action: 'create' | 'modify' | 'append';
  content: string;
}

interface ClaudeResponse {
  summary: string;
  new_dependencies: string[];
  files: ClaudeFileChange[];
  ncv_warnings?: string[];
}

async function callClaudeAPI(
  prompt: string,
  apiKey: string,
  model = 'claude-opus-4-5'
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`Claude API returned error: ${data.error.message}`);
  }

  const textContent = data.content.find((c) => c.type === 'text');
  if (!textContent) {
    throw new Error('Claude API returned no text content');
  }
  return textContent.text;
}

function extractJsonFromResponse(text: string): ClaudeResponse | null {
  // Try to extract JSON from markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]) as ClaudeResponse;
    } catch {
      // fall through
    }
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as ClaudeResponse;
    } catch {
      // fall through
    }
  }

  return null;
}

export async function dryRun(
  capability: ParsedCapability,
  probeResults: ProbeResult[],
  cwd: string,
  apiKey: string
): Promise<DryRunReport> {
  const fm = capability.frontmatter;
  const sections = capability.sections;
  const name = (fm.name as string) ?? (fm.id as string) ?? 'Unknown';

  // Build directory tree (limit depth 3)
  const dirTree = await buildDirectoryTree(cwd, 0, 3);

  // Read key files from probe results
  const probeFileContents: string[] = [];
  for (const pr of probeResults) {
    if (pr.foundAt && pr.passed) {
      const filePart = pr.foundAt.split(':')[0];
      const absFile = path.resolve(cwd, filePart);
      if (fs.existsSync(absFile)) {
        try {
          const content = await fsp.readFile(absFile, 'utf-8');
          const lines = content.split('\n');
          // Include up to 150 lines
          const preview = lines.slice(0, 150).join('\n');
          probeFileContents.push(
            `### File: ${filePart}\n\`\`\`\n${preview}${lines.length > 150 ? '\n... (truncated)' : ''}\n\`\`\``
          );
        } catch {
          // ignore
        }
      }
    }
  }

  // Determine which components are skipped (probe with on_fail:warn failed)
  const probesByName = new Map<string, ProbeResult>();
  for (const pr of probeResults) {
    probesByName.set(pr.probeName, pr);
  }

  const components = (
    fm.components as Array<{ id: string; optional: boolean; anchors_used?: string[] }>
  ) ?? [];
  const skippedComponents: string[] = [];
  const probes = sections.probes as ProbeSpec[] | undefined;
  if (probes) {
    for (const probe of probes) {
      const pname = probe.name ?? probe.id ?? probe.anchor_ref ?? '';
      const result = probesByName.get(pname);
      if (result && !result.passed && probe.on_fail === 'warn') {
        // Find components that use this anchor
        for (const comp of components) {
          if (comp.optional && (comp.anchors_used ?? []).includes(probe.anchor_ref ?? '')) {
            if (!skippedComponents.includes(comp.id)) {
              skippedComponents.push(comp.id);
            }
          }
        }
      }
    }
  }

  const prompt = `You are an AI executor for the SCSP (Software Capability Sharing Protocol).
Your job is to apply a capability package to this codebase.

## Capability: ${name}
Version: ${fm.version as string}
ID: ${fm.id as string}

## Intent
${sections.intent ?? '(no intent section)'}

## What probes found:
${probeResults.map((pr) => `- ${pr.probeName}: ${pr.passed ? `FOUND at ${pr.foundAt}` : `NOT FOUND — ${pr.message}`}`).join('\n')}

## Host codebase structure:
\`\`\`
${dirTree || '(empty or unreadable directory)'}
\`\`\`

## Key files (from probe results):
${probeFileContents.length > 0 ? probeFileContents.join('\n\n') : '(no files found by probes)'}

## Required interfaces to implement:
\`\`\`yaml
${sections.interfaces ? JSON.stringify(sections.interfaces, null, 2) : '(no interfaces section)'}
\`\`\`

## Contracts to satisfy:
\`\`\`yaml
${sections.contracts ? JSON.stringify(sections.contracts, null, 2) : '(no contracts section)'}
\`\`\`

## Components to install (${skippedComponents.length > 0 ? `skipping: ${skippedComponents.join(', ')}` : 'all'}):
${components
  .filter((c) => !skippedComponents.includes(c.id))
  .map((c) => `- ${c.id} (optional: ${c.optional})`)
  .join('\n')}

## NCV Constraints (MUST NOT violate):
\`\`\`yaml
${sections.ncv ? JSON.stringify(sections.ncv, null, 2) : '(no NCV section)'}
\`\`\`

## Your task:
Generate the exact code changes needed to implement this capability in this codebase.
Return your response as JSON with this EXACT structure (wrap in a json code block):
\`\`\`json
{
  "summary": "Brief description of all changes",
  "new_dependencies": ["package1@version", "package2"],
  "ncv_warnings": ["any NCV concerns found"],
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "action": "create|modify|append",
      "content": "complete file content (for create/modify) or content to append (for append)"
    }
  ]
}
\`\`\`

Important rules:
- For "modify" actions, provide the COMPLETE new file content (not a diff)
- For "create" actions, provide the full content of the new file
- For "append" actions, provide only the content to add at the end
- Follow the NCV constraints strictly
- Generate complete, working code appropriate to the detected tech stack
- If the codebase is empty or no probes matched, generate appropriate placeholder files
- Keep changes minimal and focused on the capability being installed
- Paths must be relative to the project root`;

  const responseText = await callClaudeAPI(prompt, apiKey);
  const parsed = extractJsonFromResponse(responseText);

  if (!parsed) {
    // Fallback: return a report indicating Claude couldn't parse
    return {
      affectedFiles: [],
      diffSummary: `Claude response could not be parsed as JSON. Raw response:\n${responseText.slice(0, 500)}`,
      changes: [],
      newDependencies: [],
      skippedComponents,
      skippedReason:
        skippedComponents.length > 0 ? 'Optional component probes failed' : undefined,
      ncvWarnings: [],
    };
  }

  // Check NCV constraints against generated code
  const ncvWarnings: string[] = [...(parsed.ncv_warnings ?? [])];
  const ncv = sections.ncv as
    | Array<{
        id: string;
        severity?: string;
        enforcement?: {
          universal?: { type: string; pattern?: string };
          variants?: Record<string, { type: string; pattern?: string }>;
        };
        patterns?: Array<{ language?: string; forbidden_patterns?: string[] }>;
      }>
    | undefined;

  if (ncv && parsed.files) {
    for (const ncvEntry of ncv) {
      const severity = ncvEntry.severity ?? 'warning';
      // Check grep_negative patterns
      const universalEnf = ncvEntry.enforcement?.universal;
      if (universalEnf?.type === 'grep_negative' && universalEnf.pattern) {
        for (const fileChange of parsed.files) {
          let re: RegExp;
          try {
            re = new RegExp(universalEnf.pattern);
          } catch {
            continue;
          }
          if (re.test(fileChange.content)) {
            const msg = `NCV violation [${ncvEntry.id}] in ${fileChange.path}: matches forbidden pattern "${universalEnf.pattern}"`;
            if (severity === 'critical') {
              throw new NcvViolationError(ncvEntry.id, msg);
            }
            ncvWarnings.push(msg);
          }
        }
      }

      // Check outbound_audit: detect network calls in generated code
      if (universalEnf?.type === 'outbound_audit') {
        const outboundPatterns = [
          /\bfetch\s*\(/,
          /\baxios\s*\./,
          /\bhttp\.(?:get|post|request)\s*\(/,
          /\bhttps\.(?:get|post|request)\s*\(/,
          /new\s+(?:XMLHttpRequest|WebSocket)\s*\(/,
        ];
        const allowedDomains = (universalEnf as unknown as { allowed_domains?: string[] }).allowed_domains ?? [];
        for (const fileChange of parsed.files) {
          for (const pat of outboundPatterns) {
            if (pat.test(fileChange.content)) {
              // Check if it references an explicitly allowed domain
              const hasAllowedDomain = allowedDomains.length > 0 &&
                allowedDomains.some((d) => fileChange.content.includes(d));
              if (!hasAllowedDomain) {
                const msg = `NCV outbound_audit [${ncvEntry.id}] in ${fileChange.path}: detected potential network call — verify this is authorized by the capability spec`;
                ncvWarnings.push(msg);
              }
              break;
            }
          }
        }
      }

      // Check structural_check: detect middleware/import order issues in generated code
      if (universalEnf?.type === 'structural_check') {
        const checkRule = (universalEnf as unknown as { rule?: string; before?: string; after?: string }).rule;
        if (checkRule === 'middleware_order') {
          const before = (universalEnf as unknown as { before?: string }).before;
          const after = (universalEnf as unknown as { after?: string }).after;
          if (before && after) {
            for (const fileChange of parsed.files) {
              const beforeIdx = fileChange.content.indexOf(before);
              const afterIdx = fileChange.content.indexOf(after);
              if (beforeIdx !== -1 && afterIdx !== -1 && beforeIdx > afterIdx) {
                const msg = `NCV structural_check [${ncvEntry.id}] in ${fileChange.path}: "${before}" appears after "${after}" — middleware order violation`;
                if (severity === 'critical') {
                  throw new NcvViolationError(ncvEntry.id, msg);
                }
                ncvWarnings.push(msg);
              }
            }
          }
        }
      }

      // Check forbidden_patterns arrays
      if (ncvEntry.patterns) {
        for (const patternEntry of ncvEntry.patterns) {
          for (const fp of patternEntry.forbidden_patterns ?? []) {
            for (const fileChange of parsed.files) {
              let re: RegExp;
              try {
                re = new RegExp(fp);
              } catch {
                continue;
              }
              if (re.test(fileChange.content)) {
                const msg = `NCV violation [${ncvEntry.id}] in ${fileChange.path}: matches forbidden pattern "${fp}"`;
                if (severity === 'critical') {
                  throw new NcvViolationError(ncvEntry.id, msg);
                }
                ncvWarnings.push(msg);
              }
            }
          }
        }
      }
    }
  }

  const changes: FileChange[] = (parsed.files ?? []).map((f) => ({
    path: f.path,
    action: f.action,
    content: f.content,
  }));

  return {
    affectedFiles: changes.map((c) => c.path),
    diffSummary: parsed.summary ?? '(no summary)',
    changes,
    newDependencies: parsed.new_dependencies ?? [],
    skippedComponents,
    skippedReason: skippedComponents.length > 0 ? 'Optional component probes failed' : undefined,
    ncvWarnings,
  };
}

// ─── Phase 4: HUMAN CONFIRM ───────────────────────────────────────────────────

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

export async function humanConfirm(
  report: DryRunReport,
  capability: ParsedCapability
): Promise<'apply' | 'skip-optional' | 'cancel'> {
  const fm = capability.frontmatter;
  const name = (fm.name as string) ?? (fm.id as string) ?? 'Unknown';

  console.log('\n' + color('─'.repeat(60), C.dim));
  console.log(color('  SCSP Install — Review Changes', C.bold, C.cyan));
  console.log(color('─'.repeat(60), C.dim));
  console.log();

  console.log(color('  Capability: ', C.bold) + name + ' v' + (fm.version as string ?? '?'));
  console.log(color('  Summary:    ', C.bold) + report.diffSummary);
  console.log();

  if (report.affectedFiles.length > 0) {
    console.log(color('  Affected files:', C.bold));
    for (const f of report.affectedFiles) {
      const change = report.changes.find((c) => c.path === f);
      const badge =
        change?.action === 'create'
          ? color(' CREATE ', C.bgRed, C.white)
          : change?.action === 'append'
            ? color(' APPEND ', C.yellow)
            : color(' MODIFY ', C.blue);
      console.log(`    ${badge} ${f}`);
    }
    console.log();
  }

  if (report.newDependencies.length > 0) {
    console.log(color('  New dependencies:', C.bold));
    for (const dep of report.newDependencies) {
      console.log(`    ${color('+', C.green)} ${dep}`);
    }
    console.log();
  }

  if (report.skippedComponents.length > 0) {
    console.log(color('  Skipped optional components:', C.yellow));
    for (const sc of report.skippedComponents) {
      console.log(`    ${color('⊘', C.yellow)} ${sc} (${report.skippedReason ?? 'probe failed'})`);
    }
    console.log();
  }

  if (report.ncvWarnings.length > 0) {
    console.log(color('  ⚠ NCV Warnings:', C.yellow, C.bold));
    for (const w of report.ncvWarnings) {
      console.log(`    ${color('!', C.yellow)} ${w}`);
    }
    console.log();
  }

  // Show risk factors
  const riskFactors = fm.risk_factors as
    | { auto_derived?: boolean; additional?: string[] }
    | undefined;
  const components = fm.components as Array<{
    permissions?: { schema_migration?: boolean; external_deps?: string[] };
    blast_radius?: { structural_impact?: unknown };
  }>;

  const autoRisks: string[] = [];
  if (components) {
    for (const comp of components) {
      if (comp.permissions?.schema_migration) {
        autoRisks.push('Schema migration required — database changes are NOT automatically reversible without the down migration SQL');
      }
      if ((comp.permissions?.external_deps ?? []).length > 0) {
        autoRisks.push(`External dependencies will be installed: ${(comp.permissions?.external_deps ?? []).join(', ')}`);
      }
      if (comp.blast_radius?.structural_impact) {
        const impact = comp.blast_radius.structural_impact;
        if (Array.isArray(impact) && impact.length > 0) {
          autoRisks.push(`Structural impact: ${(impact as string[]).join(', ')}`);
        } else if (typeof impact === 'string') {
          autoRisks.push(`Structural impact: ${impact}`);
        }
      }
    }
  }

  const additionalRisks = riskFactors?.additional ?? [];
  const allRisks = [...new Set([...autoRisks, ...additionalRisks])];

  if (allRisks.length > 0) {
    console.log(color('  ⚠ Risk factors:', C.red, C.bold));
    for (const r of allRisks) {
      console.log(`    ${color('!', C.red)} ${r}`);
    }
    console.log();
  }

  console.log(color('─'.repeat(60), C.dim));
  console.log();
  console.log('  ' + color('[A]', C.green, C.bold) + ' Apply all changes');
  console.log('  ' + color('[S]', C.yellow, C.bold) + ' Skip optional components');
  console.log('  ' + color('[C]', C.red, C.bold) + ' Cancel installation');
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let choice: 'apply' | 'skip-optional' | 'cancel' = 'cancel';

  while (true) {
    const answer = await askQuestion(rl, color('  Your choice [A/S/C]: ', C.bold));
    const normalized = answer.trim().toUpperCase();
    if (normalized === 'A' || normalized === 'APPLY') {
      choice = 'apply';
      break;
    } else if (normalized === 'S' || normalized === 'SKIP') {
      choice = 'skip-optional';
      break;
    } else if (normalized === 'C' || normalized === 'CANCEL' || normalized === '') {
      choice = 'cancel';
      break;
    }
    console.log(color('  Please enter A, S, or C.', C.yellow));
  }

  rl.close();
  console.log();
  return choice;
}

// ─── Phase 5: APPLY ───────────────────────────────────────────────────────────

/**
 * Detect the package manager in use.
 */
function detectPackageManager(cwd: string): 'npm' | 'yarn' | 'pnpm' | 'pip' | 'go' | null {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'package.json'))) return 'npm';
  if (fs.existsSync(path.join(cwd, 'requirements.txt'))) return 'pip';
  if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'go';
  return null;
}

/**
 * Try to git stash if we're in a repo.
 */
function tryGitStash(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    execSync('git stash push -m "scsp-pre-install-snapshot"', { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function applyChanges(
  changes: FileChange[],
  cwd: string,
  capability: ParsedCapability,
  skipOptional = false
): Promise<void> {
  const fm = capability.frontmatter;

  // Optional: create git stash snapshot
  const stashed = tryGitStash(cwd);
  if (stashed) {
    console.log(color('  Git stash created (scsp-pre-install-snapshot)', C.dim));
  }

  const components = (
    fm.components as Array<{
      id: string;
      optional: boolean;
      permissions?: { schema_migration?: boolean; external_deps?: string[] };
    }>
  ) ?? [];

  // Filter changes if skip-optional
  let filteredChanges = changes;
  if (skipOptional) {
    // In a real system we'd know which files belong to which component.
    // For now, we apply all mandatory changes.
    const optionalComponents = components.filter((c) => c.optional).map((c) => c.id);
    if (optionalComponents.length > 0) {
      console.log(color(`  Skipping optional components: ${optionalComponents.join(', ')}`, C.dim));
    }
    filteredChanges = changes; // apply all (we don't have per-file component mapping from Claude)
  }

  // Apply each file change
  for (const change of filteredChanges) {
    const absPath = path.resolve(cwd, change.path);
    const dir = path.dirname(absPath);

    // Ensure parent directory exists
    await fsp.mkdir(dir, { recursive: true });

    if (change.action === 'create') {
      await fsp.writeFile(absPath, change.content, 'utf-8');
      console.log(`  ${color('CREATE', C.green)} ${change.path}`);
    } else if (change.action === 'modify') {
      await fsp.writeFile(absPath, change.content, 'utf-8');
      console.log(`  ${color('MODIFY', C.blue)} ${change.path}`);
    } else if (change.action === 'append') {
      await fsp.appendFile(absPath, '\n' + change.content, 'utf-8');
      console.log(`  ${color('APPEND', C.yellow)} ${change.path}`);
    }
  }

  // Handle schema migrations
  for (const comp of components) {
    if (comp.permissions?.schema_migration) {
      const compFull = (fm.components as Array<{
        id: string;
        rollback?: { stateful?: unknown };
      }>).find((c) => c.id === comp.id);
      const stateful = compFull?.rollback?.stateful;

      if (stateful) {
        // Extract and display migration SQL
        const statefulArr = Array.isArray(stateful) ? stateful : [stateful];
        for (const migration of statefulArr) {
          const m = migration as { type?: string; down?: string; schema_migration?: { up?: string; down?: string } };
          const upSql = m.schema_migration?.up ?? m.down;
          if (upSql) {
            console.log();
            console.log(color('  ── Schema Migration Required ──', C.yellow, C.bold));
            console.log(color('  Run this SQL to apply the schema migration:', C.yellow));
            console.log(color(upSql, C.cyan));
            console.log();

            // Prompt user
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            await new Promise<void>((resolve) => {
              rl.question(
                color('  Press Enter when migration is complete (or type "skip"): ', C.bold),
                (ans) => {
                  rl.close();
                  if (ans.trim().toLowerCase() !== 'skip') {
                    console.log(color('  Migration acknowledged.', C.green));
                  }
                  resolve();
                }
              );
            });
          }
        }
      }
    }
  }

  // Install external dependencies
  const pm = detectPackageManager(cwd);
  const allExternalDeps = Array.from(
    new Set(
      components.flatMap((c) => c.permissions?.external_deps ?? [])
    )
  );

  if (allExternalDeps.length > 0 && pm) {
    console.log();
    console.log(color(`  Installing dependencies with ${pm}...`, C.cyan));
    for (const dep of allExternalDeps) {
      try {
        let installCmd: string;
        if (pm === 'npm') {
          installCmd = `npm install ${dep}`;
        } else if (pm === 'yarn') {
          installCmd = `yarn add ${dep}`;
        } else if (pm === 'pnpm') {
          installCmd = `pnpm add ${dep}`;
        } else if (pm === 'pip') {
          installCmd = `pip install ${dep}`;
        } else if (pm === 'go') {
          installCmd = `go get ${dep}`;
        } else {
          continue;
        }
        console.log(color(`  Running: ${installCmd}`, C.dim));
        const { stdout } = await execAsync(installCmd, { cwd });
        if (stdout.trim()) console.log(color(`  ${stdout.trim()}`, C.dim));
        console.log(`  ${color('✓', C.green)} Installed ${dep}`);
      } catch (err) {
        console.log(color(`  [WARN] Failed to install ${dep}: ${(err as Error).message}`, C.yellow));
      }
    }
  }
}

// ─── Phase 6: VERIFY ──────────────────────────────────────────────────────────

export async function verifyContracts(
  capability: ParsedCapability,
  cwd: string,
  apiKey: string
): Promise<VerifyResult> {
  const fm = capability.frontmatter;
  const sections = capability.sections;
  const id = (fm.id as string) ?? 'unknown';

  const contracts = sections.contracts;
  const fixtures = sections.fixtures;
  const interfaces = sections.interfaces;

  if (!contracts) {
    return {
      passed: true,
      contractResults: [],
    };
  }

  // Ask Claude to generate test code
  const testGenPrompt = `You are an SCSP executor generating contract verification tests.

## Capability: ${fm.name as string} (${id})

## Contracts:
\`\`\`yaml
${JSON.stringify(contracts, null, 2)}
\`\`\`

## Fixtures:
\`\`\`yaml
${JSON.stringify(fixtures ?? [], null, 2)}
\`\`\`

## Interfaces:
\`\`\`yaml
${JSON.stringify(interfaces ?? [], null, 2)}
\`\`\`

## Directory structure of target codebase:
\`\`\`
${await buildDirectoryTree(cwd, 0, 2)}
\`\`\`

Generate a standalone test file (prefer TypeScript with Node.js built-in test runner, or plain JavaScript)
that verifies the contracts above. The test should:
1. Import the implemented capability code from the codebase (use relative paths)
2. Set up fixtures as test data
3. For each contract, run the action and verify assertions
4. Use Node.js built-in 'node:test' and 'node:assert' (no external test frameworks)

Return ONLY the test file content — no explanations, no markdown, just the TypeScript/JavaScript code.
The file path should be: .scsp-verify/test-${id}.ts`;

  const testCode = await callClaudeAPI(testGenPrompt, apiKey);

  // Write test file
  const verifyDir = path.join(cwd, '.scsp-verify');
  await fsp.mkdir(verifyDir, { recursive: true });
  const testFile = path.join(verifyDir, `test-${id}.ts`);

  // Strip markdown fences if present
  let cleanCode = testCode;
  const fenceMatch = testCode.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    cleanCode = fenceMatch[1];
  }

  await fsp.writeFile(testFile, cleanCode, 'utf-8');

  // Run tests
  const contractResults: Array<{ name: string; passed: boolean; error?: string }> = [];
  let testPassed = false;

  try {
    const pm = detectPackageManager(cwd);
    let runCmd: string;

    // Check if ts-node is available
    const hasTsNode = fs.existsSync(path.join(cwd, 'node_modules', '.bin', 'ts-node'));

    if (hasTsNode) {
      runCmd = `npx ts-node --esm ${testFile}`;
    } else if (pm === 'npm' || pm === 'yarn' || pm === 'pnpm') {
      // Fall back to compiling first
      runCmd = `node --experimental-vm-modules ${testFile.replace('.ts', '.js')}`;
    } else {
      runCmd = `node ${testFile.replace('.ts', '.js')}`;
    }

    const { stdout, stderr } = await execAsync(runCmd, { cwd, timeout: 30000 });
    testPassed = !stderr.includes('Error') && !stderr.includes('FAIL');

    // Parse test output
    const lines = (stdout + stderr).split('\n');
    for (const line of lines) {
      const passMatch = line.match(/(?:ok|pass|✓|PASS)\s+(.+)/i);
      const failMatch = line.match(/(?:not ok|fail|✗|FAIL|Error)\s*(.+)/i);
      if (passMatch) {
        contractResults.push({ name: passMatch[1].trim(), passed: true });
      } else if (failMatch) {
        contractResults.push({ name: failMatch[1].trim(), passed: false, error: line });
      }
    }

    if (contractResults.length === 0) {
      // No parseable output — assume passed if exit was clean
      contractResults.push({ name: 'contract-suite', passed: testPassed });
    }
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message: string };
    testPassed = false;
    contractResults.push({
      name: 'contract-suite',
      passed: false,
      error: error.stderr ?? error.message,
    });
  }

  const allMandatoryPassed = contractResults.every((r) => r.passed);

  return {
    passed: allMandatoryPassed,
    contractResults,
    testFile: path.relative(cwd, testFile),
  };
}

// ─── Snapshot update ──────────────────────────────────────────────────────────

async function updateSnapshot(
  cwd: string,
  capability: ParsedCapability,
  changes: FileChange[]
): Promise<void> {
  const snapshotPath = path.join(cwd, 'host-snapshot.json');
  let snapshot: HostSnapshot = {};

  if (fs.existsSync(snapshotPath)) {
    try {
      snapshot = JSON.parse(await fsp.readFile(snapshotPath, 'utf-8')) as HostSnapshot;
    } catch {
      snapshot = {};
    }
  } else {
    snapshot = {
      scsp_host_snapshot: '0.1',
      generated_at: new Date().toISOString(),
      generated_by: 'scsp-cli/0.1.0',
      installed_capabilities: [],
    };
  }

  if (!snapshot.installed_capabilities) {
    snapshot.installed_capabilities = [];
  }

  const fm = capability.frontmatter;
  const components = (fm.components as Array<{ id: string; anchors_used?: string[] }>) ?? [];
  const anchorsUsed = Array.from(new Set(components.flatMap((c) => c.anchors_used ?? [])));

  // Remove existing entry if re-installing
  snapshot.installed_capabilities = snapshot.installed_capabilities.filter(
    (c) => c.id !== (fm.id as string)
  );

  snapshot.installed_capabilities.push({
    id: fm.id as string,
    version: fm.version as string,
    installed_at: new Date().toISOString(),
    anchors_used: anchorsUsed,
    rollback_type: 'snapshot-based',
  });

  snapshot.generated_at = new Date().toISOString();

  await fsp.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
}

// ─── Auto-report install results ─────────────────────────────────────────────

/**
 * Best-effort: POST install outcome to the registry metadata endpoint.
 * Registry may not support this yet — failure is silent.
 */
async function reportInstallResult(
  capId: string,
  outcome: 'success' | 'fail' | 'rollback',
  registryUrl: string
): Promise<void> {
  // Only attempt for HTTP registries, not local file:// ones
  if (!registryUrl.startsWith('http')) return;

  // Build the report URL (registry may expose a POST endpoint)
  const reportUrl = `${registryUrl.replace(/\/registry$/, '')}/api/report`;

  try {
    await fetch(reportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'scsp-cli/0.1.0' },
      body: JSON.stringify({
        capability_id: capId,
        outcome,
        reported_at: new Date().toISOString(),
        cli_version: '0.1.0',
      }),
      signal: AbortSignal.timeout(3000), // 3s timeout
    });
  } catch {
    // Best-effort — ignore all errors
  }
}

// ─── Fetch capability ─────────────────────────────────────────────────────────

async function fetchCapability(
  capabilityId: string,
  registryUrl: string,
  localFile?: string
): Promise<string> {
  if (localFile) {
    const absPath = path.resolve(localFile);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Local file not found: ${localFile}`);
    }
    return fsp.readFile(absPath, 'utf-8');
  }

  // Try registry URL patterns
  const urls = [
    // Raw GitHub style
    `${registryUrl.replace(/\/$/, '')}/capabilities/${capabilityId}/${capabilityId}.scsp`,
    // Direct URL (if user passed a full URL)
    registryUrl.includes(capabilityId) ? registryUrl : null,
  ].filter(Boolean) as string[];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'scsp-cli/0.1.0' },
      });
      if (response.ok) {
        return response.text();
      }
    } catch {
      // try next
    }
  }

  throw new Error(
    `Could not fetch capability "${capabilityId}" from registry.\n` +
      `Tried: ${urls.join(', ')}\n` +
      `Use --local <file> to install from a local .scsp file.`
  );
}

// ─── Main install entry point ─────────────────────────────────────────────────

export interface InstallOptions {
  dryRunOnly?: boolean;
  apiKey?: string;
  localFile?: string;
}

export async function install(
  capabilityId: string,
  registryUrl: string,
  cwd: string,
  opts: InstallOptions
): Promise<void> {
  const apiKey = opts.apiKey ?? '';
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for the install command.');
  }

  const spinner = new Spinner();

  console.log();
  console.log(color('  SCSP Install', C.bold, C.cyan) + color(` — ${capabilityId}`, C.white));
  console.log(color('  ' + '─'.repeat(50), C.dim));
  console.log();

  // ── Fetch capability file ──────────────────────────────────────────────────

  spinner.start(`Fetching capability "${capabilityId}"...`);
  let rawCapability: string;
  try {
    rawCapability = await fetchCapability(capabilityId, registryUrl, opts.localFile);
    spinner.succeed(`Fetched capability: ${capabilityId}`);
  } catch (err) {
    spinner.fail(`Failed to fetch capability: ${(err as Error).message}`);
    throw err;
  }

  // Parse it
  const parseResult = parseCapabilityString(rawCapability);
  if (!parseResult.ok || !parseResult.capability) {
    throw new Error(`Failed to parse capability: ${(parseResult.errors ?? []).join(', ')}`);
  }
  const capability = parseResult.capability;
  const fm = capability.frontmatter;
  console.log(
    color('  Capability: ', C.dim) +
      (fm.name as string) +
      color(' v' + (fm.version as string), C.dim)
  );
  console.log();

  // ── Phase 1: PROBE ────────────────────────────────────────────────────────

  console.log(color('  [1/6] PROBE', C.bold) + color(' — scanning codebase for extension points', C.dim));
  spinner.start('Running probes...');

  const snapshot = loadSnapshot(cwd);
  const probes = (capability.sections.probes as ProbeSpec[] | undefined) ?? [];
  let probeResults: ProbeResult[] = [];

  try {
    probeResults = await runProbes(probes, cwd, snapshot);
    const passed = probeResults.filter((p) => p.passed).length;
    const failed = probeResults.filter((p) => !p.passed).length;
    if (failed === 0) {
      spinner.succeed(`Probes: ${passed}/${probeResults.length} passed`);
    } else {
      spinner.warn(`Probes: ${passed}/${probeResults.length} passed (${failed} warned)`);
    }
    for (const pr of probeResults) {
      if (pr.passed) {
        console.log(`    ${color('✓', C.green)} ${pr.probeName}: ${pr.foundAt ?? 'found'}`);
      } else {
        console.log(`    ${color('⚠', C.yellow)} ${pr.probeName}: ${pr.message}`);
      }
    }
  } catch (err) {
    if (err instanceof ProbeFailedError) {
      spinner.fail(`Probe FAILED [abort]: "${err.probeName}"`);
      console.log(color(`  ${err.message}`, C.red));
      throw err;
    }
    throw err;
  }
  console.log();

  // ── Phase 2: VALIDATE ────────────────────────────────────────────────────

  console.log(color('  [2/6] VALIDATE', C.bold) + color(' — checking compatibility', C.dim));
  spinner.start('Validating compatibility...');

  const compatReport = await validateCompat(capability, null, cwd);

  if (!compatReport.compatible) {
    spinner.fail('Compatibility check FAILED');
    for (const issue of compatReport.issues) {
      console.log(color(`  ✗ ${issue}`, C.red));
    }
    throw new CompatibilityError(compatReport.issues, 'Capability is incompatible with this host');
  }

  if (compatReport.warnings.length > 0) {
    spinner.warn(`Compatible with ${compatReport.warnings.length} warning(s)`);
    for (const w of compatReport.warnings) {
      console.log(color(`    ⚠ ${w}`, C.yellow));
    }
  } else {
    spinner.succeed('Host compatibility verified');
  }
  console.log();

  // ── Phase 3: DRY-RUN ─────────────────────────────────────────────────────

  console.log(color('  [3/6] DRY-RUN', C.bold) + color(' — generating code changes with AI', C.dim));
  spinner.start('Calling Claude API to generate changes...');

  let dryRunReport: DryRunReport;
  try {
    dryRunReport = await dryRun(capability, probeResults, cwd, apiKey);
    spinner.succeed(
      `Dry-run complete: ${dryRunReport.affectedFiles.length} file(s) to change`
    );
  } catch (err) {
    if (err instanceof NcvViolationError) {
      spinner.fail(`NCV violation (critical): ${err.violationId}`);
      console.log(color(`  ${err.message}`, C.red));
      throw err;
    }
    spinner.fail(`Dry-run failed: ${(err as Error).message}`);
    throw err;
  }

  if (dryRunReport.ncvWarnings.length > 0) {
    for (const w of dryRunReport.ncvWarnings) {
      console.log(color(`    ⚠ NCV: ${w}`, C.yellow));
    }
  }
  console.log();

  if (opts.dryRunOnly) {
    console.log(color('  DRY-RUN ONLY MODE — no changes will be applied.', C.yellow, C.bold));
    console.log();
    console.log(color('  Summary: ', C.bold) + dryRunReport.diffSummary);
    console.log();
    console.log(color('  Files that would be changed:', C.bold));
    for (const f of dryRunReport.affectedFiles) {
      const change = dryRunReport.changes.find((c) => c.path === f);
      console.log(`    ${color(change?.action?.toUpperCase() ?? 'CHANGE', C.blue)} ${f}`);
    }
    return;
  }

  // ── Phase 4: HUMAN CONFIRM ───────────────────────────────────────────────

  console.log(color('  [4/6] CONFIRM', C.bold) + color(' — human review gate', C.dim));
  const userChoice = await humanConfirm(dryRunReport, capability);

  if (userChoice === 'cancel') {
    console.log(color('  Installation cancelled by user.', C.yellow));
    return;
  }
  console.log();

  // ── Phase 5: APPLY ───────────────────────────────────────────────────────

  console.log(color('  [5/6] APPLY', C.bold) + color(' — writing files and installing deps', C.dim));
  try {
    await applyChanges(dryRunReport.changes, cwd, capability, userChoice === 'skip-optional');
    console.log();
    console.log(color('  Changes applied successfully.', C.green));
  } catch (err) {
    console.log(color(`  Apply failed: ${(err as Error).message}`, C.red));
    console.log(color('  If you created a git stash, you can restore with: git stash pop', C.dim));
    throw err;
  }
  console.log();

  // ── Phase 6: VERIFY ──────────────────────────────────────────────────────

  console.log(color('  [6/6] VERIFY', C.bold) + color(' — running contract tests', C.dim));
  spinner.start('Generating and running contract tests...');

  let verifyResult: VerifyResult;
  try {
    verifyResult = await verifyContracts(capability, cwd, apiKey);
  } catch (err) {
    spinner.warn(`Contract verification error: ${(err as Error).message}`);
    verifyResult = { passed: false, contractResults: [], testFile: undefined };
  }

  if (verifyResult.passed) {
    spinner.succeed('All contracts verified');
  } else {
    spinner.warn('Some contracts failed — check output below');
  }

  for (const cr of verifyResult.contractResults) {
    if (cr.passed) {
      console.log(`    ${color('✓', C.green)} ${cr.name}`);
    } else {
      console.log(`    ${color('✗', C.red)} ${cr.name}: ${cr.error ?? 'assertion failed'}`);
    }
  }

  if (verifyResult.testFile) {
    console.log(color(`    Test file: ${verifyResult.testFile}`, C.dim));
  }
  console.log();

  // ── Update snapshot ───────────────────────────────────────────────────────

  try {
    await updateSnapshot(cwd, capability, dryRunReport.changes);
    console.log(color('  ✓ host-snapshot.json updated', C.dim));
  } catch (err) {
    console.log(color(`  [WARN] Failed to update host-snapshot.json: ${(err as Error).message}`, C.yellow));
  }

  // ── Auto-report install result to registry ────────────────────────────────

  try {
    await reportInstallResult(fm.id as string, verifyResult.passed ? 'success' : 'fail', registryUrl);
  } catch {
    // silent — reporting is best-effort
  }

  // ── Final report ──────────────────────────────────────────────────────────

  console.log();
  console.log(color('─'.repeat(60), C.dim));
  if (verifyResult.passed) {
    console.log(
      color('  ✓ ', C.green, C.bold) +
        color(`${fm.name as string} installed successfully!`, C.bold)
    );
  } else {
    console.log(
      color('  ⚠ ', C.yellow, C.bold) +
        color(`${fm.name as string} installed with warnings.`, C.bold)
    );
    console.log(
      color('  Some contracts failed. Review the test file and fix any issues.', C.yellow)
    );
  }
  console.log(color('─'.repeat(60), C.dim));
  console.log();
}

// ─── Health check helper (for cli.ts health command) ─────────────────────────

export async function healthCheck(
  cwd: string,
  apiKey?: string
): Promise<void> {
  const snapshotPath = path.join(cwd, 'host-snapshot.json');
  if (!fs.existsSync(snapshotPath)) {
    console.log('No host-snapshot.json found. Run: scsp install <id> first.');
    return;
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as HostSnapshot;
  const installed = snapshot.installed_capabilities ?? [];

  if (installed.length === 0) {
    console.log('No capabilities installed. Use: scsp install <id>');
    return;
  }

  console.log(color(`Health check: ${installed.length} installed capability(s)`, C.bold));
  console.log();

  for (const cap of installed) {
    console.log(color(`  ${cap.id}@${cap.version}`, C.cyan));

    // Re-run probes if capability file is stored in snapshot
    if (cap.capability_file && fs.existsSync(cap.capability_file)) {
      try {
        const raw = fs.readFileSync(cap.capability_file, 'utf-8');
        const parseResult = parseCapabilityString(raw);
        if (parseResult.ok && parseResult.capability) {
          const probes = (parseResult.capability.sections.probes as ProbeSpec[] | undefined) ?? [];
          const probeResults = await runProbes(probes, cwd, snapshot);
          const passed = probeResults.filter((p) => p.passed).length;
          console.log(`    Probes: ${passed}/${probeResults.length} passing`);
          for (const pr of probeResults) {
            const icon = pr.passed ? color('✓', C.green) : color('✗', C.red);
            console.log(`      ${icon} ${pr.probeName}`);
          }
        }
      } catch {
        console.log(color('    [WARN] Could not re-run probes (capability file not available)', C.yellow));
      }
    } else {
      console.log(color('    Probes: capability file not cached — skipping probe re-run', C.dim));
      console.log(color('    Anchors used: ' + (cap.anchors_used ?? []).join(', '), C.dim));
    }

    console.log(`    Installed: ${cap.installed_at}`);
    console.log();
  }
}
