#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { validateFile, parseCapabilityString } from './parser';

const program = new Command();

program
  .name('scsp')
  .description('Software Capability Sharing Protocol CLI')
  .version('0.1.0');

// ─── validate ────────────────────────────────────────────────────────────────

program
  .command('validate [files...]')
  .description('Validate one or more .scsp capability package files')
  .option('--json', 'Output results as JSON')
  .action((files: string[], opts: { json?: boolean }) => {
    if (files.length === 0) {
      console.error('Error: no files specified.');
      process.exit(1);
    }

    let allOk = true;
    const results: Record<string, unknown>[] = [];

    for (const file of files) {
      const absPath = path.resolve(file);
      if (!fs.existsSync(absPath)) {
        const result = { file, ok: false, error: 'File not found' };
        results.push(result);
        allOk = false;
        if (!opts.json) {
          console.error(`\n✗ ${file}\n  File not found`);
        }
        continue;
      }

      const result = validateFile(absPath);
      const name = result.capability?.frontmatter?.id ?? path.basename(file);

      const out: Record<string, unknown> = { file, ok: result.ok, id: name };

      if (!opts.json) {
        if (result.ok) {
          console.log(`\n✓ ${file} [${name}]`);
          if (result.warnings?.length) {
            for (const w of result.warnings) {
              console.warn(`  ⚠  ${w}`);
            }
          }
        } else {
          console.error(`\n✗ ${file} [${name}]`);
          allOk = false;

          for (const e of result.parseErrors || []) console.error(`  parse:  ${e}`);
          for (const e of result.schemaErrors || []) console.error(`  schema: ${e}`);
          for (const e of result.consistencyErrors || []) console.error(`  check:  ${e}`);
          for (const w of result.warnings || []) console.warn(`  warn:   ${w}`);
        }
      }

      if (!result.ok) allOk = false;
      results.push(out);
    }

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log('');
      if (allOk) {
        console.log(`All ${files.length} file(s) valid.`);
      } else {
        console.log(`Validation failed. Fix errors above.`);
      }
    }

    process.exit(allOk ? 0 : 1);
  });

// ─── pack ─────────────────────────────────────────────────────────────────────

program
  .command('pack')
  .description('Generate a .scsp capability package from the current git diff')
  .option('--base <branch>', 'Base branch to diff against', 'main')
  .option('--mode <mode>', 'Pack mode: quick (frontmatter+intent+probes) or full', 'quick')
  .option('--out <file>', 'Output file path')
  .action((opts: { base: string; mode: string; out?: string }) => {
    console.log('scsp pack — generating capability package from git diff\n');

    // Detect git diff summary
    const { execSync } = require('child_process');
    let diff = '';
    try {
      diff = execSync(`git diff ${opts.base} --stat 2>/dev/null`).toString();
    } catch {
      diff = '(no git diff available — using current directory)';
    }

    const id = `my-capability-v1`;
    const outFile = opts.out ?? `${id}.scsp`;

    const quickTemplate = `---
scsp: "0.1"
id: "${id}"
name: "My Capability"
version: "1.0.0"
tags: []

author:
  name: "your-name"
  key: "ed25519:YOUR_PUBLIC_KEY"
signature: "ed25519:SIGN_THIS_FILE"
created: "${new Date().toISOString()}"
revoked: false

requires:
  manifest_version: ">=0.1"
  surfaces:
    entities: []
    logic_domains: []
    ui_areas: []
  anchors:
    hooks: []
    slots: []
    entities: []

components:
  - id: "main"
    layer: "module"
    optional: false
    surfaces_touched: []
    anchors_used: []
    blast_radius:
      structural_impact: []
      dependency_depth: 1
    rollback:
      stateless: "snapshot-based"
    permissions:
      surfaces_writable: []
      schema_migration: false
      external_deps: []

risk_factors:
  auto_derived: true
  additional: []
---

## Intent

### Motivation
<!-- Describe why this capability exists -->

### Design Principles
<!-- Key design decisions and constraints -->

\`\`\`yaml probes:
  - name: "TODO: add probes"
    component: "main"
    intent: "Verify the target extension point exists"
    check_hints:
      - lang: "universal"
        type: "grep"
        patterns: []
        paths: ["src/"]
    on_fail: "abort"
\`\`\`

\`\`\`yaml interfaces:
  - name: "todo_interface"
    component: "main"
    input:
      param: { type: "string", required: true }
    output:
      result: { type: "boolean" }
    errors: []
\`\`\`
`;

    fs.writeFileSync(outFile, quickTemplate);
    console.log(`Draft generated: ${outFile}`);
    console.log('\nGit diff summary used as context:');
    console.log(diff || '  (empty diff)');
    console.log('\nNext steps:');
    console.log('  1. Edit the .scsp file to describe your capability');
    console.log('  2. Run: scsp validate ' + outFile);
    console.log('  3. Run: scsp publish ' + outFile + ' --registry <url>');
  });

