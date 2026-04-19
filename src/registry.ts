// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapabilityMetadata {
  id: string;
  pricing: {
    model: 'free' | 'one-time' | 'subscription';
    amount?: number;
    currency?: string;
  };
  preview_url?: string;
  screenshots?: string[];
  reports: {
    success: number;
    fail: number;
    rollback: number;
    sample_size: number;
  };
  installs: number;
  active_installs: number;
  fork_count: number;
  stack_depth: number;
  compatibility_score: number;
  auto_review: {
    schema_valid: boolean;
    ncv_self_check: 'pass' | 'fail' | 'pending';
    dependency_audit: string;
    signed: boolean;
  };
}

export interface RegistryIndexEntry {
  id: string;
  name: string;
  version: string;
  tags: string[];
  surfaces: {
    entities?: string[];
    logic_domains?: string[];
    ui_areas?: string[];
  };
  author_name: string;
  installs: number;
  active_installs: number;
  compatibility_score: number;
  layer: string;
  description: string;
}

export interface RegistryIndex {
  version: string;
  updated_at: string;
  capabilities: RegistryIndexEntry[];
}

export type SearchResult = RegistryIndexEntry & { relevance_score: number };

export interface AuthorInfo {
  name: string;
  key: string;
  verified: boolean;
  profile_url?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/IvyYang1999/scsp/main/registry';

// Resolve a registry URL — supports:
//   https://...         → remote HTTP fetch
//   file:///path        → local file read
//   ./registry or /abs  → local file read (converted to file://)
function resolveRegistryUrl(base: string, ...parts: string[]): string {
  const tail = parts.join('/');
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${base}/${tail}`;
  }
  // Treat as local path
  const abs = base.startsWith('file://')
    ? base.replace('file://', '')
    : require('path').resolve(process.cwd(), base);
  return `file://${abs}/${tail}`;
}

// ─── HTTP/file helper ─────────────────────────────────────────────────────────

async function httpGet(url: string): Promise<Response> {
  if (url.startsWith('file://')) {
    const fs = await import('fs/promises');
    const filePath = url.replace('file://', '');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return new Response(content, { status: 200 });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'scsp-cli/0.1' },
  });
  return resp;
}

// ─── fetchCapability ──────────────────────────────────────────────────────────

/**
 * Fetch a .scsp file from the registry.
 * GET {registryBase}/capabilities/{id}/{id}.scsp
 * Returns the raw .scsp content. Throws if not found (404).
 */
export async function fetchCapability(
  id: string,
  registryBase: string = DEFAULT_REGISTRY,
): Promise<string> {
  const url = resolveRegistryUrl(registryBase, "capabilities", id, `${id}.scsp`);
  const resp = await httpGet(url);

  if (resp.status === 404) {
    throw new Error(`Capability "${id}" not found in registry (404).`);
  }
  if (!resp.ok) {
    throw new Error(`Registry error fetching "${id}": HTTP ${resp.status}`);
  }

  return resp.text();
}

// ─── fetchMetadata ────────────────────────────────────────────────────────────

/**
 * Fetch metadata for a capability.
 * GET {registryBase}/capabilities/{id}/metadata.json
 */
export async function fetchMetadata(
  id: string,
  registryBase: string = DEFAULT_REGISTRY,
): Promise<CapabilityMetadata> {
  const url = resolveRegistryUrl(registryBase, "capabilities", id, "metadata.json");
  const resp = await httpGet(url);

  if (resp.status === 404) {
    throw new Error(`Metadata for "${id}" not found in registry (404).`);
  }
  if (!resp.ok) {
    throw new Error(`Registry error fetching metadata for "${id}": HTTP ${resp.status}`);
  }

  return resp.json() as Promise<CapabilityMetadata>;
}

// ─── fetchIndex ───────────────────────────────────────────────────────────────

/**
 * Fetch the full registry index.
 * GET {registryBase}/index.json
 */
export async function fetchIndex(
  registryBase: string = DEFAULT_REGISTRY,
): Promise<RegistryIndex> {
  const url = resolveRegistryUrl(registryBase, "index.json");
  const resp = await httpGet(url);

  if (!resp.ok) {
    throw new Error(`Failed to fetch registry index: HTTP ${resp.status}`);
  }

  return resp.json() as Promise<RegistryIndex>;
}

