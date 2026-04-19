import matter from 'gray-matter';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedCapability {
  frontmatter: Record<string, unknown>;
  sections: {
    intent?: string;
    probes?: unknown;
    ncv?: unknown;
    fixtures?: unknown;
    contracts?: unknown;
    interfaces?: unknown;
  };
  raw: string;
}

export interface ParseResult {
  ok: boolean;
  capability?: ParsedCapability;
  errors?: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
}

// ─── Named Code Block Extraction ─────────────────────────────────────────────

/**
 * Extracts named yaml code blocks from markdown body.
 * Looks for blocks starting with ```yaml <section-name>:
 * e.g. ```yaml probes:\n  - name: ...
 */
function extractNamedBlocks(body: string): Record<string, unknown> {
  const sections: Record<string, unknown> = {};

  // Match ```yaml followed by a section name key (e.g. probes:, ncv:, etc.)
  const blockRegex = /```ya?ml\s+(\w+):\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(body)) !== null) {
    const sectionName = match[1];
    const content = match[2];
    try {
      const parsed = yaml.load(`${sectionName}:\n${content}`);
      if (parsed && typeof parsed === 'object') {
        sections[sectionName] = (parsed as Record<string, unknown>)[sectionName];
      }
    } catch (e) {
      // Try parsing content directly
      try {
        sections[sectionName] = yaml.load(content);
      } catch {
        // ignore unparseable blocks
      }
    }
  }

  return sections;
}

/**
 * Extracts the ## Intent section from the markdown body.
 */
function extractIntent(body: string): string | undefined {
  const intentMatch = body.match(/##\s+Intent\s*\n([\s\S]*?)(?=\n##\s+|\n```|$)/);
  return intentMatch ? intentMatch[1].trim() : undefined;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parses a .scsp capability package file.
 *
 * A .scsp file is a Markdown file with YAML frontmatter (between --- delimiters)
 * and a body containing named yaml code blocks for probes, ncv, contracts, etc.
 */
export function parseCapability(filePath: string): ParseResult {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseCapabilityString(raw);
}

export function parseCapabilityString(raw: string): ParseResult {
  const errors: string[] = [];

  // Parse frontmatter
  let frontmatter: Record<string, unknown>;
  let body: string;

  try {
    const parsed = matter(raw);
    frontmatter = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch (e) {
    return {
      ok: false,
      errors: [`Failed to parse frontmatter: ${(e as Error).message}`],
    };
  }

  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    errors.push('Frontmatter is empty or missing');
  }

  // Extract body sections
  const namedBlocks = extractNamedBlocks(body);
  const intent = extractIntent(body);

  const sections = {
    intent,
    probes: namedBlocks['probes'],
    ncv: namedBlocks['ncv'],
    fixtures: namedBlocks['fixtures'],
    contracts: namedBlocks['contracts'],
    interfaces: namedBlocks['interfaces'],
  };

  return {
    ok: errors.length === 0,
    capability: {
      frontmatter,
      sections,
      raw,
    },
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ─── Schema Validator ─────────────────────────────────────────────────────────

let ajvInstance: Ajv | null = null;
let capabilitySchema: Record<string, unknown> | null = null;

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: true });
    addFormats(ajvInstance);
  }
  return ajvInstance;
}

function getCapabilitySchema(): Record<string, unknown> {
  if (!capabilitySchema) {
    const schemaPath = path.join(__dirname, '..', 'spec', 'scsp-capability.schema.json');
    if (fs.existsSync(schemaPath)) {
      capabilitySchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    } else {
      // Minimal fallback schema for when spec/ isn't available
      capabilitySchema = {
        type: 'object',
        required: ['scsp', 'id', 'name', 'version', 'author', 'created', 'requires', 'components'],
        properties: {
          scsp: { type: 'string' },
          id: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          author: { type: 'object' },
          created: { type: 'string' },
          requires: { type: 'object' },
          components: { type: 'array', minItems: 1 },
        },
      };
    }
  }
  return capabilitySchema!;
}

/**
 * Validates a parsed capability's frontmatter against the JSON schema.
 */
export function validateFrontmatter(frontmatter: Record<string, unknown>): ValidationResult {
  const ajv = getAjv();
  const schema = getCapabilitySchema();
  const validate = ajv.compile(schema);
  const valid = validate(frontmatter);

  if (!valid) {
    const errors = (validate.errors || []).map((e) => {
      const field = e.instancePath || e.schemaPath;
      return `${field}: ${e.message}`;
    });
    return { ok: false, errors };
  }

  return { ok: true };
}

/**
 * Validates cross-section consistency rules:
 * - contracts can only reference interfaces that exist
 * - components referenced in probes must exist
 */
export function validateConsistency(capability: ParsedCapability): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const { frontmatter, sections } = capability;

  // Check that components referenced in probes exist
  const componentIds = new Set(
    ((frontmatter.components as Array<{ id: string }>) || []).map((c) => c.id)
  );

  const probes = sections.probes as Array<{ component?: string; name?: string }> | undefined;
  if (Array.isArray(probes)) {
    for (const probe of probes) {
      if (probe.component && !componentIds.has(probe.component)) {
        errors.push(
          `Probe "${probe.name || '?'}" references unknown component "${probe.component}"`
        );
      }
    }
  }

  // Check that contracts reference valid interfaces
  const interfaces = sections.interfaces as Array<{ name: string }> | undefined;
  const interfaceNames = new Set((interfaces || []).map((i) => i.name));

  const contracts = sections.contracts as
    | Array<{ name?: string; action?: { interface?: string } }>
    | undefined;
  if (Array.isArray(contracts)) {
    for (const contract of contracts) {
      const iface = contract.action?.interface;
      if (iface && !interfaceNames.has(iface)) {
        warnings.push(
          `Contract "${contract.name || '?'}" references interface "${iface}" which is not declared in ## Interfaces`
        );
      }
    }
  }

  // Warn if optional components have no side_effects_isolated declared
  const components = (frontmatter.components as Array<{
    id: string;
    optional?: boolean;
    rollback?: { side_effects_isolated?: boolean };
  }>) || [];
  for (const component of components) {
    if (component.optional && !component.rollback?.side_effects_isolated) {
      warnings.push(
        `Optional component "${component.id}" does not declare rollback.side_effects_isolated — ` +
          `a partial failure will trigger full rollback per V0.1 semantics`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Full validation pipeline: parse → schema validate → consistency check.
 */
export function validateFile(filePath: string): {
  ok: boolean;
  capability?: ParsedCapability;
  parseErrors?: string[];
  schemaErrors?: string[];
  consistencyErrors?: string[];
  warnings?: string[];
} {
  const parseResult = parseCapability(filePath);

  if (!parseResult.ok || !parseResult.capability) {
    return { ok: false, parseErrors: parseResult.errors };
  }

  const { capability } = parseResult;

  const schemaResult = validateFrontmatter(capability.frontmatter);
  const consistencyResult = validateConsistency(capability);

  const ok = schemaResult.ok && consistencyResult.ok;

  return {
    ok,
    capability,
    parseErrors: parseResult.errors,
    schemaErrors: schemaResult.errors,
    consistencyErrors: consistencyResult.errors,
    warnings: consistencyResult.warnings,
  };
}
