import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { scanProject } from './init';

// ─── Types (mirrors spec/scsp-host-snapshot.schema.json) ─────────────────────

interface EntityField {
  name: string;
  type: string;
  nullable?: boolean;
}

interface EntityRecord {
  id: string;
  kind: 'model' | 'interface' | 'class' | 'type';
  source_file?: string;
  location_hint?: string;
  fields?: EntityField[];
}

interface LogicHook {
  id: string;
  description?: string;
  receives?: string[];
  can_short_circuit?: boolean;
}

interface UISlot {
  id: string;
  accepts?: string[];
  description?: string;
}

interface InstalledCapability {
  id: string;
  version: string;
  installed_at: string;
  components: string[];
  files_changed: string[];
}

interface HostSnapshot {
  scsp_snapshot: string;
  generated_at: string;
  generated_by: string;
  snapshot_hash?: string;
  project: {
    name: string;
    version?: string;
    language: string;
    frameworks: string[];
  };
  surfaces: {
    entities: string[];
    logic_domains: string[];
    ui_areas: string[];
  };
  entities: EntityRecord[];
  logic_hooks: LogicHook[];
  ui_slots: UISlot[];
  installed_capabilities: InstalledCapability[];
}

// ─── Location hint extraction ─────────────────────────────────────────────────

/**
 * Search source files to find where an entity (class/interface/model) is defined.
 * Returns a relative path with line number, e.g. "src/models/User.ts:12".
 */
function findEntityLocation(
  cwd: string,
  entityName: string,
  language: string,
): string | undefined {
  const searchDirs = ['src', 'app', 'lib', 'models', 'prisma', '.'];
  const extensions: Record<string, string[]> = {
    node: ['.ts', '.js'],
    python: ['.py'],
    go: ['.go'],
    ruby: ['.rb'],
    java: ['.java'],
    unknown: ['.ts', '.js', '.py'],
  };
  const exts = extensions[language] ?? extensions.unknown;

  const patterns: RegExp[] = {
    node: [
      new RegExp(`(?:export\\s+)?(?:abstract\\s+)?(?:class|interface)\\s+${entityName}\\b`),
      new RegExp(`^model\\s+${entityName}\\s*\\{`, 'm'),
    ],
    python: [new RegExp(`^class\\s+${entityName}\\s*[:(]`, 'm')],
    go: [new RegExp(`^type\\s+${entityName}\\s+struct\\s*\\{`, 'm')],
    ruby: [new RegExp(`^class\\s+${entityName}\\s*(?:<|$)`, 'm')],
    java: [new RegExp(`(?:class|interface)\\s+${entityName}\\b`)],
    unknown: [new RegExp(`(?:class|interface|type|struct)\\s+${entityName}\\b`)],
  }[language] ?? [new RegExp(`${entityName}`)];

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
            // Find line number
            const lineNum = content.slice(0, m.index).split('\n').length;
            return `${path.relative(cwd, full)}:${lineNum}`;
          }
        }
      }
    }
    return undefined;
  }

  for (const dir of searchDirs) {
    const found = walkDir(path.join(cwd, dir), 0);
    if (found) return found;
  }
  return undefined;
}

/**
 * Extract field names and types from an entity's source file.
 * Basic regex-based extraction — covers TypeScript interfaces/classes.
 */
function extractEntityFields(
  cwd: string,
  locationHint: string | undefined,
  language: string,
): EntityField[] | undefined {
  if (!locationHint) return undefined;
  const filePart = locationHint.split(':')[0];
  const absFile = path.join(cwd, filePart);
  let content: string;
  try { content = fs.readFileSync(absFile, 'utf-8'); } catch { return undefined; }

  const fields: EntityField[] = [];

  if (language === 'node') {
    // Match TypeScript interface/class body fields: fieldName?: Type;
    const bodyMatch = content.match(/(?:interface|class)\s+\w+[^{]*\{([\s\S]*?)(?:\n\}|\r\n\})/);
    if (bodyMatch) {
      const body = bodyMatch[1];
      const fieldRe = /^\s+(?:readonly\s+)?(\w+)(\??):\s*([^;=]+)/gm;
      let m: RegExpExecArray | null;
      while ((m = fieldRe.exec(body)) !== null) {
        const name = m[1];
        const nullable = m[2] === '?';
        const type = m[3].trim().replace(/[;,]$/, '');
        if (name && !name.startsWith('//') && !['constructor', 'abstract'].includes(name)) {
          fields.push({ name, type, nullable });
        }
      }
    }
    // Prisma model fields: fieldName Type? @...
    const prismaFieldRe = /^\s+(\w+)\s+(\w+)(\?)?/gm;
    if (content.includes('@prisma') || filePart.endsWith('.prisma')) {
      let m: RegExpExecArray | null;
      while ((m = prismaFieldRe.exec(content)) !== null) {
        const name = m[1];
        const type = m[2];
        const nullable = m[3] === '?';
        if (!['model', 'enum', 'generator', 'datasource'].includes(name)) {
          fields.push({ name, type, nullable });
        }
      }
    }
  }

  return fields.length > 0 ? fields.slice(0, 30) : undefined;
}

// ─── Snapshot hash computation ────────────────────────────────────────────────

function computeSnapshotHash(snapshot: Omit<HostSnapshot, 'snapshot_hash'>): string {
  const hashable = {
    entities: snapshot.entities.map((e) => e.id).sort(),
    logic_hooks: snapshot.logic_hooks.map((h) => h.id).sort(),
    ui_slots: snapshot.ui_slots.map((s) => s.id).sort(),
  };
  return 'sha256:' + crypto
    .createHash('sha256')
    .update(JSON.stringify(hashable))
    .digest('hex')
    .slice(0, 16);
}

