import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as yaml from 'js-yaml';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedRuntime {
  language: 'node' | 'python' | 'go' | 'ruby' | 'java' | 'unknown';
  frameworks: string[];
  packageName?: string;
  packageDescription?: string;
  packageVersion?: string;
}

interface DetectedSurfaces {
  entities: string[];
  logicDomains: string[];
  uiAreas: string[];
}

interface DetectedDirectories {
  routes: string[];
  models: string[];
  components: string[];
  tests: string[];
}

interface SuggestedAnchors {
  hooks: Array<{ id: string; description: string }>;
  slots: Array<{ id: string; description: string }>;
}

interface ScanResult {
  runtime: DetectedRuntime;
  directories: DetectedDirectories;
  surfaces: DetectedSurfaces;
  suggestedAnchors: SuggestedAnchors;
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function detectRuntime(cwd: string): DetectedRuntime {
  const result: DetectedRuntime = { language: 'unknown', frameworks: [] };

  // Node / TypeScript
  if (exists(path.join(cwd, 'package.json'))) {
    result.language = 'node';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      result.packageName = pkg.name ?? undefined;
      result.packageDescription = pkg.description ?? undefined;
      result.packageVersion = pkg.version ?? undefined;

      // Merge all deps to detect frameworks
      const allDeps: Record<string, string> = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      const frameworkMap: Record<string, string> = {
        express: 'express',
        fastify: 'fastify',
        koa: 'koa',
        next: 'nextjs',
        nuxt: 'nuxt',
        '@nuxtjs/composition-api': 'nuxt',
        react: 'react',
        vue: 'vue',
        angular: 'angular',
        svelte: 'svelte',
        hapi: 'hapi',
        restify: 'restify',
        nest: 'nestjs',
        '@nestjs/core': 'nestjs',
      };

      for (const [dep, framework] of Object.entries(frameworkMap)) {
        if (dep in allDeps && !result.frameworks.includes(framework)) {
          result.frameworks.push(framework);
        }
      }
    } catch {
      // ignore JSON parse errors
    }
  } else if (
    exists(path.join(cwd, 'requirements.txt')) ||
    exists(path.join(cwd, 'pyproject.toml')) ||
    exists(path.join(cwd, 'setup.py'))
  ) {
    result.language = 'python';

    // Check for Python frameworks in requirements.txt
    const reqFile = path.join(cwd, 'requirements.txt');
    if (exists(reqFile)) {
      const content = fs.readFileSync(reqFile, 'utf-8').toLowerCase();
      if (content.includes('django')) result.frameworks.push('django');
      if (content.includes('flask')) result.frameworks.push('flask');
      if (content.includes('fastapi')) result.frameworks.push('fastapi');
      if (content.includes('tornado')) result.frameworks.push('tornado');
      if (content.includes('aiohttp')) result.frameworks.push('aiohttp');
      if (content.includes('starlette')) result.frameworks.push('starlette');
    }
    const pyprojectFile = path.join(cwd, 'pyproject.toml');
    if (exists(pyprojectFile)) {
      const content = fs.readFileSync(pyprojectFile, 'utf-8').toLowerCase();
      if (content.includes('django')) result.frameworks.push('django');
      if (content.includes('flask')) result.frameworks.push('flask');
      if (content.includes('fastapi')) result.frameworks.push('fastapi');
    }
  } else if (exists(path.join(cwd, 'go.mod'))) {
    result.language = 'go';
    const content = fs.readFileSync(path.join(cwd, 'go.mod'), 'utf-8').toLowerCase();
    if (content.includes('gin-gonic')) result.frameworks.push('gin');
    if (content.includes('echo')) result.frameworks.push('echo');
    if (content.includes('fiber')) result.frameworks.push('fiber');
    if (content.includes('gorilla/mux')) result.frameworks.push('gorilla');
  } else if (exists(path.join(cwd, 'Gemfile'))) {
    result.language = 'ruby';
    const content = fs.readFileSync(path.join(cwd, 'Gemfile'), 'utf-8').toLowerCase();
    if (content.includes('rails')) result.frameworks.push('rails');
    if (content.includes('sinatra')) result.frameworks.push('sinatra');
    if (content.includes('hanami')) result.frameworks.push('hanami');
  } else if (exists(path.join(cwd, 'pom.xml')) || exists(path.join(cwd, 'build.gradle'))) {
    result.language = 'java';
    const pomFile = path.join(cwd, 'pom.xml');
    if (exists(pomFile)) {
      const content = fs.readFileSync(pomFile, 'utf-8').toLowerCase();
      if (content.includes('spring')) result.frameworks.push('spring');
      if (content.includes('quarkus')) result.frameworks.push('quarkus');
      if (content.includes('micronaut')) result.frameworks.push('micronaut');
    }
  }

