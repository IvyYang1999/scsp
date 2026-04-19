import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Constants ────────────────────────────────────────────────────────────────

const AVAILABLE_SKILLS = [
  'scsp-onboard',
  'scsp-sync',
  'scsp-review',
  'scsp-install',
  'scsp-explore',
  'scsp-health',
] as const;
type SkillName = typeof AVAILABLE_SKILLS[number];

const SKILL_DESCRIPTIONS: Record<SkillName, string> = {
  'scsp-onboard': 'Initialize SCSP for a project — generates scsp-manifest.yaml and host-snapshot.json through deep codebase analysis',
  'scsp-sync':    'Sync manifest and snapshot after codebase changes — detects drifted anchors, new extension points, signature changes',
  'scsp-review':  'Review a .scsp capability package against the current codebase — validates probes, blast radius, NCV coverage',
  'scsp-install': 'Install a capability package — full 6-phase pipeline (probe → validate → dry-run → confirm → apply → verify) with rollback support',
  'scsp-explore': 'Explore the registry with AI-powered recommendations tailored to your codebase — understands what your project actually needs',
  'scsp-health':  'Check health of all installed capabilities — re-runs probes, detects degradation, identifies breakage from recent code changes',
};

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Source skills directory — ships with the npm package at skills/*.md
 * __dirname is dist/ at runtime, so we go up one level.
 */
function skillsSourceDir(): string {
  return path.join(__dirname, '..', 'skills');
}

function globalSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

function projectSkillsDir(): string {
  return path.join(process.cwd(), '.claude', 'skills');
}

function skillSourcePath(name: string): string {
  return path.join(skillsSourceDir(), `${name}.md`);
}

// ─── Install ──────────────────────────────────────────────────────────────────

export async function installSkills(opts: {
  skills: string[];
  global: boolean;
}): Promise<void> {
  const targetDir = opts.global ? globalSkillsDir() : projectSkillsDir();
  const scopeLabel = opts.global ? 'global (~/.claude/skills/)' : 'project (.claude/skills/)';

  const toInstall: string[] = opts.skills.length > 0 ? opts.skills : [...AVAILABLE_SKILLS];

  // Validate requested skill names
  const unknown = toInstall.filter((s) => !AVAILABLE_SKILLS.includes(s as SkillName));
  if (unknown.length > 0) {
    console.error(`Unknown skill(s): ${unknown.join(', ')}`);
    console.error(`Available: ${AVAILABLE_SKILLS.join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  console.log(`\nInstalling SCSP skills → ${scopeLabel}\n`);

  let installed = 0;
  let skipped = 0;

  for (const skillName of toInstall) {
    const src = skillSourcePath(skillName);
    const dest = path.join(targetDir, `${skillName}.md`);

    if (!fs.existsSync(src)) {
      console.warn(`  ⚠  Source not found for skill "${skillName}" — skipping`);
      skipped++;
      continue;
    }

    fs.copyFileSync(src, dest);
    console.log(`  ✓  ${skillName}`);
    console.log(`     ${SKILL_DESCRIPTIONS[skillName as SkillName]}`);
    if (installed < toInstall.length - skipped - 1) console.log('');
    installed++;
  }

  console.log('');

  if (installed === 0) {
    console.error('No skills installed.');
    process.exit(1);
  }

  console.log(`Installed ${installed} skill(s) to ${targetDir}`);
  console.log('');

  if (opts.global) {
    console.log('Skills are now available in any Claude Code session.');
    console.log('');
    console.log('Usage (in Claude Code):');
    for (const s of toInstall) {
      if (AVAILABLE_SKILLS.includes(s as SkillName)) {
        console.log(`  /${s}`);
      }
    }
  } else {
    console.log('Skills are now available in Claude Code sessions opened in this directory.');
    console.log('To install globally instead, run: scsp skills install --global');
  }

  console.log('');
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listSkills(): Promise<void> {
  const globalDir = globalSkillsDir();
  const projectDir = projectSkillsDir();

  console.log('\nSCSP Claude Code Skills\n');

  for (const name of AVAILABLE_SKILLS) {
    const src = skillSourcePath(name);
    const inGlobal = fs.existsSync(path.join(globalDir, `${name}.md`));
    const inProject = fs.existsSync(path.join(projectDir, `${name}.md`));
    const srcExists = fs.existsSync(src);

    const status = inGlobal
      ? '✓ installed (global)'
      : inProject
        ? '✓ installed (project)'
        : '  not installed';

    console.log(`  ${status.padEnd(25)} /${name}`);
    console.log(`  ${' '.repeat(25)} ${SKILL_DESCRIPTIONS[name]}`);
    console.log('');
  }

  if (!fs.existsSync(globalDir) && !fs.existsSync(projectDir)) {
    console.log('No skills installed yet.');
    console.log('Run: scsp skills install');
    console.log('');
  }

  console.log(`Source: ${skillsSourceDir()}`);
  console.log('');
}

// ─── Uninstall ────────────────────────────────────────────────────────────────

export async function uninstallSkills(opts: {
  skills: string[];
  global: boolean;
}): Promise<void> {
  const targetDir = opts.global ? globalSkillsDir() : projectSkillsDir();
  const toRemove: string[] = opts.skills.length > 0 ? opts.skills : [...AVAILABLE_SKILLS];

  let removed = 0;
  let missing = 0;

  console.log('');

  for (const skillName of toRemove) {
    const dest = path.join(targetDir, `${skillName}.md`);
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
      console.log(`  ✓  removed ${skillName}`);
      removed++;
    } else {
      console.log(`  -  ${skillName} not installed`);
      missing++;
    }
  }

  console.log('');
  console.log(`${removed} skill(s) removed.`);
  console.log('');
}
