import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { scanProject } from './init';

// ─── Types (aligned with spec/scsp-host-snapshot.schema.json) ────────────────

interface SchemaEntity {
  id: string;
  fields: string[];        // simple field name strings per schema
  location_hint: string;
  extensible: boolean;
}

interface SchemaUISlot {
  id: string;
  framework: string;
  location_hint: string;
  mount_type: 'inject' | 'portal' | 'replace' | 'append' | 'prepend';
}

interface SchemaLogicHook {
  id: string;
  location_hint: string;
  signature_hint: string;
  lang: string;
}

interface SchemaInstalledCapability {
  id: string;
  version: string;
  installed_at: string;
  components_applied: string[];
}

export interface HostSnapshot {
  scsp_host_snapshot: string;   // semver e.g. "0.1.0"
  generated_at: string;
  generated_by: string;
  manifest_ref: string;
  manifest_version: string;
  snapshot_hash: string;        // sha256:<64 hex chars>
  base_version_hash: string;    // git:<40 hex chars>
  entities: SchemaEntity[];
  ui_slots: SchemaUISlot[];
  logic_hooks: SchemaLogicHook[];
  installed_capabilities: SchemaInstalledCapability[];
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

function getGitCommitSha(cwd: string): string {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return `git:${sha}`;
  } catch {
    // not a git repo or no commits
  }
  return `git:${'0'.repeat(40)}`;
}

// ─── Location hint extraction ─────────────────────────────────────────────────

function findEntityLocation(cwd: string, entityName: string, language: string): string | undefined {
  const extensions: Record<string, string[]> = {
    node: ['.ts', '.js'], python: ['.py'], go: ['.go'],
    ruby: ['.rb'], java: ['.java'], unknown: ['.ts', '.js', '.py'],
  };
  const exts = extensions[language] ?? extensions.unknown;

  const patternMap: Record<string, RegExp[]> = {
    node: [
      new RegExp(`(?:export\\s+)?(?:abstract\\s+)?(?:class|interface)\\s+${entityName}\\b`),
      new RegExp(`^model\\s+${entityName}\\s*\\{`, 'm'),
    ],
    python: [new RegExp(`^class\\s+${entityName}\\s*[:(]`, 'm')],
    go: [new RegExp(`^type\\s+${entityName}\\s+struct\\s*\\{`, 'm')],
    ruby: [new RegExp(`^class\\s+${entityName}\\s*(?:<|$)`, 'm')],
    java: [new RegExp(`(?:class|interface)\\s+${entityName}\\b`)],
    unknown: [new RegExp(`(?:class|interface|type|struct)\\s+${entityName}\\b`)],
  };
  const patterns = patternMap[language] ?? [new RegExp(entityName)];

  function walkDir(dir: string, depth: number): string | undefined {
    if (depth > 4) return undefined;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return undefined; }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
      const full = path.join(dir, entry);
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        const found = walkDir(full, depth + 1);
        if (found) return found;
      } else if (exts.some((e) => entry.endsWith(e))) {
        let content: string;
        try { content = fs.readFileSync(full, 'utf-8'); } catch { continue; }
        for (const pat of patterns) {
          const m = pat.exec(content);
          if (m) {
            const lineNum = content.slice(0, m.index).split('\n').length;
            return `${path.relative(cwd, full)}:${lineNum}`;
          }
        }
      }
    }
    return undefined;
  }

  for (const dir of ['src', 'app', 'lib', 'models', 'prisma', '.']) {
    const found = walkDir(path.join(cwd, dir), 0);
    if (found) return found;
  }
  return undefined;
}

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function extractFieldNames(cwd: string, locationHint: string | undefined, language: string): string[] {
  if (!locationHint) return [];
  const filePart = locationHint.split(':')[0];
  let content: string;
  try { content = fs.readFileSync(path.join(cwd, filePart), 'utf-8'); } catch { return []; }

  const fields: string[] = [];

  if (language === 'node') {
    const bodyMatch = content.match(/(?:interface|class)\s+\w+[^{]*\{([\s\S]*?)(?:\n\}|\r\n\})/);
    if (bodyMatch) {
      const body = bodyMatch[1];
      const fieldRe = /^\s+(?:readonly\s+)?(\w+)\??\s*:/gm;
      let m: RegExpExecArray | null;
      while ((m = fieldRe.exec(body)) !== null) {
        const name = m[1];
        if (name && !['constructor', 'abstract', 'static'].includes(name)) {
          fields.push(toSnakeCase(name));
        }
      }
    }
  }

  // Validate against schema pattern ^[a-z][a-z0-9_]*$
  return [...new Set(fields)]
    .filter((f) => /^[a-z][a-z0-9_]*$/.test(f))
    .slice(0, 30);
}

