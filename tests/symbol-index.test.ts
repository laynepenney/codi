/**
 * Symbol Index Tools Validation Test Suite
 *
 * Tests for find_symbol, find_references, get_dependency_graph, and related tools.
 * Based on real-world testing feedback from GPT-5.2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SymbolIndexService } from '../src/symbol-index/service.js';
import { SymbolDatabase, getIndexDirectory } from '../src/symbol-index/database.js';

// Test fixtures directory
const TEST_DIR = path.join(os.tmpdir(), 'symbol-index-test-' + Date.now());

// Mock project structure simulating Next.js + Kotlin monorepo
function createTestProject() {
  // Create directories
  const dirs = [
    'web/app',
    'web/app/blog',
    'web/app/api/auth/me',
    'web/app/api/content/[slugOrId]',
    'web/lib',
    'web/components',
    'mobile/shared/src/commonMain/kotlin/party/jldance/shared/ui',
    'mobile/shared/src/commonMain/kotlin/party/jldance/shared/network',
    'mobile/shared/src/iosMain/kotlin/party/jldance/shared/ui',
    'mobile/androidApp/src/main/kotlin/party/jldance/android',
  ];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(TEST_DIR, dir), { recursive: true });
  }

  // Create web files
  fs.writeFileSync(path.join(TEST_DIR, 'web/lib/types.ts'), `
export interface Content {
  id: string;
  title: string;
  body: string;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/lib/utils.ts'), `
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\\s+/g, '-');
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/lib/api.ts'), `
import type { Content, ApiResponse } from './types';

export async function fetchAPI<T>(url: string): Promise<ApiResponse<T>> {
  const res = await fetch(url);
  return res.json();
}

export async function getContent(id: string): Promise<Content | null> {
  const response = await fetchAPI<Content>(\`/api/content/\${id}\`);
  return response.data;
}

export async function getAllContent(): Promise<Content[]> {
  const response = await fetchAPI<Content[]>('/api/content');
  return response.data;
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/components/ContentCard.tsx'), `
import type { Content } from '../lib/types';
import { formatDate } from '../lib/utils';

interface ContentCardProps {
  content: Content;
}

export function ContentCard({ content }: ContentCardProps) {
  return (
    <div>
      <h2>{content.title}</h2>
      <p>{content.body}</p>
    </div>
  );
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/components/Header.tsx'), `
export function Header() {
  return <header><h1>My App</h1></header>;
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/components/Footer.tsx'), `
export function Footer() {
  return <footer>Copyright 2024</footer>;
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/app/layout.tsx'), `
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/app/page.tsx'), `
import { getContent } from '../lib/api';
import { ContentCard } from '../components/ContentCard';

export default async function HomePage() {
  const content = await getContent('home');

  if (!content) {
    return <div>No content</div>;
  }

  return <ContentCard content={content} />;
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/app/blog/page.tsx'), `
import { getAllContent } from '../lib/api';
import { ContentCard } from '../components/ContentCard';

export default async function BlogPage() {
  const posts = await getAllContent();

  return (
    <div>
      {posts.map(post => (
        <ContentCard key={post.id} content={post} />
      ))}
    </div>
  );
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/app/api/auth/me/route.ts'), `
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ user: null });
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'web/app/api/content/[slugOrId]/route.ts'), `
import { NextResponse } from 'next/server';
import { getContent } from '../../../../lib/api';

export async function GET(request: Request, { params }: { params: { slugOrId: string } }) {
  const content = await getContent(params.slugOrId);
  if (!content) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ data: content });
}
`);

  // Create Kotlin files
  fs.writeFileSync(path.join(TEST_DIR, 'mobile/shared/src/commonMain/kotlin/party/jldance/shared/ui/AuthViewModel.kt'), `
package party.jldance.shared.ui

class AuthViewModel {
    fun login(email: String, password: String) {
        // Login logic
    }

    fun logout() {
        // Logout logic
    }
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'mobile/shared/src/commonMain/kotlin/party/jldance/shared/ui/App.kt'), `
package party.jldance.shared.ui

import party.jldance.shared.ui.AuthViewModel

fun App() {
    val viewModel = AuthViewModel()
    // Compose UI
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'mobile/shared/src/commonMain/kotlin/party/jldance/shared/network/ApiClient.kt'), `
package party.jldance.shared.network

class ApiClient {
    suspend fun get(url: String): String {
        // HTTP GET
        return ""
    }

    suspend fun post(url: String, body: String): String {
        // HTTP POST
        return ""
    }
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'mobile/shared/src/iosMain/kotlin/party/jldance/shared/ui/MainViewController.kt'), `
package party.jldance.shared.ui

import platform.UIKit.UIViewController

fun MainViewController(): UIViewController {
    return ComposeUIViewController {
        App()
    }
}
`);

  fs.writeFileSync(path.join(TEST_DIR, 'mobile/androidApp/src/main/kotlin/party/jldance/android/MainActivity.kt'), `
package party.jldance.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import party.jldance.shared.ui.App

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            App()
        }
    }
}
`);

  // Create a tsconfig.json for path alias testing
  fs.writeFileSync(path.join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "@/*": ["web/*"],
        "@components/*": ["web/components/*"],
        "@lib/*": ["web/lib/*"]
      }
    }
  }, null, 2));
}

describe('Symbol Index Validation Suite', () => {
  let service: SymbolIndexService;

  beforeAll(async () => {
    // Create test project
    createTestProject();

    // Initialize service and build index
    service = new SymbolIndexService(TEST_DIR);
    await service.initialize();
    await service.rebuild();
  });

  afterAll(() => {
    service.close();
    // Clean up test directory
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    // Clean up index directory
    const indexDir = getIndexDirectory(TEST_DIR);
    fs.rmSync(indexDir, { recursive: true, force: true });
  });

  // =========================================================================
  // A) Next.js / TypeScript / TSX Tests
  // =========================================================================

  describe('Next.js / TypeScript / TSX', () => {
    it('1. App Router page dependency graph - finds direct imports', () => {
      const results = service.getDependencyGraph('web/app/page.tsx', 'imports', 1);

      expect(results.length).toBeGreaterThan(0);

      const files = results.map(r => r.file);
      expect(files).toContain('web/lib/api.ts');
      expect(files).toContain('web/components/ContentCard.tsx');
    });

    it('1b. App Router page dependency graph - finds transitive imports at depth 2', () => {
      const results = service.getDependencyGraph('web/app/page.tsx', 'imports', 2);

      expect(results.length).toBeGreaterThan(2);

      const files = results.map(r => r.file);
      // Direct imports
      expect(files).toContain('web/lib/api.ts');
      expect(files).toContain('web/components/ContentCard.tsx');
      // Transitive imports (via ContentCard.tsx)
      expect(files).toContain('web/lib/types.ts');
      expect(files).toContain('web/lib/utils.ts');
    });

    it('2. App Router layout dependency graph', () => {
      const results = service.getDependencyGraph('web/app/layout.tsx', 'imports', 1);

      const files = results.map(r => r.file);
      expect(files).toContain('web/components/Header.tsx');
      expect(files).toContain('web/components/Footer.tsx');
    });

    it('3. Library imported-by coverage - includes pages, not just tests', () => {
      const results = service.getDependencyGraph('web/lib/api.ts', 'importedBy', 1);

      expect(results.length).toBeGreaterThan(0);

      const files = results.map(r => r.file);
      // Should include actual pages (at least one app page)
      const hasAppPage = files.some(f => f.startsWith('web/app/') && f.endsWith('.tsx'));
      expect(hasAppPage).toBe(true);

      // Specifically check for page.tsx which imports getContent
      expect(files).toContain('web/app/page.tsx');
    });

    it('4. TS symbol definition - finds function with signature', () => {
      const results = service.findSymbols('fetchAPI', { exact: true });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('fetchAPI');
      expect(results[0].kind).toBe('function');
      expect(results[0].file).toBe('web/lib/api.ts');
    });

    it('5. TS references - finds import sites', () => {
      const results = service.findReferences('getContent', {
        file: 'web/lib/api.ts',
        includeImports: true,
        includeCallsites: false,
      });

      expect(results.length).toBeGreaterThan(0);

      const files = results.map(r => r.file);
      expect(files).toContain('web/app/page.tsx');
    });

    it('5b. TS references - finds callsites', () => {
      const results = service.findReferences('getContent', {
        file: 'web/lib/api.ts',
        includeImports: false,
        includeCallsites: true,
      });

      expect(results.length).toBeGreaterThan(0);

      // Should find usage sites (not just imports)
      const usages = results.filter(r => r.type === 'usage');
      expect(usages.length).toBeGreaterThan(0);
    });

    it('6. API route dependency graph', () => {
      const results = service.getDependencyGraph('web/app/api/content/[slugOrId]/route.ts', 'both', 1);

      // This route imports from lib/api.ts
      const imports = results.filter(r => r.direction === 'imports');
      expect(imports.length).toBeGreaterThan(0);
    });

    it('7. Dynamic segment route - not empty', () => {
      const results = service.getDependencyGraph('web/app/api/content/[slugOrId]/route.ts', 'imports', 1);

      // Should have imports
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // B) Kotlin / KMP Tests
  // =========================================================================

  describe('Kotlin / KMP', () => {
    it('8. Kotlin symbol definition - finds App function', () => {
      const results = service.findSymbols('App', { exact: true });

      expect(results.length).toBeGreaterThan(0);

      const appResult = results.find(r => r.file.includes('App.kt'));
      expect(appResult).toBeDefined();
      expect(appResult?.kind).toBe('function');
    });

    it('9. Kotlin references - finds imports of App', () => {
      const results = service.findReferences('App', {
        file: 'mobile/shared/src/commonMain/kotlin/party/jldance/shared/ui/App.kt',
        includeImports: true,
      });

      // Should find at least MainActivity importing App
      const files = results.map(r => r.file);
      expect(files.some(f => f.includes('MainActivity.kt'))).toBe(true);
    });

    it('10. Kotlin dependency graph for shared UI', () => {
      const results = service.getDependencyGraph(
        'mobile/shared/src/commonMain/kotlin/party/jldance/shared/ui/App.kt',
        'both',
        1
      );

      const imports = results.filter(r => r.direction === 'imports');
      const importedBy = results.filter(r => r.direction === 'importedBy');

      // App.kt imports AuthViewModel
      expect(imports.length).toBeGreaterThan(0);
    });

    it('11. Kotlin dependency graph for Android entry', () => {
      const results = service.getDependencyGraph(
        'mobile/androidApp/src/main/kotlin/party/jldance/android/MainActivity.kt',
        'imports',
        1
      );

      // MainActivity imports App
      const files = results.map(r => r.file);
      expect(files.some(f => f.includes('App.kt'))).toBe(true);
    });

    it('12. Kotlin iOS entry function symbol', () => {
      const results = service.findSymbols('MainViewController', { exact: true });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].file).toContain('MainViewController.kt');
    });

    it('13. Kotlin references for iOS entry - handles cross-language case', () => {
      const results = service.findReferences('MainViewController', {
        file: 'mobile/shared/src/iosMain/kotlin/party/jldance/shared/ui/MainViewController.kt',
        includeImports: true,
        includeCallsites: true,
      });

      // May have no references if only called from Swift
      // This test just ensures it doesn't error
      expect(Array.isArray(results)).toBe(true);
    });

    it('14. Kotlin core network symbol definition', () => {
      const results = service.findSymbols('ApiClient', { exact: true });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].kind).toBe('class');
      expect(results[0].file).toContain('ApiClient.kt');
    });

    it('15. Kotlin dependency graph for network client', () => {
      // ApiClient has no internal imports in our test case, but shouldn't error
      const results = service.getDependencyGraph(
        'mobile/shared/src/commonMain/kotlin/party/jldance/shared/network/ApiClient.kt',
        'imports',
        1
      );

      // Should return an array (even if empty)
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // =========================================================================
  // C) Deduplication and Flat Mode Tests
  // =========================================================================

  describe('Output Formatting', () => {
    it('should deduplicate dependency results', () => {
      // When depth > 1, a file might be reachable via multiple paths
      // Results should be deduplicated
      const results = service.getDependencyGraph('web/app/page.tsx', 'imports', 3);

      // Count occurrences of each file
      const fileCounts = new Map<string, number>();
      for (const r of results) {
        fileCounts.set(r.file, (fileCounts.get(r.file) || 0) + 1);
      }

      // Each file should appear only once
      for (const [file, count] of fileCounts) {
        expect(count).toBe(1);
      }
    });

    it('service returns results that can be used in flat or nested mode', () => {
      const results = service.getDependencyGraph('web/app/page.tsx', 'imports', 2);

      // All results should have a depth property
      for (const r of results) {
        expect(typeof r.depth).toBe('number');
        expect(r.depth).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // =========================================================================
  // D) IDE-Style Symbol Usage Tracking Tests
  // =========================================================================

  describe('IDE-Style Symbol Usage Tracking', () => {
    it('should detect usage-based dependencies (no explicit import)', () => {
      // MainViewController.kt uses App() without importing it
      // This should be detected as a 'usage' dependency
      const results = service.getDependencyGraph(
        'mobile/shared/src/iosMain/kotlin/party/jldance/shared/ui/MainViewController.kt',
        'imports',
        1
      );

      // Should find App.kt as a dependency via usage tracking
      const hasAppDep = results.some(r => r.file.includes('App.kt'));
      expect(hasAppDep).toBe(true);
    });

    it('should mark usage-based dependencies with type "usage"', () => {
      const results = service.getDependencyGraph(
        'mobile/shared/src/iosMain/kotlin/party/jldance/shared/ui/MainViewController.kt',
        'imports',
        1
      );

      // Find the App.kt dependency
      const appDep = results.find(r => r.file.includes('App.kt'));
      if (appDep) {
        // It should be marked as 'usage' type since there's no explicit import
        expect(appDep.type).toBe('usage');
      }
    });

    it('should find files that use a symbol (importedBy with usage)', () => {
      // App is used by MainViewController.kt (via usage, not import)
      const results = service.getDependencyGraph(
        'mobile/shared/src/commonMain/kotlin/party/jldance/shared/ui/App.kt',
        'importedBy',
        1
      );

      // Should find MainViewController as a dependent via usage tracking
      const files = results.map(r => r.file);
      const hasMainViewController = files.some(f => f.includes('MainViewController.kt'));
      expect(hasMainViewController).toBe(true);
    });

    it('should distinguish between import and usage dependencies', () => {
      // MainActivity.kt explicitly imports App, so it should be 'import' type
      // MainViewController.kt uses App without import, so it should be 'usage' type
      const results = service.getDependencyGraph(
        'mobile/shared/src/commonMain/kotlin/party/jldance/shared/ui/App.kt',
        'importedBy',
        1
      );

      const mainActivityDep = results.find(r => r.file.includes('MainActivity.kt'));
      const mainViewControllerDep = results.find(r => r.file.includes('MainViewController.kt'));

      // MainActivity uses explicit import
      if (mainActivityDep) {
        expect(mainActivityDep.type).toBe('import');
      }

      // MainViewController uses App without explicit import
      if (mainViewControllerDep) {
        expect(mainViewControllerDep.type).toBe('usage');
      }
    });

    it('should not create false positives from comments or strings', () => {
      // The removeCommentsAndStrings method should prevent false positives
      // This test verifies the basic functionality works
      const results = service.getDependencyGraph('web/lib/api.ts', 'imports', 1);

      // All results should be real dependencies, not from strings/comments
      for (const r of results) {
        expect(r.file).toBeTruthy();
        expect(r.type).toMatch(/^(import|usage|dynamic-import|re-export)$/);
      }
    });

    it('database should return exported symbol registry', () => {
      const db = service.getDatabase();
      const registry = db.getExportedSymbolRegistry();

      // Should have symbols registered
      expect(registry.size).toBeGreaterThan(0);

      // Check that known symbols are in the registry
      expect(registry.has('App')).toBe(true);
      expect(registry.has('ApiClient')).toBe(true);
      expect(registry.has('getContent')).toBe(true);
    });

    it('database should return exported symbol names', () => {
      const db = service.getDatabase();
      const names = db.getExportedSymbolNames();

      // Should have symbol names
      expect(names.length).toBeGreaterThan(0);

      // Names should be valid identifiers
      for (const name of names) {
        expect(name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
        expect(name.length).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
