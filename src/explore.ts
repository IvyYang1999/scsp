import * as fs from 'fs';
import * as path from 'path';
import { search, fetchCapability, type SearchResult } from './registry';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
};
const col = (text: string, ...codes: string[]) => codes.join('') + text + C.reset;

// ─── Snapshot loader ──────────────────────────────────────────────────────────

interface HostSnapshot {
  surfaces?: { entities?: string[]; logic_domains?: string[]; ui_areas?: string[] };
}

function loadSnapshot(cwd: string): HostSnapshot | null {
  const p = path.join(cwd, 'host-snapshot.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as HostSnapshot; } catch { return null; }
}

// ─── Compatibility booster ────────────────────────────────────────────────────

/**
 * Boost relevance_score for results whose surfaces/tags overlap with the local
 * host-snapshot.json.  Returns a new sorted array — does not mutate input.
 */
function boostBySnapshot(results: SearchResult[], snapshot: HostSnapshot | null): SearchResult[] {
  if (!snapshot?.surfaces) return results;

  const hostSurfaces = new Set([
    ...(snapshot.surfaces.entities ?? []).map((s) => s.toLowerCase()),
    ...(snapshot.surfaces.logic_domains ?? []).map((s) => s.toLowerCase()),
    ...(snapshot.surfaces.ui_areas ?? []).map((s) => s.toLowerCase()),
  ]);

  const boosted = results.map((r) => {
    let bonus = 0;
    const allSurfaces = [
      ...(r.surfaces.entities ?? []),
      ...(r.surfaces.logic_domains ?? []),
      ...(r.surfaces.ui_areas ?? []),
    ].map((s) => s.toLowerCase());

    for (const s of allSurfaces) {
      if (hostSurfaces.has(s)) bonus += 1.5;
    }
    for (const tag of r.tags) {
      if (hostSurfaces.has(tag.toLowerCase())) bonus += 0.5;
    }
    return { ...r, relevance_score: r.relevance_score + bonus };
  });

  return boosted.sort((a, b) => b.relevance_score - a.relevance_score);
}

// ─── Display ──────────────────────────────────────────────────────────────────

function renderResult(r: SearchResult, idx: number, snapshot: HostSnapshot | null): void {
  const hostSurfaces = new Set([
    ...(snapshot?.surfaces?.entities ?? []).map((s) => s.toLowerCase()),
    ...(snapshot?.surfaces?.logic_domains ?? []).map((s) => s.toLowerCase()),
    ...(snapshot?.surfaces?.ui_areas ?? []).map((s) => s.toLowerCase()),
  ]);

  const allSurfaces = [
    ...(r.surfaces.entities ?? []),
    ...(r.surfaces.logic_domains ?? []),
    ...(r.surfaces.ui_areas ?? []),
  ];
  const compatible = allSurfaces.some((s) => hostSurfaces.has(s.toLowerCase()));

  const compatBadge = snapshot
    ? (compatible ? col(' ✓ compat ', C.green) : col(' ? check ', C.yellow))
    : '';

  const score = (r.relevance_score).toFixed(1);
  console.log(
    `  ${col(String(idx + 1).padStart(2), C.dim)}. ${col(r.id, C.bold, C.cyan)}  ${compatBadge}`
  );
  console.log(`      ${col(r.name, C.bold)} ${col(`[${r.layer}]`, C.dim)}`);
  console.log(`      ${r.description}`);

  const tagStr = r.tags.slice(0, 6).join(', ');
  const surfStr = allSurfaces.slice(0, 4).join(', ');
  console.log(
    `      ${col('tags:', C.dim)} ${tagStr}` +
    (surfStr ? `  ${col('surfaces:', C.dim)} ${surfStr}` : '')
  );
  console.log(
    `      ${col('installs:', C.dim)} ${r.active_installs}  ` +
    `${col('compat:', C.dim)} ${(r.compatibility_score * 100).toFixed(0)}%  ` +
    `${col('score:', C.dim)} ${score}`
  );
  console.log();
}

// ─── Main explore function ────────────────────────────────────────────────────

export async function explore(opts: {
  query?: string;
  tags?: string[];
  surfaces?: string[];
  registryBase?: string;
  limit?: number;
  preview?: boolean;
  cwd: string;
}): Promise<void> {
  const snapshot = loadSnapshot(opts.cwd);

  console.log();
  console.log(col('  SCSP Explore', C.bold, C.cyan) + col(' — semantic capability search', C.dim));

  if (snapshot?.surfaces) {
    const surfaceCount =
      (snapshot.surfaces.entities?.length ?? 0) +
      (snapshot.surfaces.logic_domains?.length ?? 0) +
      (snapshot.surfaces.ui_areas?.length ?? 0);
    if (surfaceCount > 0) {
      console.log(col(`  Using host-snapshot.json to boost compatible results (${surfaceCount} surfaces)`, C.dim));
    }
  }

  console.log(col('  ' + '─'.repeat(56), C.dim));
  console.log();

  if (opts.query) {
    console.log(`  Searching for: ${col(opts.query, C.bold)}`);
  }
  if (opts.tags?.length) {
    console.log(`  Tags: ${opts.tags.join(', ')}`);
  }
  if (opts.surfaces?.length) {
    console.log(`  Surfaces: ${opts.surfaces.join(', ')}`);
  }
  console.log();

  let results: SearchResult[];
  try {
    results = await search({
      query: opts.query,
      tags: opts.tags,
      surfaces: opts.surfaces,
      registryBase: opts.registryBase,
    });
  } catch (err) {
    console.error(col(`  Error fetching registry: ${(err as Error).message}`, C.red));
    process.exit(1);
  }

  // Boost by local snapshot
  const boosted = boostBySnapshot(results, snapshot);
  const limited = boosted.slice(0, opts.limit ?? 10);

  if (limited.length === 0) {
    console.log(col('  No results found.', C.yellow));
    console.log('  Try broadening your search query or removing tag/surface filters.');
    console.log();
    return;
  }

  console.log(
    col(`  Found ${results.length} result(s)`, C.bold) +
    (results.length > limited.length ? col(` — showing top ${limited.length}`, C.dim) : '') +
    (snapshot ? col(' (sorted by host compatibility)', C.dim) : '')
  );
  console.log();

  for (let i = 0; i < limited.length; i++) {
    renderResult(limited[i], i, snapshot);
  }

  // If --preview requested, fetch and show the first result's .scsp intent section
  if (opts.preview && limited.length > 0) {
    const topId = limited[0].id;
    console.log(col(`  Fetching preview for top result: ${topId}…`, C.dim));
    try {
      const raw = await fetchCapability(topId, opts.registryBase);
      // Extract ## Intent section
      const intentMatch = raw.match(/##\s+Intent\s*([\s\S]*?)(?=\n##|\n```yaml|\n---|\s*$)/i);
      if (intentMatch) {
        console.log(col('  ─── Intent preview ───────────────────────────────────', C.dim));
        const intentText = intentMatch[1].trim().split('\n').map((l) => '  ' + l).join('\n');
        console.log(col(intentText, C.dim));
        console.log();
      }
    } catch {
      // ignore preview fetch failure
    }
  }

  if (!opts.query && results.length > limited.length) {
    console.log(col(`  Use 'scsp explore "<query>"' to filter results.`, C.dim));
    console.log();
  }
}
