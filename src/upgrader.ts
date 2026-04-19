import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { fetchCapability } from './registry';
import { parseCapabilityString } from './parser';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const col = (text: string, ...codes: string[]) => codes.join('') + text + C.reset;

// ─── Types ────────────────────────────────────────────────────────────────────

interface InstalledCapability {
  id: string;
  version: string;
  installed_at: string;
  anchors_used?: string[];
  rollback_type?: string;
  capability_file?: string;
}

interface HostSnapshot {
  scsp_snapshot?: string;
  scsp_host_snapshot?: string;
  generated_at?: string;
  generated_by?: string;
  installed_capabilities?: InstalledCapability[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadSnapshot(cwd: string): HostSnapshot | null {
  const p = path.join(cwd, 'host-snapshot.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as HostSnapshot; } catch { return null; }
}

function saveSnapshot(cwd: string, snapshot: HostSnapshot): void {
  const p = path.join(cwd, 'host-snapshot.json');
  fs.writeFileSync(p, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

function tryGitStash(cwd: string, message: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    execSync(`git stash push -m "${message}"`, { cwd, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// ─── Main upgrade function ────────────────────────────────────────────────────

export async function upgrade(opts: {
  capabilityId: string;
  registryUrl: string;
  cwd: string;
  apiKey: string;
}): Promise<void> {
  const { capabilityId, registryUrl, cwd, apiKey } = opts;

  console.log();
  console.log(col('  SCSP Upgrade', C.bold, C.cyan) + col(` — ${capabilityId}`, C.dim));
  console.log(col('  ' + '─'.repeat(50), C.dim));
  console.log();

  // ── 1. Check if capability is installed ──────────────────────────────────────

  const snapshot = loadSnapshot(cwd);
  if (!snapshot) {
    throw new Error('No host-snapshot.json found. Run `scsp snapshot` first.');
  }

  const installed = (snapshot.installed_capabilities ?? []).find((c) => c.id === capabilityId);
  if (!installed) {
    throw new Error(
      `Capability "${capabilityId}" is not installed. ` +
      `Run \`scsp install ${capabilityId}\` instead.`
    );
  }

  console.log(col('  Currently installed:', C.bold), `${capabilityId}@${installed.version}`);

  // ── 2. Fetch new version from registry ───────────────────────────────────────

  console.log(col('  [1/5] Fetching latest version from registry…', C.dim));
  let rawNew: string;
  try {
    rawNew = await fetchCapability(capabilityId, registryUrl);
  } catch (err) {
    throw new Error(`Failed to fetch latest version: ${(err as Error).message}`);
  }

  const parseResult = parseCapabilityString(rawNew);
  if (!parseResult.ok || !parseResult.capability) {
    throw new Error(`Failed to parse new capability: ${(parseResult.errors ?? []).join(', ')}`);
  }

  const newFm = parseResult.capability.frontmatter;
  const newVersion = (newFm.version as string) ?? '?';

  if (newVersion === installed.version) {
    console.log(col(`  ✓ Already at latest version: ${newVersion}`, C.green));
    console.log();
    return;
  }

  console.log(
    col('  Upgrade available:', C.bold),
    col(installed.version, C.yellow), '→', col(newVersion, C.green)
  );
  console.log();

  // ── 3. Check for migration type ───────────────────────────────────────────────

  const components = (newFm.components as Array<{ id: string; layer?: string }>) ?? [];
  const hasMigration = components.some((c) => c.layer === 'migration');
  if (hasMigration) {
    console.log(col('  ⚠ This upgrade includes a migration component.', C.yellow));
    console.log(col('    Review the .scsp file carefully before proceeding.', C.yellow));
    console.log();
  }

  // ── 4. Create safety stash ───────────────────────────────────────────────────

  console.log(col('  [2/5] Creating rollback snapshot…', C.dim));
  const stashed = tryGitStash(cwd, `scsp-pre-upgrade-${capabilityId}-${installed.version}`);
  if (stashed) {
    console.log(col(`  ✓ Git stash created (scsp-pre-upgrade-${capabilityId}-${installed.version})`, C.dim));
  } else {
    console.log(col('  ℹ No git repo — skipping stash (backup your files manually)', C.dim));
  }

  // ── 5. Remove old entry from snapshot ────────────────────────────────────────

  console.log(col('  [3/5] Removing old capability record…', C.dim));
  snapshot.installed_capabilities = (snapshot.installed_capabilities ?? []).filter(
    (c) => c.id !== capabilityId
  );
  saveSnapshot(cwd, snapshot);
  console.log(col(`  ✓ Removed ${capabilityId}@${installed.version} from snapshot`, C.dim));

  // ── 6. Write new .scsp to .scsp-cache ────────────────────────────────────────

  const cacheDir = path.join(cwd, '.scsp-cache');
  await fsp.mkdir(cacheDir, { recursive: true });
  const cachedFile = path.join(cacheDir, `${capabilityId}.scsp`);
  await fsp.writeFile(cachedFile, rawNew, 'utf-8');

  // ── 7. Re-install via executor ───────────────────────────────────────────────

  console.log(col('  [4/5] Installing new version…', C.dim));
  console.log();

  // Dynamic import to avoid circular deps at module load time
  const { install } = await import('./executor');
  await install(capabilityId, registryUrl, cwd, {
    apiKey,
    localFile: cachedFile,
  });

  // ── 8. Final summary ─────────────────────────────────────────────────────────

  console.log();
  console.log(col('  [5/5] Upgrade complete', C.bold, C.green));
  console.log();
  console.log(col('  ' + '─'.repeat(50), C.dim));
  console.log(col('  ✓ ', C.green, C.bold) + col(`${capabilityId} upgraded to v${newVersion}`, C.bold));
  if (stashed) {
    console.log(col(`  Rollback: git stash pop  (to revert to v${installed.version})`, C.dim));
  }
  console.log(col('  ' + '─'.repeat(50), C.dim));
  console.log();
}