// ─── inspect ─────────────────────────────────────────────────────────────────

program
  .command('inspect <file>')
  .description('Parse and display the structured contents of a .scsp file')
  .option('--section <name>', 'Show only a specific section (probes, ncv, contracts, interfaces, fixtures)')
  .action((file: string, opts: { section?: string }) => {
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(absPath, 'utf-8');
    const { parseCapabilityString } = require('./parser');
    const result = parseCapabilityString(raw);

    if (!result.ok || !result.capability) {
      console.error('Parse failed:', result.errors);
      process.exit(1);
    }

    const { frontmatter, sections } = result.capability;

    if (opts.section) {
      const section = sections[opts.section as keyof typeof sections];
      if (!section) {
        console.error(`Section "${opts.section}" not found in file.`);
        process.exit(1);
      }
      console.log(yaml.dump(section, { indent: 2 }));
      return;
    }

    // Full inspect
    console.log('=== FRONTMATTER ===');
    console.log(yaml.dump(frontmatter, { indent: 2 }));

    for (const [name, content] of Object.entries(sections)) {
      if (content) {
        console.log(`\n=== ${name.toUpperCase()} ===`);
        console.log(yaml.dump(content, { indent: 2 }));
      }
    }
  });

// ─── publish (stub) ───────────────────────────────────────────────────────────

program
  .command('publish <file>')
  .description('Publish a .scsp capability package to a registry')
  .option('--registry <url>', 'Registry URL (git repo or HTTP)', 'https://github.com/scsp-community/registry')
  .action((file: string, opts: { registry: string }) => {
    console.log(`Publishing ${file} to ${opts.registry}...`);
    console.log('');

    // Validate first
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }

    const result = validateFile(absPath);
    if (!result.ok) {
      console.error('Validation failed — fix errors before publishing:');
      for (const e of [...(result.schemaErrors || []), ...(result.consistencyErrors || [])]) {
        console.error(`  ${e}`);
      }
      process.exit(1);
    }

    const id = result.capability?.frontmatter?.id as string;
    console.log(`✓ Validation passed for capability: ${id}`);
    console.log('');
    console.log('To publish to the git-based registry:');
    console.log(`  1. Fork ${opts.registry}`);
    console.log(`  2. Copy ${file} to capabilities/${id}/${id}.scsp`);
    console.log(`  3. Create metadata.json in capabilities/${id}/`);
    console.log(`  4. Submit a Pull Request — the bot will auto-validate and merge`);
    console.log('');
    console.log('HTTP registry publish (V0.2): coming soon');
  });

// ─── install (stub) ───────────────────────────────────────────────────────────

program
  .command('install <id>')
  .description('Install a capability package from a registry (6-stage execution)')
  .option('--registry <url>', 'Registry URL', 'https://github.com/scsp-community/registry')
  .option('--dry-run', 'Run through all stages but do not apply changes')
  .action((id: string, opts: { registry: string; dryRun?: boolean }) => {
    console.log(`scsp install ${id}`);
    console.log(`Registry: ${opts.registry}`);
    console.log('');
    console.log('6-Stage Execution Model:');
    console.log('  [1/6] PROBE       — locating extension points in your codebase...');
    console.log('  [2/6] VALIDATE    — checking compatibility with host manifest...');
    console.log('  [3/6] DRY-RUN     — generating changes in temporary branch...');
    console.log('  [4/6] CONFIRM     — review diff and confirm (human gate)');
    console.log('  [5/6] APPLY       — applying changes and running migrations...');
    console.log('  [6/6] VERIFY      — running contract tests...');
    console.log('');
    console.log('Note: Full executor implementation requires an AI agent runtime.');
    console.log('This CLI provides the protocol scaffolding; agent integration is in progress.');
    console.log('');
    console.log('See PROTOCOL.md §4 for complete execution semantics.');
  });

// ─── health ───────────────────────────────────────────────────────────────────

program
  .command('health')
  .description('Run health check on all installed capabilities')
  .action(() => {
    const snapshotPath = path.resolve('host-snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      console.log('No host-snapshot.json found in current directory.');
      console.log('Run: scsp init  to generate a host manifest and snapshot.');
      return;
    }

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const installed = snapshot.installed_capabilities ?? [];

    if (installed.length === 0) {
      console.log('No capabilities installed. Use: scsp install <id>');
      return;
    }

    console.log(`Health check: ${installed.length} installed capability(s)`);
    for (const cap of installed) {
      console.log(`  checking ${cap.id}@${cap.version}...`);
      // Executor would re-run probes + contracts here
      console.log(`    ✓ (executor health check not yet wired — see PROTOCOL.md §HEALTH-CHECK)`);
    }
  });

program.parse();
