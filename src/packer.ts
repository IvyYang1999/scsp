import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { validateFile } from './parser';

const execAsync = promisify(exec);

// ─── Claude API types ─────────────────────────────────────────────────────────

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
}

// ─── git helpers ──────────────────────────────────────────────────────────────

async function gitExec(cmd: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function getGitContext(base: string, cwd: string): Promise<{
  stat: string;
  log: string;
  diffs: string;
  changedFiles: string[];
}> {
  const stat = await gitExec(`git diff ${base}...HEAD --stat`, cwd);
  const log = await gitExec(`git log ${base}...HEAD --oneline`, cwd);

  // Parse changed files from stat output
  const changedFiles: string[] = [];
  for (const line of stat.split('\n')) {
    // Lines look like: " src/foo.ts | 12 ++-"
    const match = line.match(/^\s+(.+?)\s+\|/);
    if (match) {
      changedFiles.push(match[1].trim());
    }
  }

  // Limit to 50 files
  const filesToDiff = changedFiles.slice(0, 50);

  const diffParts: string[] = [];
  for (const file of filesToDiff) {
    let fileDiff = await gitExec(`git diff ${base}...HEAD -- "${file}"`, cwd);
    if (!fileDiff) continue;

    // Limit to 200 lines per file
    const lines = fileDiff.split('\n');
    if (lines.length > 200) {
      fileDiff = lines.slice(0, 200).join('\n') + `\n... (truncated, ${lines.length - 200} more lines)`;
    }
    diffParts.push(`### ${file}\n\`\`\`diff\n${fileDiff}\n\`\`\``);
  }

  return {
    stat: stat || '(no changes detected)',
    log: log || '(no commits)',
    diffs: diffParts.join('\n\n') || '(no diffs available)',
    changedFiles,
  };
}

// ─── manifest reader ──────────────────────────────────────────────────────────

function readManifest(cwd: string): string {
  const candidates = ['scsp-manifest.yaml', 'scsp-manifest.yml', '.scsp-manifest.yaml'];
  for (const name of candidates) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return '';
}

// ─── Claude API call ─────────────────────────────────────────────────────────

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const body: ClaudeRequest = {
    model: 'claude-opus-4-5',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as ClaudeResponse;
  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text content');
  return textBlock.text;
}

// ─── prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(opts: {
  stat: string;
  log: string;
  diffs: string;
  manifest: string;
  mode: 'quick' | 'full';
  timestamp: string;
}): string {
  const modeInstructions =
    opts.mode === 'quick'
      ? `quick: Generate frontmatter + ## Intent section (Motivation + Design Principles subsections) + minimal probes yaml block (1-3 probes). Do NOT include ncv, contracts, fixtures, or interfaces sections.`
      : `full: Generate everything — frontmatter, ## Intent section with Motivation + Design Principles, plus all yaml blocks: probes, ncv, fixtures, contracts, interfaces. Make them thorough and realistic.`;

  const manifestSection = opts.manifest
    ? `## Host manifest (scsp-manifest.yaml):\n\`\`\`yaml\n${opts.manifest}\n\`\`\``
    : `## Host manifest:\n(not found — infer surfaces and anchors from the code changes)`;

  return `You are generating an SCSP capability package (.scsp file) from a git diff.

## Git diff summary:
${opts.stat}

## Commit messages:
${opts.log}

## Changed files and diffs:
${opts.diffs}

${manifestSection}

## Your task:
Generate a complete .scsp capability package file.

Mode: ${opts.mode}
- ${modeInstructions}

Output the complete .scsp file content and nothing else. Start with --- (YAML frontmatter delimiter). Do not add any explanation before or after the file content.

The .scsp format:
---
scsp: "0.1"
id: "<kebab-case-name>-v1"
name: "<Human Readable Name>"
version: "1.0.0"
tags: [<relevant tags>]
author:
  name: "AUTHOR_NAME_PLACEHOLDER"
  key: "ed25519:MCowBQYDK2VwAyEAplaceholder="
signature: "ed25519:placeholder="
created: "${opts.timestamp}"
revoked: false
requires:
  manifest_version: ">=0.1"
  surfaces:
    entities: [<entity names this touches, PascalCase>]
    logic_domains: [<domains like "auth", "billing", "notifications">]
    ui_areas: [<areas like "settings", "dashboard">]
  anchors:
    hooks: [<hook names like "auth.password_login.post_verify">]
    slots: [<slot names like "settings.security">]
    entities: [<entity anchor names>]
components:
  - id: "main"
    layer: "<module|component|behavior|improvement|migration>"
    optional: false
    surfaces_touched: [<surfaces this component reads/writes>]
    anchors_used: [<anchors this component binds to>]
    blast_radius:
      structural_impact: [<e.g. "Route", "Middleware", "DatabaseSchema">]
      dependency_depth: <integer 0-5>
    rollback:
      stateless: "snapshot-based"
    permissions:
      surfaces_writable: [<subset of surfaces_touched>]
      schema_migration: <true|false>
      external_deps: [<new npm/pip/etc packages introduced>]
risk_factors:
  auto_derived: true
  additional: []
lineage:
  origin: <id of the original capability this was derived from, or same as id if original>
  parent: <id@version of direct parent if this is a fork or patch, otherwise null>
  patches_applied: []
  divergence_point: null
---

## Intent

### Motivation
<Describe what problem this capability solves and why it exists>

### Design Principles
<Key design decisions, constraints, and architectural choices>

\`\`\`yaml probes:
- id: probe-<name>
  target: <entity|hook|slot>
  surface: <surface name>
  description: "<what this probe checks>"
  check:
    type: <entity_fields|hook_exists|slot_exists>
    <appropriate check fields>
  on_fail: <abort|warn>
  message: "<human readable failure message>"
\`\`\`

${opts.mode === 'full' ? `\`\`\`yaml ncv:
- id: <constraint-id>
  constraint: "<the invariant that must hold>"
  enforcement: <static_analysis|runtime_contract|contract>
  severity: <critical|high|medium>
\`\`\`

\`\`\`yaml fixtures:
- id: <fixture-id>
  type: <entity|static|generated>
  <appropriate fields>
\`\`\`

\`\`\`yaml contracts:
- id: contract-<name>
  description: "<what this contract verifies>"
  given:
    <setup conditions>
  when:
    <action>
  then:
    - <assertion>
\`\`\`

\`\`\`yaml interfaces:
- id: <interface-id>
  description: "<what this endpoint/interface does>"
  method: <HTTP method or equivalent>
  path: <path or identifier>
  auth_required: <true|false>
  request_body:
    <field definitions>
  response:
    200:
      <response shape>
\`\`\`` : ''}

