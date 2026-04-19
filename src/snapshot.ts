import * as fs from 'fs';
import * as path from 'path';
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

  // Build entity records from scan (without field-level detail — that requires AST)
  const entityRecords: EntityRecord[] = scan.surfaces.entities.map(name => ({
    id: name,
    kind: 'class' as const,
  }));

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

  const snapshot: HostSnapshot = {
    scsp_snapshot: '0.1',
    generated_at: new Date().toISOString(),
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

  return snapshot;
}

export async function runSnapshot(cwd: string): Promise<void> {
  const resolvedCwd = path.resolve(cwd);
  console.log(`\nScanning ${resolvedCwd}…`);

  const snapshot = await generateSnapshot(resolvedCwd);

  const outPath = path.join(resolvedCwd, 'host-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');

  console.log(`\n✓ host-snapshot.json written`);
  console.log(`  Language:   ${snapshot.project.language}`);
  console.log(`  Frameworks: ${snapshot.project.frameworks.join(', ') || '(none detected)'}`);
  console.log(`  Entities:   ${snapshot.surfaces.entities.join(', ') || '(none detected)'}`);
  console.log(`  Domains:    ${snapshot.surfaces.logic_domains.join(', ') || '(none detected)'}`);
  console.log(`  UI areas:   ${snapshot.surfaces.ui_areas.join(', ') || '(none detected)'}`);
  console.log(`  Hooks:      ${snapshot.logic_hooks.map(h => h.id).join(', ') || '(none)'}`);
  console.log(`  Slots:      ${snapshot.ui_slots.map(s => s.id).join(', ') || '(none)'}`);
  console.log(`  Installed:  ${snapshot.installed_capabilities.length} capability(s)`);
  console.log('');

  if (snapshot.surfaces.entities.length === 0 && snapshot.surfaces.logic_domains.length === 0) {
    console.log('  Tip: Run `scsp init` first to declare surfaces and anchors in scsp-manifest.yaml,');
    console.log('       then re-run `scsp snapshot` for a richer snapshot.');
    console.log('');
  }
}