// ─── search ───────────────────────────────────────────────────────────────────

/**
 * Search capabilities in the registry.
 * Downloads index.json, filters by tags/surfaces, ranks by relevance to query.
 */
export async function search(opts: {
  query?: string;
  tags?: string[];
  surfaces?: string[];
  registryBase?: string;
}): Promise<SearchResult[]> {
  const registryBase = opts.registryBase ?? DEFAULT_REGISTRY;
  const index = await fetchIndex(registryBase);

  let results = index.capabilities as SearchResult[];

  // Filter by tags (all specified tags must appear in the capability)
  if (opts.tags && opts.tags.length > 0) {
    const filterTags = opts.tags.map((t) => t.toLowerCase());
    results = results.filter((cap) => {
      const capTags = cap.tags.map((t) => t.toLowerCase());
      return filterTags.every((ft) => capTags.includes(ft));
    });
  }

  // Filter by surfaces (any specified surface must appear)
  if (opts.surfaces && opts.surfaces.length > 0) {
    const filterSurfaces = opts.surfaces.map((s) => s.toLowerCase());
    results = results.filter((cap) => {
      const allSurfaces = [
        ...(cap.surfaces.entities ?? []),
        ...(cap.surfaces.logic_domains ?? []),
        ...(cap.surfaces.ui_areas ?? []),
      ].map((s) => s.toLowerCase());
      return filterSurfaces.some((fs) => allSurfaces.includes(fs));
    });
  }

  // Compute relevance scores
  if (opts.query && opts.query.trim()) {
    const queryTokens = opts.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    results = results.map((cap) => {
      let score = 0;

      // Score fields by weight
      const scoreable = [
        { text: cap.id, weight: 2 },
        { text: cap.name, weight: 3 },
        { text: cap.description, weight: 2 },
        { text: cap.tags.join(' '), weight: 1.5 },
        { text: cap.author_name, weight: 0.5 },
        { text: cap.layer, weight: 0.5 },
        {
          text: [
            ...(cap.surfaces.entities ?? []),
            ...(cap.surfaces.logic_domains ?? []),
            ...(cap.surfaces.ui_areas ?? []),
          ].join(' '),
          weight: 1,
        },
      ];

      for (const { text, weight } of scoreable) {
        const lower = text.toLowerCase();
        for (const token of queryTokens) {
          if (lower.includes(token)) {
            score += weight;
          }
        }
      }

      // Boost by compatibility_score and active_installs (normalize)
      score += cap.compatibility_score * 0.5;
      score += Math.min(cap.active_installs / 1000, 0.5);

      return { ...cap, relevance_score: score };
    });

    // Filter out zero-relevance when a query is given
    results = results.filter((r) => r.relevance_score > 0);

    // Sort by relevance descending
    results.sort((a, b) => b.relevance_score - a.relevance_score);
  } else {
    // No query: sort by active_installs descending, assign nominal score
    results = results
      .map((cap) => ({ ...cap, relevance_score: cap.compatibility_score }))
      .sort((a, b) => b.active_installs - a.active_installs);
  }

  return results;
}

// ─── fetchAuthor ──────────────────────────────────────────────────────────────

/**
 * Get author info by key prefix.
 * GET {registryBase}/AUTHORS.json, find by key prefix match.
 */
export async function fetchAuthor(
  key: string,
  registryBase: string = DEFAULT_REGISTRY,
): Promise<AuthorInfo> {
  const url = resolveRegistryUrl(registryBase, "AUTHORS.json");
  const resp = await httpGet(url);

  if (!resp.ok) {
    throw new Error(`Failed to fetch AUTHORS.json: HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as { authors: AuthorInfo[] };
  const authors = data.authors ?? [];

  // Match by full key or key prefix
  const match = authors.find(
    (a) => a.key === key || a.key.startsWith(key) || key.startsWith(a.key.slice(0, 20)),
  );

  if (!match) {
    throw new Error(`Author with key "${key}" not found in registry.`);
  }

  return match;
}