Generate the .scsp file now based on the git diff provided. Infer the capability from the actual code changes. Be specific and concrete — use real field names, route paths, entity names, and patterns visible in the diff.`;
}

// ─── extract id from generated content ───────────────────────────────────────

function extractId(content: string): string {
  const match = content.match(/^id:\s+["']?([a-z][a-z0-9-]*)["']?/m);
  return match ? match[1] : 'capability-v1';
}

// ─── Interactive failure interview ────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function runFailureInterview(): Promise<{
  knownPitfalls: string[];
  testingNotes: string;
  rollbackNotes: string;
}> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n─────────────────────────────────────────────────────');
  console.log('  Failure Knowledge Interview');
  console.log('  Help future installers avoid problems you encountered.');
  console.log('─────────────────────────────────────────────────────\n');

  const pitfalls: string[] = [];

  const hasPitfalls = await ask(rl, '  Did you encounter any pitfalls or gotchas during development? [y/N]: ');
  if (hasPitfalls.toLowerCase() === 'y' || hasPitfalls.toLowerCase() === 'yes') {
    console.log('  Enter pitfalls one per line. Press Enter on empty line to finish.');
    let i = 1;
    while (true) {
      const p = await ask(rl, `  Pitfall #${i}: `);
      if (!p) break;
      pitfalls.push(p);
      i++;
    }
  }

  const testingNotes = await ask(rl, '  Any special testing notes? (Enter to skip): ');
  const rollbackNotes = await ask(rl, '  Any rollback complexity to document? (Enter to skip): ');

  rl.close();
  return { knownPitfalls: pitfalls, testingNotes, rollbackNotes };
}

function injectFailureKnowledge(
  content: string,
  pitfalls: string[],
  testingNotes: string,
  rollbackNotes: string
): string {
  if (!pitfalls.length && !testingNotes && !rollbackNotes) return content;

  const failureSection = [
    '',
    '## Failure Knowledge',
    '',
    pitfalls.length > 0 ? '### Known Pitfalls' : '',
    ...pitfalls.map((p) => `- ${p}`),
    testingNotes ? `\n### Testing Notes\n${testingNotes}` : '',
    rollbackNotes ? `\n### Rollback Notes\n${rollbackNotes}` : '',
    '',
  ].filter((l) => l !== undefined).join('\n');

  return content + failureSection;
}

// ─── Auto-validate and fix loop ───────────────────────────────────────────────