// ─── Manifest reader ──────────────────────────────────────────────────────────

interface ManifestData {
  hooks?: Array<{ id: string; description?: string }>;
  slots?: Array<{ id: string; description?: string }>;
}

function readManifest(cwd: string): { ref: string; version: string; data: ManifestData } {
  const candidates = ['scsp-manifest.yaml', 'scsp-manifest.yml', '.scsp/manifest.yaml'];
  for (const name of candidates) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yaml = require('js-yaml') as { load: (s: string) => unknown };
      const raw = yaml.load(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
      const anchors = (raw.anchors as Record<string, unknown> | undefined) ?? {};
      const hooks = (anchors.hooks as Array<{ id: string; description?: string }>) ?? [];
      const slots = (anchors.slots as Array<{ id: string; description?: string }>) ?? [];
      return {
        ref: name,
        version: (raw.version as string) ?? '0.1.0',
        data: { hooks, slots },
      };
    } catch { /* ignore */ }
  }
  return { ref: 'scsp-manifest.yaml', version: '0.1.0', data: {} };
}

// ─── Existing installed_capabilities (backward-compatible reader) ─────────────

function loadExistingInstalled(cwd: string): SchemaInstalledCapability[] {
  const p = path.join(cwd, 'host-snapshot.json');
  if (!fs.existsSync(p)) return [];
  try {
    const existing = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      installed_capabilities?: Array<{
        id: string; version: string; installed_at: string;
        components_applied?: string[]; components?: string[];
        anchors_used?: string[];
      }>;
    };
    return (existing.installed_capabilities ?? []).map((c) => ({
      id: c.id,
      version: c.version,
      installed_at: c.installed_at,
      components_applied: c.components_applied ?? c.components ?? ['main'],
    })).filter((c) => /^[a-z][a-z0-9-]*$/.test(c.id));
  } catch { return []; }
}

// ─── Snapshot hash ────────────────────────────────────────────────────────────

