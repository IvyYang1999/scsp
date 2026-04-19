#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { validateFile, parseCapabilityString } from './parser';
import { runInit } from './init';
import { runKeygen, signCapability, verifySignature } from './keygen';
import { install, healthCheck } from './executor';
import { pack } from './packer';
import { search, fetchMetadata, type CapabilityMetadata } from './registry';

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

      // Verify signature if the capability has author.key and signature fields
      let sigVerified: boolean | null = null;
      let sigWarning: string | undefined;
      if (result.capability) {
        const fm = result.capability.frontmatter;
        const hasAuthorKey =
          fm.author && typeof (fm.author as Record<string, unknown>).key === 'string';
        const hasSignature = typeof fm.signature === 'string';
        if (hasAuthorKey && hasSignature) {
          sigVerified = verifySignature(result.capability);
          if (!sigVerified) {
            sigWarning =
              'Signature verification failed (placeholder key or tampered file — fix before publishing)';
          }
        }
      }

      const out: Record<string, unknown> = {
        file,
        ok: result.ok,
        id: name,
        signature_verified: sigVerified,
      };

      if (!opts.json) {
        if (result.ok) {
          console.log(`\n✓ ${file} [${name}]`);
          if (sigVerified === true) {
            console.log(`  ✓ Signature verified`);
          } else if (sigVerified === false) {
            console.warn(`  ⚠  ${sigWarning}`);
          }
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
          if (sigVerified === false) console.warn(`  warn:   ${sigWarning}`);
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
  .description('Generate a .scsp capability package from the current git diff using Claude AI')
  .option('--base <branch>', 'Base branch to diff against', 'main')
  .option('--mode <mode>', 'Pack mode: quick (frontmatter+intent+probes) or full (everything)', 'quick')
  .option('--out <file>', 'Output file path')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
  .action(async (opts: { base: string; mode: string; out?: string; apiKey?: string }) => {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY required. Set env var or use --api-key <key>');
      process.exit(1);
    }
    if (opts.mode !== 'quick' && opts.mode !== 'full') {
      console.error('Error: --mode must be "quick" or "full"');
      process.exit(1);
    }
    try {
      await pack({
        base: opts.base,
        mode: opts.mode as 'quick' | 'full',
        out: opts.out,
        cwd: process.cwd(),
        apiKey,
      });
    } catch (err) {
      console.error(`Pack failed: ${(err as Error).message}`);
      process.exit(1);
    }
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

    // Auto-sign if a key is available for this author
    if (result.capability) {
      const fm = result.capability.frontmatter;
      const authorName =
        fm.author && typeof (fm.author as Record<string, unknown>).name === 'string'
          ? (fm.author as Record<string, string>).name
          : undefined;

      if (authorName) {
        const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
        const keyPath = path.join(home, '.scsp', 'keys', `${authorName}.private`);
        if (fs.existsSync(keyPath)) {
          try {
            const signature = signCapability(absPath, keyPath);
            console.log(`✓ Auto-signed with key: ~/.scsp/keys/${authorName}.private`);
            console.log(`  Signature: ${signature}`);
            console.log('');
            console.log(
              '  To embed this signature, add or replace the "signature:" field in your .scsp frontmatter:'
            );
            console.log(`    signature: "${signature}"`);
            console.log('');
          } catch (e) {
            console.warn(`  ⚠  Could not auto-sign: ${(e as Error).message}`);
            console.log('');
          }
        } else {
          console.log(
            `  ℹ  No signing key found at ~/.scsp/keys/${authorName}.private`
          );
          console.log('     Run: scsp keygen <your-name>  to generate one.');
          console.log('');
        }
      }
    }

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

// ─── install ──────────────────────────────────────────────────────────────────

program
  .command('install <id>')
  .description('Install a capability package (6-stage AI-powered execution)')
  .option('--registry <url>', 'Registry URL', 'https://raw.githubusercontent.com/scsp-community/registry/main')
  .option('--dry-run', 'Run through all stages but do not apply changes')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
  .option('--local <file>', 'Install from a local .scsp file instead of registry')
  .action(async (id: string, opts: { registry: string; dryRun?: boolean; apiKey?: string; local?: string }) => {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY required. Set env var or use --api-key <key>');
      process.exit(1);
    }
    try {
      await install(id, opts.registry, process.cwd(), {
        dryRunOnly: opts.dryRun,
        apiKey,
        localFile: opts.local,
      });
    } catch (err) {
      console.error(`\nInstall failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── health ───────────────────────────────────────────────────────────────────

program
  .command('health')
  .description('Re-run probes and contracts for all installed capabilities')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
  .action(async (opts: { apiKey?: string }) => {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    try {
      await healthCheck(process.cwd(), apiKey);
    } catch (err) {
      console.error(`Health check failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize SCSP in your project — scans codebase and generates scsp-manifest.yaml')
  .option('--cwd <path>', 'Project directory to initialize', '.')
  .action(async (opts: { cwd: string }) => {
    await runInit(opts.cwd);
  });

// ─── keygen ───────────────────────────────────────────────────────────────────

program
  .command('keygen')
  .description('Generate an ed25519 key pair for signing capability packages')
  .argument('<name>', 'Name for this key (e.g., your username)')
  .action(async (name: string) => {
    await runKeygen(name);
  });

// ─── search ───────────────────────────────────────────────────────────────────

program
  .command('search [query]')
  .description('Search the SCSP registry for capability packages')
  .option('--tag <tags...>', 'Filter by tags (all must match)')
  .option('--surface <surfaces...>', 'Filter by surfaces (any match)')
  .option('--registry <url>', 'Registry base URL')
  .action(async (query: string | undefined, opts: { tag?: string[]; surface?: string[]; registry?: string }) => {
    // Auto-detect local registry if it exists and no --registry given
    const registryBase = opts.registry ?? (
      fs.existsSync(path.join(process.cwd(), 'registry', 'index.json'))
        ? path.join(process.cwd(), 'registry')
        : undefined
    );
    try {
      const results = await search({
        query,
        tags: opts.tag,
        surfaces: opts.surface,
        registryBase,
      });

      if (results.length === 0) {
        console.log('No results found.');
        return;
      }

      console.log(`Found ${results.length} capability(s):\n`);
      for (const r of results) {
        const score = (r.compatibility_score * 100).toFixed(0);
        console.log(`  ${r.id} — ${r.name}  [${r.layer}]`);
        console.log(`    tags: ${r.tags.join(', ')}  |  active installs: ${r.active_installs}  |  compat: ${score}%`);
        console.log(`    ${r.description}`);
        console.log('');
      }
    } catch (err) {
      console.error(`Search failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── info ─────────────────────────────────────────────────────────────────────

program
  .command('info <id>')
  .description('Show detailed metadata for a capability package in the registry')
  .option('--registry <url>', 'Registry base URL')
  .action(async (id: string, opts: { registry?: string }) => {
    const registryBase = opts.registry ?? (
      fs.existsSync(path.join(process.cwd(), 'registry', 'index.json'))
        ? path.join(process.cwd(), 'registry')
        : undefined
    );
    try {
      const meta: CapabilityMetadata = await fetchMetadata(id, registryBase);

      console.log(`\nCapability: ${meta.id}`);
      console.log(`  Pricing:     ${meta.pricing.model}${meta.pricing.amount ? ` ($${meta.pricing.amount} ${meta.pricing.currency ?? ''})` : ''}`);
      console.log(`  Installs:    ${meta.active_installs} active / ${meta.installs} total`);
      console.log(`  Forks:       ${meta.fork_count}`);
      console.log(`  Stack depth: ${meta.stack_depth}`);
      console.log(`  Compat score:${(meta.compatibility_score * 100).toFixed(0)}%`);

      console.log('\n  Reports (sample: ' + meta.reports.sample_size + '):');
      console.log(`    success:  ${meta.reports.success}`);
      console.log(`    fail:     ${meta.reports.fail}`);
      console.log(`    rollback: ${meta.reports.rollback}`);

      console.log('\n  Auto-review:');
      console.log(`    schema valid:    ${meta.auto_review.schema_valid ? 'yes' : 'no'}`);
      console.log(`    ncv self-check:  ${meta.auto_review.ncv_self_check}`);
      console.log(`    dependency audit:${meta.auto_review.dependency_audit}`);
      console.log(`    signed:          ${meta.auto_review.signed ? 'yes' : 'no'}`);

      if (meta.preview_url) {
        console.log(`\n  Preview: ${meta.preview_url}`);
      }
      console.log('');
    } catch (err) {
      console.error(`Info failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
