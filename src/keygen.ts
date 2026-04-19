import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  KeyObject,
} from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ParsedCapability } from './parser';

// ─── Key Paths ───────────────────────────────────────────────────────────────

function keysDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  return path.join(home, '.scsp', 'keys');
}

function privateKeyPath(name: string): string {
  return path.join(keysDir(), `${name}.private`);
}

function publicKeyPath(name: string): string {
  return path.join(keysDir(), `${name}.public`);
}

function ensureKeysDir(): void {
  const dir = keysDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// ─── Key Generation ──────────────────────────────────────────────────────────

/**
 * Generate an ed25519 key pair.
 * Returns keys as { publicKey: "ed25519:<base64>", privateKey: "ed25519:<base64>" }
 * Stores key files at ~/.scsp/keys/<name>.private and ~/.scsp/keys/<name>.public
 */
export function generateKeyPair(name: string): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  const pubEncoded = `ed25519:${publicKey.toString('base64')}`;
  const privEncoded = `ed25519:${privateKey.toString('base64')}`;

  ensureKeysDir();
  fs.writeFileSync(privateKeyPath(name), privEncoded, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath(name), pubEncoded, { mode: 0o644 });

  return { publicKey: pubEncoded, privateKey: privEncoded };
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Loads a private key from a key file (format: "ed25519:<base64-DER>").
 */
function loadPrivateKey(keyFilePath: string): KeyObject {
  const raw = fs.readFileSync(keyFilePath, 'utf-8').trim();
  const prefix = 'ed25519:';
  if (!raw.startsWith(prefix)) {
    throw new Error(`Key file ${keyFilePath} does not have expected "ed25519:" prefix`);
  }
  const der = Buffer.from(raw.slice(prefix.length), 'base64');
  const { createPrivateKey } = require('crypto');
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/**
 * Loads a public key from a "ed25519:<base64>" string.
 */
function loadPublicKeyFromString(keyStr: string): KeyObject {
  const prefix = 'ed25519:';
  if (!keyStr.startsWith(prefix)) {
    throw new Error(`Public key does not have expected "ed25519:" prefix`);
  }
  const der = Buffer.from(keyStr.slice(prefix.length), 'base64');
  const { createPublicKey } = require('crypto');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * Signs a capability file's frontmatter (excluding the signature field itself).
 * The canonical payload is the YAML frontmatter text with the "signature:" line removed.
 * Returns "ed25519:<base64sig>".
 */
export function signCapability(capabilityPath: string, keyFilePath: string): string {
  const raw = fs.readFileSync(capabilityPath, 'utf-8');

  // Extract frontmatter block (between the first pair of --- delimiters)
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    throw new Error(`No YAML frontmatter found in ${capabilityPath}`);
  }

  // Remove signature line from frontmatter before signing
  const frontmatterText = fmMatch[1]
    .split('\n')
    .filter((line) => !line.startsWith('signature:'))
    .join('\n');

  const privateKey = loadPrivateKey(keyFilePath);
  // ed25519 uses crypto.sign(undefined, ...) — not createSign('SHA512')
  // which throws ERR_CRYPTO_UNSUPPORTED_OPERATION for ed25519 keys.
  const sigBuffer = cryptoSign(undefined, Buffer.from(frontmatterText, 'utf-8'), privateKey);
  return `ed25519:${sigBuffer.toString('base64')}`;
}

/**
 * Verifies the signature on a parsed capability.
 * Uses capability.frontmatter.author.key and capability.frontmatter.signature.
 * Returns false (does not throw) if verification fails.
 */
export function verifySignature(capability: ParsedCapability): boolean {
  try {
    const { frontmatter, raw } = capability;

    const authorKey = (frontmatter.author as Record<string, unknown> | undefined)?.key;
    const signature = frontmatter.signature;

    if (typeof authorKey !== 'string' || typeof signature !== 'string') {
      return false;
    }

    if (!authorKey.startsWith('ed25519:') || !signature.startsWith('ed25519:')) {
      return false;
    }

    // Extract the same frontmatter text used during signing
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return false;

    const frontmatterText = fmMatch[1]
      .split('\n')
      .filter((line) => !line.startsWith('signature:'))
      .join('\n');

    const publicKey = loadPublicKeyFromString(authorKey);
    const sigBuffer = Buffer.from(signature.slice('ed25519:'.length), 'base64');

    // ed25519 uses crypto.verify(undefined, ...) — not createVerify('SHA512')
    return cryptoVerify(
      undefined,
      Buffer.from(frontmatterText, 'utf-8'),
      publicKey,
      sigBuffer
    );
  } catch {
    return false;
  }
}

// ─── Interactive keygen command ───────────────────────────────────────────────

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Interactive key generation: asks for key name (or uses provided name),
 * generates an ed25519 key pair, stores it, and prints the public key.
 */
export async function runKeygen(name: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('\nSCSP Key Generator');
    console.log('==================');
    console.log(`Generating ed25519 key pair for: ${name}\n`);

    const privPath = privateKeyPath(name);
    if (fs.existsSync(privPath)) {
      const overwrite = await prompt(
        rl,
        `Key "${name}" already exists at ${privPath}.\nOverwrite? [y/N]: `
      );
      if (overwrite.trim().toLowerCase() !== 'y') {
        console.log('Aborted.');
        rl.close();
        return;
      }
    }

    const { publicKey, privateKey: _priv } = generateKeyPair(name);

    console.log('\nKey pair generated successfully.\n');
    console.log(`  Private key: ${privateKeyPath(name)}  (mode 600 — keep this secret)`);
    console.log(`  Public key:  ${publicKeyPath(name)}\n`);
    console.log('Your public key (add this to your capability packages as author.key):');
    console.log(`\n  ${publicKey}\n`);
    console.log('Next steps:');
    console.log('  1. Add author.key to your .scsp frontmatter');
    console.log('  2. Run: scsp validate <file>  (signature will be verified)');
    console.log('  3. Sign before publishing: scsp publish <file>  (auto-signs if key found)\n');
  } finally {
    rl.close();
  }
}
