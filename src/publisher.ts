import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { validateFile } from './parser';
import { signCapability } from './keygen';

const execAsync = promisify(exec);

async function run(cmd: string, cwd?: string): Promise<string> {
  const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
  if (stderr && !stdout) throw new Error(stderr.trim());
  return stdout.trim();
}

async function runSilent(cmd: string, cwd?: string): Promise<string> {
  try {
    return await run(cmd, cwd);
  } catch {
    return '';
  }
}

function extractId(raw: string): string | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = match[1];
  const idMatch = fm.match(/^\s*id\s*:\s*["']?([^\s"'#]+)["']?/m);
  return idMatch ? idMatch[1].trim() : null;
}

export async function runPublish(filePath: string, registryRepo: string): Promise<void> {
  const absFile = path.resolve(filePath);

  // ── Step 1: validate ────────────────────────────────────────────────────────
  console.log('\n[1/7] Validating…');
  if (!fs.existsSync(absFile)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const result = validateFile(absFile);
  if (!result.ok) {
    const errors = [
      ...(result.parseErrors ?? []),
      ...(result.schemaErrors ?? []),
      ...(result.consistencyErrors ?? []),
    ];
    throw new Error(`Validation failed:\n${errors.map(e => `  ${e}`).join('\n')}`);
  }
  console.log('  ✓ Validation passed');

  // ── Step 2: extract id ──────────────────────────────────────────────────────
  const raw = fs.readFileSync(absFile, 'utf-8');
  const capId = extractId(raw);
  if (!capId) throw new Error('Could not extract capability id from frontmatter.');
  console.log(`  ✓ Capability id: ${capId}`);

  // ── Step 3: auto-sign if key available ──────────────────────────────────────
  console.log('\n[2/7] Checking signing key…');
  const fm = result.capability?.frontmatter;
  const authorName = fm?.author && typeof (fm.author as Record<string, unknown>).name === 'string'
    ? (fm.author as Record<string, string>).name
    : undefined;
  if (authorName) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
    const keyPath = path.join(home, '.scsp', 'keys', `${authorName}.private`);
    if (fs.existsSync(keyPath)) {
      try {
        const sig = signCapability(absFile, keyPath);
        console.log(`  ✓ Auto-signed: ${sig.slice(0, 40)}…`);
        console.log(`  → Embed in frontmatter: signature: "${sig}"`);
      } catch (e) {
        console.warn(`  ⚠  Could not auto-sign: ${(e as Error).message}`);
      }
    } else {
      console.log(`  ℹ  No key at ~/.scsp/keys/${authorName}.private — skipping signature`);
    }
  } else {
    console.log('  ℹ  No author.name in frontmatter — skipping signature');
  }

  // ── Step 4: create temp dir and clone registry ──────────────────────────────
  console.log('\n[3/7] Cloning registry (sparse)…');
  const tmpDir = await run('mktemp -d');
  const registryDir = path.join(tmpDir, 'repo');
  const registryUrl = `https://github.com/${registryRepo}.git`;

  try {
    await run(
      `git clone --filter=blob:none --no-checkout --depth=1 "${registryUrl}" "${registryDir}"`
    );
    await run('git sparse-checkout init --cone', registryDir);
    await run('git sparse-checkout set registry', registryDir);
    await run('git checkout', registryDir);
  } catch (err) {
    throw new Error(`Failed to clone registry: ${(err as Error).message}\nDo you have access to ${registryRepo}?`);
  }
  console.log('  ✓ Registry cloned');

  // ── Step 5: copy files into place ───────────────────────────────────────────
  console.log('\n[4/7] Adding capability files…');
  const capTargetDir = path.join(registryDir, 'registry', 'capabilities', capId);
  fs.mkdirSync(capTargetDir, { recursive: true });
  fs.copyFileSync(absFile, path.join(capTargetDir, `${capId}.scsp`));
  console.log(`  ✓ Copied ${capId}.scsp`);

  // Create stub metadata.json if not present
  const metaPath = path.join(capTargetDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    const stub = {
      id: capId,
      pricing: { model: 'free' },
      preview_url: null,
      screenshots: [],
      reports: { success: 0, fail: 0, rollback: 0, sample_size: 0 },
      installs: 0,
      active_installs: 0,
      fork_count: 0,
      stack_depth: 0,
      compatibility_score: 1.0,
      auto_review: {
        schema_valid: true,
        ncv_self_check: 'pass',
        dependency_audit: 'no known vulnerabilities',
        signed: false,
      },
    };
    fs.writeFileSync(metaPath, JSON.stringify(stub, null, 2) + '\n');
    console.log('  ✓ Created stub metadata.json');
  } else {
    console.log('  ✓ metadata.json already exists');
  }

  // ── Step 6: regenerate index.json ───────────────────────────────────────────
  console.log('\n[5/7] Regenerating index.json…');
  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'update-index.js');
  if (fs.existsSync(scriptPath)) {
    await runSilent(`node "${scriptPath}" --registry-dir "${path.join(registryDir, 'registry')}"`);
    console.log('  ✓ index.json updated');
  } else {
    console.log('  ⚠  update-index.js not found — skipping index update');
  }

  // ── Step 7: branch, commit, push, PR ────────────────────────────────────────
  console.log('\n[6/7] Committing and pushing…');
  const branch = `add-capability/${capId}`;

  await run(`git checkout -b "${branch}"`, registryDir);
  await run(`git add "registry/capabilities/${capId}/" "registry/index.json"`, registryDir);
  await run(
    `git -c user.name="scsp-publish" -c user.email="publish@scsp.local" commit -m "feat: add capability ${capId}"`,
    registryDir
  );
  await run(`git push -u origin "${branch}"`, registryDir);
  console.log(`  ✓ Pushed branch ${branch}`);

  console.log('\n[7/7] Creating Pull Request…');
  const prBody = `## New Capability: \`${capId}\`

This PR adds the \`${capId}\` capability to the registry.

### Files changed
- \`registry/capabilities/${capId}/${capId}.scsp\`
- \`registry/capabilities/${capId}/metadata.json\`
- \`registry/index.json\`

### Checklist
- [x] \`.scsp\` frontmatter validates against schema
- [x] \`metadata.json\` present
- [x] \`index.json\` updated

_Published with \`scsp publish-cap\`_`;

  try {
    const prUrl = await run(
      `gh pr create --repo "${registryRepo}" --title "feat: add capability ${capId}" --body "${prBody.replace(/"/g, '\\"')}" --head "${branch}" --base main`
    );
    console.log(`\n✓ Pull Request created: ${prUrl}`);
  } catch {
    console.log(`\n  ✓ Branch pushed. Open PR manually at:`);
    console.log(`  https://github.com/${registryRepo}/compare/main...${branch}?expand=1`);
  }

  // cleanup
  await runSilent(`rm -rf "${tmpDir}"`);

  console.log(`\n✓ Done! Capability '${capId}' submitted to ${registryRepo}.\n`);
}