function computeSnapshotHash(snapshot: Omit<HostSnapshot, 'snapshot_hash'>): string {
  const hashable = {
    entities: snapshot.entities
      .map((e) => ({ id: e.id, fields: [...e.fields].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    logic_hooks: snapshot.logic_hooks.map((h) => h.id).sort(),
    ui_slots: snapshot.ui_slots.map((s) => s.id).sort(),
  };
  // 64 hex chars — matches schema pattern ^sha256:[0-9a-f]{64}$
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(hashable)).digest('hex');
}

// ─── Snapshot generation ──────────────────────────────────────────────────────

export async function generateSnapshot(cwd: string): Promise<HostSnapshot> {
  const scan = scanProject(cwd);
  const manifest = readManifest(cwd);
  const existingInstalled = loadExistingInstalled(cwd);
  const baseVersionHash = getGitCommitSha(cwd);

  // Build schema-compliant entities
  const entities: SchemaEntity[] = scan.surfaces.entities.map((name) => {
    const locationHint = findEntityLocation(cwd, name, scan.runtime.language);
    const fields = extractFieldNames(cwd, locationHint, scan.runtime.language);
    return {
      id: name,
      fields: fields.length > 0 ? fields : ['id'],
      location_hint: locationHint ?? `(${name} — location not found by scanner)`,
      extensible: true,
    };
  });

  // Build ui_slots from manifest anchors or suggestions
  const slotSources = manifest.data.slots?.length
    ? manifest.data.slots
    : scan.suggestedAnchors.slots;

  const uiSlots: SchemaUISlot[] = slotSources.map((s) => ({
    id: s.id,
    framework: scan.runtime.frameworks[0] ?? 'unknown',
    location_hint: `(${s.id} — declared in ${manifest.ref})`,
    mount_type: 'inject' as const,
  }));

  // Build logic_hooks from manifest anchors or suggestions
  // Schema requires id to match ^[a-z][a-z0-9_]*$
  const hookSources = manifest.data.hooks?.length
    ? manifest.data.hooks
    : scan.suggestedAnchors.hooks;

  const logicHooks: SchemaLogicHook[] = hookSources.map((h) => ({
    id: h.id.replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/^_+|_+$/g, ''),
    location_hint: `(${h.id} — declared in ${manifest.ref})`,
    signature_hint: '() => void',
    lang: scan.runtime.language === 'node' ? 'typescript' : scan.runtime.language,
  })).filter((h) => /^[a-z][a-z0-9_]*$/.test(h.id));

  const snapshotBase: Omit<HostSnapshot, 'snapshot_hash'> = {
    scsp_host_snapshot: '0.1.0',
    generated_at: new Date().toISOString(),
    generated_by: 'scsp-cli/0.1.0',
    manifest_ref: manifest.ref,
    manifest_version: manifest.version,
    base_version_hash: baseVersionHash,
    entities,
    ui_slots: uiSlots,
    logic_hooks: logicHooks,
    installed_capabilities: existingInstalled,
  };

  return {
    ...snapshotBase,
    snapshot_hash: computeSnapshotHash(snapshotBase),
  };
}

export async function runSnapshot(cwd: string): Promise<void> {
  const resolvedCwd = path.resolve(cwd);
  console.log(`\nScanning ${resolvedCwd}…`);

  const snapshot = await generateSnapshot(resolvedCwd);
  const scan = scanProject(resolvedCwd);

  const outPath = path.join(resolvedCwd, 'host-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');

  console.log(`\n✓ host-snapshot.json written  (schema: scsp-host-snapshot ${snapshot.scsp_host_snapshot})`);
  console.log(`  Generated by:    ${snapshot.generated_by}`);
  console.log(`  Manifest:        ${snapshot.manifest_ref} @ ${snapshot.manifest_version}`);
  console.log(`  Base commit:     ${snapshot.base_version_hash}`);
  console.log(`  Snapshot hash:   ${snapshot.snapshot_hash.slice(0, 22)}…`);
  console.log(`  Language:        ${scan.runtime.language}`);
  console.log(`  Frameworks:      ${scan.runtime.frameworks.join(', ') || '(none detected)'}`);
  console.log(`  Entities:        ${snapshot.entities.map((e) => e.id).join(', ') || '(none detected)'}`);
  console.log(`  Logic hooks:     ${snapshot.logic_hooks.map((h) => h.id).join(', ') || '(none)'}`);
  console.log(`  UI slots:        ${snapshot.ui_slots.map((s) => s.id).join(', ') || '(none)'}`);
  console.log(`  Installed:       ${snapshot.installed_capabilities.length} capability(s)`);

  const withLocation = snapshot.entities.filter((e) => !e.location_hint.startsWith('('));
  if (withLocation.length > 0) {
    console.log(`  Entity locations:`);
    for (const e of withLocation) {
      console.log(`    ${e.id}: ${e.location_hint}  (${e.fields.length} fields)`);
    }
  }

  console.log('');

  if (snapshot.entities.length === 0 && snapshot.logic_hooks.length === 0) {
    console.log('  Tip: Run `scsp init` first to declare surfaces and anchors in scsp-manifest.yaml,');
    console.log('       then re-run `scsp snapshot` for a richer snapshot.');
    console.log('');
  }
}