async function validateAndFixLoop(
  outFile: string,
  content: string,
  apiKey: string,
  maxRetries = 2
): Promise<string> {
  let current = content;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    fs.writeFileSync(outFile, current, 'utf-8');
    const validation = validateFile(outFile);

    if (validation.ok) {
      if (attempt > 0) {
        console.log(`  ✓ Validation passed after ${attempt} fix attempt(s)`);
      } else {
        console.log(`  Validation passed`);
      }
      if (validation.warnings?.length) {
        for (const w of validation.warnings) {
          console.warn(`  warn: ${w}`);
        }
      }
      return current;
    }

    const errors = [
      ...(validation.parseErrors ?? []),
      ...(validation.schemaErrors ?? []),
      ...(validation.consistencyErrors ?? []),
    ];

    if (attempt === maxRetries) {
      console.warn(`  Validation issues after ${maxRetries} fix attempts — review manually:`);
      for (const e of errors) console.warn(`    ${e}`);
      return current;
    }

    console.warn(`  Validation failed (attempt ${attempt + 1}) — asking Claude to fix…`);
    for (const e of errors) console.warn(`    error: ${e}`);

    // Ask Claude to fix
    const fixPrompt = `The following .scsp capability package file has validation errors.
Fix ONLY the errors listed below. Do NOT change anything else.
Return the complete fixed .scsp file content (starting with ---), nothing else.

## Errors to fix:
${errors.map((e) => `- ${e}`).join('\n')}

## Current file content:
${current}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 4096,
          messages: [{ role: 'user', content: fixPrompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json() as { content: Array<{ type: string; text: string }> };
        const text = data.content.find((c) => c.type === 'text')?.text ?? '';
        const startIdx = text.indexOf('---');
        if (startIdx !== -1) {
          current = text.slice(startIdx);
        }
      }
    } catch {
      // If fix call fails, break out
      break;
    }
  }

  return current;
}

// ─── main pack function ───────────────────────────────────────────────────────

export async function pack(opts: {
  base: string;
  mode: 'quick' | 'full';
  out?: string;
  cwd: string;
  apiKey: string;
  interview?: boolean;
}): Promise<void> {
  console.log('scsp pack — generating capability package from git diff\n');

  // 1. Get git context
  console.log(`Diffing against: ${opts.base}`);
  const gitCtx = await getGitContext(opts.base, opts.cwd);
  console.log(`Changed files: ${gitCtx.changedFiles.length}`);
  console.log(`Commits:\n${gitCtx.log || '  (none)'}\n`);

  if (!gitCtx.log && !gitCtx.stat.trim()) {
    console.warn('Warning: no git diff found between HEAD and base branch.');
    console.warn('Make sure you have commits on the current branch relative to ' + opts.base);
  }

  // 2. Read manifest if present
  const manifest = readManifest(opts.cwd);
  if (manifest) {
    console.log('Found scsp-manifest.yaml — using as anchor/surface context\n');
  }

  // 3. Build prompt and call Claude
  const timestamp = new Date().toISOString();
  const prompt = buildPrompt({
    stat: gitCtx.stat,
    log: gitCtx.log,
    diffs: gitCtx.diffs,
    manifest,
    mode: opts.mode,
    timestamp,
  });

  console.log(`Calling Claude API (mode: ${opts.mode})...`);
  let generated: string;
  try {
    generated = await callClaude(prompt, opts.apiKey);
  } catch (err) {
    console.error('Claude API call failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Ensure content starts with frontmatter delimiter
  if (!generated.trimStart().startsWith('---')) {
    // Claude may have added a preamble — strip it
    const idx = generated.indexOf('---');
    if (idx !== -1) {
      generated = generated.slice(idx);
    } else {
      console.error('Claude did not return a valid .scsp file (no --- delimiter found).');
      process.exit(1);
    }
  }

  // 4. Failure knowledge interview (optional)
  if (opts.interview) {
    const knowledge = await runFailureInterview();
    generated = injectFailureKnowledge(
      generated,
      knowledge.knownPitfalls,
      knowledge.testingNotes,
      knowledge.rollbackNotes
    );
  }

  // 5. Write output file
  const id = extractId(generated);
  const outFile = opts.out ?? path.join(opts.cwd, `${id}.scsp`);
  fs.writeFileSync(outFile, generated, 'utf-8');
  console.log(`\nGenerated: ${outFile}\n`);

  // 6. Auto-validate and fix loop
  console.log('Running validation (with auto-fix)...');
  await validateAndFixLoop(outFile, generated, opts.apiKey);

  // 7. Next steps
  console.log('\nNext steps:');
  console.log(`  1. Review and edit: ${outFile}`);
  console.log('  2. Fill in author.name and author.key with your real key pair');
  console.log(`  3. Run: scsp validate ${outFile}`);
  console.log('  4. Sign the package (scsp keygen if needed)');
  console.log(`  5. Run: scsp publish-cap ${outFile}`);
}