  return result;
}

function detectDirectories(cwd: string): DetectedDirectories {
  const routeCandidates = [
    'src/routes', 'src/controllers', 'src/routers',
    'app/routes', 'app/controllers', 'routes', 'controllers',
    'pages/api', 'app/api', 'src/pages/api',
    'src/handlers', 'handlers',
  ];
  const modelCandidates = [
    'prisma', 'src/models', 'src/entities', 'src/schemas',
    'app/models', 'models', 'db/models',
    'src/db', 'database/models',
  ];
  const componentCandidates = [
    'src/components', 'src/client/components',
    'components', 'app/components',
    'src/views', 'views', 'src/ui',
    'src/pages', 'pages', 'app/pages',
  ];
  const testCandidates = [
    'tests', 'test', 'spec', '__tests__',
    'src/__tests__', 'src/test',
    '__test__', 'e2e', 'integration',
  ];

  const check = (candidates: string[]): string[] =>
    candidates.filter((d) => exists(path.join(cwd, d)));

  return {
    routes: check(routeCandidates),
    models: check(modelCandidates),
    components: check(componentCandidates),
    tests: check(testCandidates),
  };
}

// ─── Entity detection by language ────────────────────────────────────────────

function scanEntitiesFromFiles(
  cwd: string,
  modelDirs: string[],
  language: string
): string[] {
  const entities: Set<string> = new Set();

  for (const dir of modelDirs) {
    const fullDir = path.join(cwd, dir);
    if (!exists(fullDir) || !fs.statSync(fullDir).isDirectory()) continue;

    let files: string[] = [];
    try {
      files = fs.readdirSync(fullDir).filter((f) => {
        if (language === 'node') return f.endsWith('.ts') || f.endsWith('.js');
        if (language === 'python') return f.endsWith('.py');
        if (language === 'go') return f.endsWith('.go');
        if (language === 'ruby') return f.endsWith('.rb');
        return true;
      });
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(fullDir, file);
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      if (language === 'node') {
        // TypeScript/JS: match export class Foo, export interface Foo, class Foo extends
        const classMatches = content.matchAll(
          /(?:export\s+)?(?:abstract\s+)?(?:class|interface)\s+([A-Z][A-Za-z0-9]*)/g
        );
        for (const m of classMatches) {
          if (!m[1].endsWith('Props') && !m[1].endsWith('Options') && !m[1].endsWith('Error')) {
            entities.add(m[1]);
          }
        }
        // Also look for Prisma model patterns: model Foo {
        const prismaMatches = content.matchAll(/^model\s+([A-Z][A-Za-z0-9]*)\s*\{/gm);
        for (const m of prismaMatches) {
          entities.add(m[1]);
        }
      } else if (language === 'python') {
        // Python: class Foo(Model), class Foo(Base), class Foo(db.Model)
        const pyMatches = content.matchAll(
          /^class\s+([A-Z][A-Za-z0-9]*)\s*(?:\([^)]*(?:Model|Base|Document|Schema)[^)]*\))?:/gm
        );
        for (const m of pyMatches) {
          entities.add(m[1]);
        }
      } else if (language === 'go') {
        // Go: type Foo struct {
        const goMatches = content.matchAll(/^type\s+([A-Z][A-Za-z0-9]*)\s+struct\s*\{/gm);
        for (const m of goMatches) {
          entities.add(m[1]);
        }
      } else if (language === 'ruby') {
        // Ruby on Rails: class Foo < ApplicationRecord
        const rbMatches = content.matchAll(
          /^class\s+([A-Z][A-Za-z0-9:]*)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base|Base)/gm
        );
        for (const m of rbMatches) {
          entities.add(m[1].replace('::', '_'));
        }
      }
    }
  }

  // Also scan prisma schema if present
  const prismaSchema = path.join(cwd, 'prisma', 'schema.prisma');
  if (exists(prismaSchema)) {
    try {
      const content = fs.readFileSync(prismaSchema, 'utf-8');
      const matches = content.matchAll(/^model\s+([A-Z][A-Za-z0-9]*)\s*\{/gm);
      for (const m of matches) {
        entities.add(m[1]);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(entities).slice(0, 20); // cap at 20
}

// ─── Logic domain detection ───────────────────────────────────────────────────

const KNOWN_DOMAINS = [
  'auth', 'authentication', 'authorization',
  'payment', 'billing', 'subscription',
  'notification', 'email', 'messaging',
  'user', 'users', 'account', 'accounts',
  'admin', 'administration',
  'analytics', 'reporting', 'metrics',
  'search',
  'upload', 'media', 'storage', 'files',
  'webhook', 'webhooks',
  'cart', 'checkout', 'order', 'orders',
  'product', 'products', 'catalog',
  'content', 'cms',
  'blog', 'post', 'article',
  'workflow', 'approval',
  'integration', 'api',
  'session', 'token',
  'role', 'permission', 'acl',
];

const DOMAIN_NORMALIZE: Record<string, string> = {
  authentication: 'auth',
  authorization: 'auth',
  users: 'user',
  accounts: 'account',
  administration: 'admin',
  orders: 'order',
  products: 'product',
  webhooks: 'webhook',
  files: 'storage',
  upload: 'storage',
  media: 'storage',
  email: 'notification',
  messaging: 'notification',
  subscription: 'billing',
  analytics: 'reporting',
  metrics: 'reporting',
  article: 'content',
  blog: 'content',
  post: 'content',
  cms: 'content',
  acl: 'permission',
  role: 'permission',
  session: 'auth',
  token: 'auth',
  checkout: 'payment',
  cart: 'payment',
};

function detectLogicDomains(cwd: string, dirs: DetectedDirectories): string[] {
  const domains: Set<string> = new Set();

  const allDirs = [...dirs.routes, ...dirs.models];
  for (const dir of allDirs) {
    const fullDir = path.join(cwd, dir);
    if (!exists(fullDir) || !fs.statSync(fullDir).isDirectory()) continue;
    try {
      const files = fs.readdirSync(fullDir);
      for (const file of files) {
        const base = path.basename(file, path.extname(file)).toLowerCase();
        if (KNOWN_DOMAINS.includes(base)) {
          const normalized = DOMAIN_NORMALIZE[base] ?? base;
          domains.add(normalized);
        }
      }
    } catch {
      // ignore
    }
  }

  // Heuristic: if no domains found from directories, check file names in root src/
  if (domains.size === 0) {
    const srcDir = path.join(cwd, 'src');
    if (exists(srcDir)) {
      try {
        const walkFiles = (d: string, depth: number): void => {
          if (depth > 2) return;
          for (const entry of fs.readdirSync(d)) {
            const full = path.join(d, entry);
            const base = entry.replace(/\.(ts|js|py|rb|go)$/, '').toLowerCase();
            if (KNOWN_DOMAINS.includes(base)) {
              domains.add(DOMAIN_NORMALIZE[base] ?? base);
            }
            try {
              if (fs.statSync(full).isDirectory()) walkFiles(full, depth + 1);
            } catch {
              // ignore
            }
          }
        };
        walkFiles(srcDir, 0);
      } catch {
        // ignore
      }
    }
  }

  return Array.from(domains);
}

// ─── UI area detection ────────────────────────────────────────────────────────

const KNOWN_UI_AREAS = [
  'settings', 'dashboard', 'nav', 'navigation', 'navbar',
  'profile', 'account', 'admin', 'header', 'footer',
  'sidebar', 'modal', 'auth', 'login', 'register', 'signup',
  'home', 'landing', 'onboarding',
  'checkout', 'cart', 'orders', 'billing',
  'search', 'results',
  'calendar', 'schedule',
  'reports', 'analytics',
  'documents', 'files', 'upload',
  'notifications', 'messages', 'inbox',
  'help', 'support',
];

const UI_NORMALIZE: Record<string, string> = {
  navigation: 'nav',
  navbar: 'nav',
  login: 'auth',
  register: 'auth',
  signup: 'auth',
  account: 'profile',
  billing: 'settings',
  orders: 'dashboard',
  results: 'search',
  schedule: 'calendar',
  reports: 'analytics',
  files: 'documents',
  upload: 'documents',
  messages: 'notifications',
  inbox: 'notifications',
  support: 'help',
};

function detectUIAreas(cwd: string, dirs: DetectedDirectories): string[] {
  const areas: Set<string> = new Set();

  for (const dir of dirs.components) {
    const fullDir = path.join(cwd, dir);
    if (!exists(fullDir) || !fs.statSync(fullDir).isDirectory()) continue;
    try {
      const entries = fs.readdirSync(fullDir);
      for (const entry of entries) {
        const base = entry.toLowerCase().replace(/\.(tsx?|jsx?|vue|svelte|py|rb)$/, '');
        if (KNOWN_UI_AREAS.includes(base)) {
          areas.add(UI_NORMALIZE[base] ?? base);
        }
        // Also check sub-directories
        const full = path.join(fullDir, entry);
        try {
          if (fs.statSync(full).isDirectory() && KNOWN_UI_AREAS.includes(base)) {
            areas.add(UI_NORMALIZE[base] ?? base);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(areas);
}

// ─── Anchor suggestions ───────────────────────────────────────────────────────

interface AnchorTemplate {
  id: string;
  description: string;
}

const FRAMEWORK_HOOK_SUGGESTIONS: Record<string, AnchorTemplate[]> = {
  express: [
    {
      id: 'auth_password_login_post_verify',
      description: 'Fires after password is verified, before session is created.',
    },
    {
      id: 'auth_register_pre_save',
      description: 'Fires before a new user is saved during registration.',
    },
    {
      id: 'request_pre_handler',
      description: 'Fires before every route handler (after auth middleware).',
    },
  ],
  fastify: [
    {
      id: 'request_on_send',
      description: 'Fires before the response is sent.',
    },
    {
      id: 'auth_pre_handler',
      description: 'Fires in the preHandler hook for auth checks.',
    },
  ],
  django: [
    {
      id: 'user_pre_save',
      description: 'Django pre_save signal on User model.',
    },
    {
      id: 'request_middleware_pre_process',
      description: 'Fires in process_request for every incoming request.',
    },
  ],
  flask: [
    {
      id: 'request_before',
      description: 'Fires in before_request hook.',
    },
    {
      id: 'auth_login_post_verify',
      description: 'Fires after login credentials are verified.',
    },
  ],
  fastapi: [
    {
      id: 'request_middleware_pre',
      description: 'Fires before each request in ASGI middleware.',
    },
    {
      id: 'auth_dependency_pre',
      description: 'Fires in the auth dependency before route execution.',
    },
  ],
  rails: [
    {
      id: 'user_before_create',
      description: 'ActiveRecord before_create callback on User.',
    },
    {
      id: 'controller_before_action',
      description: 'Fires in before_action in ApplicationController.',
    },
  ],
  nextjs: [
    {
      id: 'middleware_pre_route',
      description: 'Fires in Next.js middleware before routing.',
    },
    {
      id: 'api_route_pre_handler',
      description: 'Fires before API route handlers.',
    },
  ],
};

const AUTH_HOOKS: AnchorTemplate[] = [
  {
    id: 'auth_password_login_post_verify',
    description: 'Fires after password is verified, before session is created.',
  },
  {
    id: 'auth_logout_pre_destroy',
    description: 'Fires before session is destroyed on logout.',
  },
  {
    id: 'auth_register_pre_save',
    description: 'Fires before new user is saved during registration.',
  },
];

const NOTIFICATION_HOOKS: AnchorTemplate[] = [
  {
    id: 'notification_send_pre_dispatch',
    description: 'Fires before a notification is dispatched (email, push, in-app).',
  },
];

const PAYMENT_HOOKS: AnchorTemplate[] = [
  {
    id: 'payment_charge_pre_submit',
    description: 'Fires before a payment charge is submitted.',
  },
  {
    id: 'payment_webhook_received',
    description: 'Fires when a payment provider webhook is received.',
  },
];

const FRAMEWORK_SLOT_SUGGESTIONS: Record<string, AnchorTemplate[]> = {
  react: [
    {
      id: 'settings::security-section',
      description: 'Slot within the Settings page, Security section.',
    },
    {
      id: 'dashboard::sidebar-widgets',
      description: 'Slot in dashboard sidebar for widgets.',
    },
    {
      id: 'nav::user-menu-items',
      description: 'Slot for extra items in the user dropdown menu.',
    },
  ],
  nextjs: [
    {
      id: 'settings::security-section',
      description: 'Slot within the Settings page, Security section.',
    },
    {
      id: 'nav::user-menu-items',
      description: 'Slot for extra items in the user dropdown menu.',
    },
    {
      id: 'layout::before-main',
      description: 'Slot before the main content area in the root layout.',
    },
  ],
  nuxt: [
    {
      id: 'settings::security-section',
      description: 'Slot within the Settings page, Security section.',
    },
    {
      id: 'nav::user-menu-items',
      description: 'Slot for extra items in the user dropdown menu.',
    },
  ],
  vue: [
    {
      id: 'settings::security-section',
      description: 'Slot within the Settings page, Security section.',
    },
    {
      id: 'dashboard::sidebar-widgets',
      description: 'Slot in dashboard sidebar for widgets.',
    },
  ],
};

function suggestAnchors(runtime: DetectedRuntime, surfaces: DetectedSurfaces): SuggestedAnchors {
  const hooks: AnchorTemplate[] = [];
  const slots: AnchorTemplate[] = [];
  const hookIds = new Set<string>();
  const slotIds = new Set<string>();

  const addHook = (h: AnchorTemplate): void => {
    if (!hookIds.has(h.id)) {
      hooks.push(h);
      hookIds.add(h.id);
    }
  };
  const addSlot = (s: AnchorTemplate): void => {
    if (!slotIds.has(s.id)) {
      slots.push(s);
      slotIds.add(s.id);
    }
  };

  // Framework-specific hooks
  for (const fw of runtime.frameworks) {
    for (const h of FRAMEWORK_HOOK_SUGGESTIONS[fw] ?? []) addHook(h);
    for (const s of FRAMEWORK_SLOT_SUGGESTIONS[fw] ?? []) addSlot(s);
  }

  // Domain-specific hooks
  if (surfaces.logicDomains.includes('auth')) {
    for (const h of AUTH_HOOKS) addHook(h);
  }
  if (surfaces.logicDomains.includes('notification')) {
    for (const h of NOTIFICATION_HOOKS) addHook(h);
  }
  if (surfaces.logicDomains.includes('payment') || surfaces.logicDomains.includes('billing')) {
    for (const h of PAYMENT_HOOKS) addHook(h);
  }

  // UI-area-specific slots
  if (surfaces.uiAreas.includes('settings')) {
    addSlot({
      id: 'settings::security-section',
      description: 'Slot within the Settings page, Security section.',
    });
    addSlot({
      id: 'settings::profile-section',
      description: 'Slot within the Settings page, Profile section.',
    });
  }
  if (surfaces.uiAreas.includes('dashboard')) {
    addSlot({
      id: 'dashboard::sidebar-widgets',
      description: 'Slot in dashboard sidebar for injecting widgets.',
    });
    addSlot({
      id: 'dashboard::pending-actions',
      description: 'Slot for surfacing items requiring user attention.',
    });
  }
  if (surfaces.uiAreas.includes('nav')) {
    addSlot({
      id: 'nav::user-menu-items',
      description: 'Slot for additional items in the authenticated user menu.',
    });
  }

  return { hooks, slots };
}

// ─── Full scan ────────────────────────────────────────────────────────────────

function scanProject(cwd: string): ScanResult {
  const runtime = detectRuntime(cwd);
  const directories = detectDirectories(cwd);
  const entities = scanEntitiesFromFiles(cwd, directories.models, runtime.language);
  const logicDomains = detectLogicDomains(cwd, directories);
  const uiAreas = detectUIAreas(cwd, directories);
  const surfaces: DetectedSurfaces = { entities, logicDomains, uiAreas };
  const suggestedAnchors = suggestAnchors(runtime, surfaces);

  return { runtime, directories, surfaces, suggestedAnchors };
}

// ─── Interactive prompt helpers ───────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function askWithDefault(
  rl: readline.Interface,
  question: string,
  defaultValue: string
): Promise<string> {
  const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  const answer = await ask(rl, display);
  return answer || defaultValue;
}

async function confirmList(
  rl: readline.Interface,
  label: string,
  items: string[]
): Promise<string[]> {
  if (items.length === 0) {
    console.log(`  ${label}: (none detected)`);
    const extra = await ask(rl, `  Add ${label} (comma-separated, or Enter to skip): `);
    return extra ? extra.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  console.log(`  ${label}: ${items.join(', ')}`);
  const answer = await ask(
    rl,
    `  Edit ${label}? Enter comma-separated list to replace, or press Enter to keep: `
  );
  if (answer) {
    return answer.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const extra = await ask(rl, `  Add more ${label} (comma-separated, or Enter to skip): `);
  if (extra) {
    return [...items, ...extra.split(',').map((s) => s.trim()).filter(Boolean)];
  }
  return items;
}

type AnchorKind = 'hooks' | 'slots';

async function confirmAnchors(
  rl: readline.Interface,
  kind: AnchorKind,
  suggested: AnchorTemplate[]
): Promise<AnchorTemplate[]> {
  if (suggested.length === 0) {
    console.log(`  No ${kind} suggested.`);
    const add = await ask(
      rl,
      `  Add ${kind} manually? Enter "id: description" pairs (one per line, blank to finish):\n  `
    );
    if (!add) return [];
    // Simple: just accept blank-terminated input
    return [];
  }

  console.log(`\n  Suggested ${kind}:`);
  suggested.forEach((a, i) => {
    console.log(`    [${i + 1}] ${a.id}`);
    console.log(`        ${a.description}`);
  });

  const answer = await ask(
    rl,
    `\n  Keep all ${kind}? [Y/n/list numbers to remove, e.g. "2,3"]: `
  );

  if (!answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    return suggested;
  }

  // Remove by numbers
  const toRemove = new Set(
    answer
      .split(',')
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((n) => !isNaN(n))
  );
  return suggested.filter((_, i) => !toRemove.has(i));
}

// ─── Manifest generation ──────────────────────────────────────────────────────

function buildManifest(
  projectName: string,
  version: string,
  repo: string,
  architecture: string,
  surfaces: DetectedSurfaces,
  confirmedHooks: AnchorTemplate[],
  confirmedSlots: AnchorTemplate[],
  entities: string[],
  runtime: DetectedRuntime,
  dirs: DetectedDirectories
): Record<string, unknown> {
  // Build entity anchors from detected entities
  const entityAnchors = entities.map((e) => ({
    id: `entity::${e}`,
    description: `Extensible data model entity: ${e}.`,
    core_fields: ['id', 'created_at', 'updated_at'],
  }));

  const manifest: Record<string, unknown> = {
    'scsp-manifest': '0.1.0',
    name: projectName,
    version,
    repo: repo || 'https://github.com/your-org/your-repo',
    surfaces: {
      entities: surfaces.entities,
      ui_areas: surfaces.uiAreas,
      logic_domains: surfaces.logicDomains,
    },
    anchors: {
      hooks: confirmedHooks.map((h) => ({ id: h.id, description: h.description })),
      slots: confirmedSlots.map((s) => ({ id: s.id, description: s.description })),
      entities: entityAnchors,
    },
  };

  // Build hints block
  const hintsParts: Record<string, unknown> = {};

  if (architecture) {
    hintsParts.architecture = architecture;
  }

  const conventions: Record<string, string> = {};
  if (dirs.routes.length > 0) {
    conventions.routes = `Route files in: ${dirs.routes.join(', ')}`;
  }
  if (dirs.models.length > 0) {
    conventions.models = `Model files in: ${dirs.models.join(', ')}. Language: ${runtime.language}`;
  }
  if (dirs.components.length > 0) {
    conventions.components = `Components in: ${dirs.components.join(', ')}`;
  }
  if (dirs.tests.length > 0) {
    conventions.tests = `Tests in: ${dirs.tests.join(', ')}`;
  }

  if (Object.keys(conventions).length > 0) {
    hintsParts.conventions = conventions;
  }

  if (Object.keys(hintsParts).length > 0) {
    manifest.hints = hintsParts;
  }

  return manifest;
}

// ─── Main runInit ─────────────────────────────────────────────────────────────

export async function runInit(cwd: string): Promise<void> {
  const resolvedCwd = path.resolve(cwd);

  console.log('\nSCSP Init — Project Scanner');
  console.log('============================');
  console.log(`Scanning: ${resolvedCwd}\n`);

  // ── 1. Scan ──
  const scan = scanProject(resolvedCwd);
  const { runtime, directories, surfaces, suggestedAnchors } = scan;

  console.log('Detected:');
  console.log(`  Language:   ${runtime.language}`);
  console.log(`  Frameworks: ${runtime.frameworks.length > 0 ? runtime.frameworks.join(', ') : '(none detected)'}`);
  if (runtime.packageName) console.log(`  Package:    ${runtime.packageName}`);
  console.log('');
  console.log('Directories found:');
  if (directories.routes.length)    console.log(`  Routes:     ${directories.routes.join(', ')}`);
  if (directories.models.length)    console.log(`  Models:     ${directories.models.join(', ')}`);
  if (directories.components.length) console.log(`  Components: ${directories.components.join(', ')}`);
  if (directories.tests.length)     console.log(`  Tests:      ${directories.tests.join(', ')}`);
  console.log('');
  console.log('Surfaces detected:');
  console.log(`  Entities:       ${surfaces.entities.length > 0 ? surfaces.entities.join(', ') : '(none)'}`);
  console.log(`  Logic domains:  ${surfaces.logicDomains.length > 0 ? surfaces.logicDomains.join(', ') : '(none)'}`);
  console.log(`  UI areas:       ${surfaces.uiAreas.length > 0 ? surfaces.uiAreas.join(', ') : '(none)'}`);
  console.log('');

  // ── 2. Interactive prompts ──
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('Please confirm project details:');
    console.log('--------------------------------');

    const defaultName =
      runtime.packageName ?? path.basename(resolvedCwd);
    const projectName = await askWithDefault(rl, 'Project name', defaultName);
    const version = await askWithDefault(rl, 'Version', runtime.packageVersion ?? '1.0.0');
    const repo = await askWithDefault(rl, 'Repository URL', 'https://github.com/your-org/your-repo');

    console.log('\nSurfaces (these describe your app\'s stable extension points):');

    const confirmedEntities = await confirmList(rl, 'Entities', surfaces.entities);
    const confirmedDomains = await confirmList(rl, 'Logic domains', surfaces.logicDomains);
    const confirmedUIAreas = await confirmList(rl, 'UI areas', surfaces.uiAreas);

    const confirmedSurfaces: DetectedSurfaces = {
      entities: confirmedEntities,
      logicDomains: confirmedDomains,
      uiAreas: confirmedUIAreas,
    };

    console.log('\nAnchor suggestions:');
    const confirmedHooks = await confirmAnchors(rl, 'hooks', suggestedAnchors.hooks);
    const confirmedSlots = await confirmAnchors(rl, 'slots', suggestedAnchors.slots);

    console.log('\nArchitecture description:');
    const defaultArch = runtime.frameworks.length > 0
      ? `${runtime.language} app using ${runtime.frameworks.join(', ')}`
      : `${runtime.language} application`;
    const architecture = await askWithDefault(
      rl,
      'Describe your architecture (e.g. "Express REST API + React SPA")',
      defaultArch
    );

    // ── 3. Generate files ──
    console.log('\nGenerating files...');

    const manifest = buildManifest(
      projectName,
      version,
      repo,
      architecture,
      confirmedSurfaces,
      confirmedHooks,
      confirmedSlots,
      confirmedEntities,
      runtime,
      directories
    );

    const manifestPath = path.join(resolvedCwd, 'scsp-manifest.yaml');
    const devguidePath = path.join(resolvedCwd, 'scsp-devguide.yaml');

    // Write manifest
    const manifestHeader = [
      '# scsp-manifest.yaml',
      `# Generated by scsp init on ${new Date().toISOString().slice(0, 10)}`,
      '# Edit this file to refine your project\'s extension surface.',
      '# See: https://scsp.dev/docs/manifest',
      '',
    ].join('\n');

    const manifestYaml = manifestHeader + yaml.dump(manifest, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
    });

    fs.writeFileSync(manifestPath, manifestYaml, 'utf-8');
    console.log(`  Created: ${manifestPath}`);

    // Write devguide stub
    const devguideContent = [
      '# scsp-devguide.yaml',
      `# Generated by scsp init on ${new Date().toISOString().slice(0, 10)}`,
      '# Fill in the TODOs to help AI agents understand your codebase conventions.',
      '# See: https://scsp.dev/docs/devguide',
      '',
      "scsp-devguide: \"0.1\"",
      '',
      'design_system:',
      '  philosophy: "TODO: describe your design philosophy (e.g. Tailwind utility-first, BEM CSS, component library)"',
      '  rules: []',
      '',
      'code_conventions:',
      `  architecture: "${architecture.replace(/"/g, '\\"')}"`,
      '  anti_patterns: []',
      '',
      'iteration_guide:',
      '  how_to_add_feature: "TODO: describe the steps to add a new feature (e.g. model → migration → route → test)"',
      '  common_pitfalls: []',
    ].join('\n') + '\n';

    fs.writeFileSync(devguidePath, devguideContent, 'utf-8');
    console.log(`  Created: ${devguidePath}`);

    // ── 4. Next steps ──
    console.log('\nDone! Next steps:');
    console.log('');
    console.log('  1. Review and edit scsp-manifest.yaml');
    console.log('     Fill in anchor descriptions, add more hooks/slots as you identify them.');
    console.log('');
    console.log('  2. Fill in scsp-devguide.yaml');
    console.log('     Help AI agents understand your conventions and anti-patterns.');
    console.log('');
    console.log('  3. Generate a host-snapshot.json (for live capability compatibility checks):');
    console.log('     Run the following in your project root:');
    console.log('');
    console.log('       node -e "');
    console.log("         const m = require('./scsp-manifest.yaml');  // or parse with js-yaml");
    console.log("         const snapshot = {");
    console.log("           generated_at: new Date().toISOString(),");
    console.log("           manifest: m,");
    console.log("           installed_capabilities: []");
    console.log("         };");
    console.log("         require('fs').writeFileSync('host-snapshot.json', JSON.stringify(snapshot, null, 2));");
    console.log('       "');
    console.log('');
    console.log('     Or see: https://scsp.dev/docs/host-snapshot');
    console.log('');
    console.log('  4. Generate a signing key pair:');
    console.log('       scsp keygen <your-name>');
    console.log('');
    console.log('  5. Create your first capability package:');
    console.log('       scsp pack');
    console.log('');
  } finally {
    rl.close();
  }
}
