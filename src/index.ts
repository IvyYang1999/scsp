/**
 * @yytyyf/scsp — Software Capability Sharing Protocol
 *
 * Library entry point. Exports the core programmatic API.
 * The CLI binary is at bin/scsp (dist/cli.js).
 */

// Parser — validate and parse .scsp capability files
export { validateFile, parseCapabilityString, validateFrontmatter, validateConsistency } from './parser';
export type { ParseResult, ParsedCapability, ValidationResult } from './parser';

// Registry — fetch, search, and inspect capabilities
export {
  fetchCapability,
  fetchMetadata,
  fetchIndex,
  search,
  fetchAuthor,
} from './registry';
export type {
  CapabilityMetadata,
  RegistryIndexEntry,
  RegistryIndex,
  SearchResult,
  AuthorInfo,
} from './registry';

// Executor — 6-stage install pipeline
export { install, healthCheck, validateCompat, runProbes } from './executor';
export type {
  InstallOptions,
  ProbeSpec,
  ProbeResult,
  CompatReport,
  DryRunReport,
  VerifyResult,
  HostSnapshot,
} from './executor';

// Snapshot — generate host-snapshot.json
export { generateSnapshot, runSnapshot } from './snapshot';

// Keygen — ed25519 key generation and signing
export { generateKeyPair, signCapability, verifySignature, runKeygen } from './keygen';

// Explorer — semantic capability search
export { explore } from './explore';

// Upgrader — in-place capability upgrade
export { upgrade } from './upgrader';