// ─── Snapshot generation ──────────────────────────────────────────────────────

export async function generateSnapshot(cwd: string): Promise<HostSnapshot> {
  const scan = scanProject(cwd);

  // Read existing snapshot to preserve installed_capabilities
  const snapshotPath = path.join(cwd, 'host-snapshot.json');
  let existingInstalled: InstalledCapability[] = [];
  if (fs.existsSync(snapshotPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as HostSnapshot;
      existingInstalled = existing.installed_capabilities ?? [];
    } catch {
      // ignore malformed existing snapshot
    }
  }

  // Read scsp-manifest.yaml for declared hooks and slots if present
  let manifestHooks: LogicHook[] = [];
  let manifestSlots: UISlot[] = [];
  const manifestPath = path.join(cwd, 'scsp-manifest.yaml');
  if (fs.existsSync(manifestPath)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yaml = require('js-yaml') as { load: (s: string) => unknown };
      const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      const anchors = manifest.anchors as Record<string, unknown> | undefined;
      if (anchors) {
        const hooks = anchors.hooks as Array<{ id: string; description?: string; receives?: string[]; can_short_circuit?: boolean }> | undefined;
        const slots = anchors.slots as Array<{ id: string; accepts?: string[]; description?: string }> | undefined;
        if (hooks) manifestHooks = hooks.map(h => ({ id: h.id, description: h.description, receives: h.receives, can_short_circuit: h.can_short_circuit }));
        if (slots) manifestSlots = slots.map(s => ({ id: s.id, accepts: s.accepts, description: s.description }));
      }
    } catch {
      // ignore
    }
  }

  // Build entity records with location_hint and fields
  const entityRecords: EntityRecord[] = scan.surfaces.entities.map(name => {
    const locationHint = findEntityLocation(cwd, name, scan.runtime.language);
    const fields = extractEntityFields(cwd, locationHint, scan.runtime.language);
    const record: EntityRecord = {
      id: name,
      kind: 'class' as const,
    };
    if (locationHint) record.location_hint = locationHint;
    if (locationHint) record.source_file = locationHint.split(':')[0];
    if (fields && fields.length > 0) record.fields = fields;
    return record;
  });

  // Build package info
  let projectName = path.basename(cwd);
  let projectVersion: string | undefined;
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: string; version?: string };
      projectName = pkg.name ?? projectName;
      projectVersion = pkg.version;
    } catch { /* ignore */ }
  }

  const snapshotBase = {
    scsp_snapshot: '0.1',
    generated_at: new Date().toISOString(),
    generated_by: 'scsp-cli/0.1.0',
    project: {
      name: projectName,
      version: projectVersion,
      language: scan.runtime.language,
      frameworks: scan.runtime.frameworks,
    },
    surfaces: {
      entities: scan.surfaces.entities,
      logic_domains: scan.surfaces.logicDomains,
      ui_areas: scan.surfaces.uiAreas,
    },
    entities: entityRecords,
    logic_hooks: manifestHooks.length > 0
      ? manifestHooks
      : scan.suggestedAnchors.hooks.map(h => ({ id: h.id, description: h.description })),
    ui_slots: manifestSlots.length > 0
      ? manifestSlots
      : scan.suggestedAnchors.slots.map(s => ({ id: s.id, description: s.description })),
    installed_capabilities: existingInstalled,
  };

  const snapshot: HostSnapshot = {
    ...snapshotBase,
    snapshot_hash: computeSnapshotHash(snapshotBase),
  };

  return snapshot;
}

export async function runSnapshot(cwd: string): Promise<void> {
  const resolvedCwd = path.resolve(cwd);
  console.log(`\nScanning ${resolvedCwd}…`);

  const snapshot = await generateSnapshot(resolvedCwd);

  const outPath = path.join(resolvedCwd, 'host-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');

  console.log(`\n✓ host-snapshot.json written`);
  console.log(`  Generated by: ${snapshot.generated_by}`);
  console.log(`  Hash:         ${snapshot.snapshot_hash ?? '(none)'}`);
  console.log(`  Language:   ${snapshot.project.language}`);
  console.log(`  Frameworks: ${snapshot.project.frameworks.join(', ') || '(none detected)'}`);
  console.log(`  Entities:   ${snapshot.surfaces.entities.join(', ') || '(none detected)'}`);
  console.log(`  Domains:    ${snapshot.surfaces.logic_domains.join(', ') || '(none detected)'}`);
  console.log(`  UI areas:   ${snapshot.surfaces.ui_areas.join(', ') || '(none detected)'}`);
  console.log(`  Hooks:      ${snapshot.logic_hooks.map(h => h.id).join(', ') || '(none)'}`);
  console.log(`  Slots:      ${snapshot.ui_slots.map(s => s.id).join(', ') || '(none)'}`);
  console.log(`  Installed:  ${snapshot.installed_capabilities.length} capability(s)`);

  // Show location hints for entities
  const withLocation = snapshot.entities.filter(e => e.location_hint);
  if (withLocation.length > 0) {
    console.log(`  Entity locations:`);
    for (const e of withLocation) {
      const fieldCount = e.fields?.length ?? 0;
      console.log(`    ${e.id}: ${e.location_hint}${fieldCount > 0 ? ` (${fieldCount} fields)` : ''}`);
    }
  }

  console.log('');

  if (snapshot.surfaces.entities.length === 0 && snapshot.surfaces.logic_domains.length === 0) {
    console.log('  Tip: Run `scsp init` first to declare surfaces and anchors in scsp-manifest.yaml,');
    console.log('       then re-run `scsp snapshot` for a richer snapshot.');
    console.log('');
  }
}

