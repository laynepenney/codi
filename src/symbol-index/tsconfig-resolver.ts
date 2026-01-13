/**
 * TypeScript Configuration Resolver
 *
 * Parses tsconfig.json files and resolves path aliases.
 * Handles extends chains, baseUrl, and paths mappings.
 */

import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

/**
 * Path alias mappings from tsconfig.json
 * Key is the alias pattern (e.g., "@/*"), value is array of paths to try
 */
export interface TsConfigPaths {
  [alias: string]: string[];
}

/**
 * Resolved TypeScript configuration
 */
export interface ResolvedTsConfig {
  /** Base directory for non-relative imports */
  baseUrl?: string;
  /** Path alias mappings */
  paths?: TsConfigPaths;
  /** Root directory of the tsconfig.json file */
  configDir: string;
}

/**
 * Cache of parsed tsconfig files
 */
const configCache = new Map<string, ResolvedTsConfig | null>();

/**
 * Load and parse a tsconfig.json file
 * Follows extends chains and merges configurations
 */
export function loadTsConfig(projectRoot: string): ResolvedTsConfig | null {
  // Check cache first
  const cacheKey = projectRoot;
  if (configCache.has(cacheKey)) {
    return configCache.get(cacheKey) || null;
  }

  // Find tsconfig.json in project root or common locations
  const possiblePaths = [
    path.join(projectRoot, 'tsconfig.json'),
    path.join(projectRoot, 'tsconfig.base.json'),
    path.join(projectRoot, 'jsconfig.json'), // For JavaScript projects
  ];

  let configPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    configCache.set(cacheKey, null);
    return null;
  }

  try {
    const config = parseTsConfigWithExtends(configPath);
    configCache.set(cacheKey, config);
    return config;
  } catch (error) {
    // Silently fail - tsconfig parsing is optional
    configCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Parse a tsconfig.json file, following extends chains
 */
function parseTsConfigWithExtends(configPath: string): ResolvedTsConfig {
  const configDir = path.dirname(configPath);
  const content = fs.readFileSync(configPath, 'utf-8');
  const config = JSON5.parse(content);

  let baseUrl: string | undefined;
  let paths: TsConfigPaths | undefined;

  // Handle extends
  if (config.extends) {
    const extendsPath = resolveExtendsPath(config.extends, configDir);
    if (extendsPath && fs.existsSync(extendsPath)) {
      const parentConfig = parseTsConfigWithExtends(extendsPath);
      baseUrl = parentConfig.baseUrl;
      paths = parentConfig.paths;
    }
  }

  // Override with current config's compilerOptions
  if (config.compilerOptions) {
    if (config.compilerOptions.baseUrl) {
      // baseUrl is relative to the config file
      baseUrl = path.resolve(configDir, config.compilerOptions.baseUrl);
    }
    if (config.compilerOptions.paths) {
      // Merge paths, current config takes precedence
      paths = { ...paths, ...config.compilerOptions.paths };
    }
  }

  return {
    baseUrl,
    paths,
    configDir,
  };
}

/**
 * Resolve the extends path to an absolute path
 */
function resolveExtendsPath(extendsValue: string, configDir: string): string | null {
  // Package reference (e.g., "@tsconfig/node18/tsconfig.json")
  if (!extendsValue.startsWith('.') && !path.isAbsolute(extendsValue)) {
    // Try to resolve from node_modules
    try {
      const nodeModulesPath = path.join(configDir, 'node_modules', extendsValue);
      if (fs.existsSync(nodeModulesPath)) {
        return nodeModulesPath;
      }
      // Add .json if missing
      if (!extendsValue.endsWith('.json')) {
        const withJson = nodeModulesPath + '.json';
        if (fs.existsSync(withJson)) {
          return withJson;
        }
      }
    } catch {
      // Ignore resolution errors
    }
    return null;
  }

  // Relative or absolute path
  let resolved = path.resolve(configDir, extendsValue);

  // Add .json if missing
  if (!resolved.endsWith('.json')) {
    resolved += '.json';
  }

  return resolved;
}

/**
 * Resolve an import path using tsconfig paths
 */
export function resolveWithTsConfig(
  importPath: string,
  fromFile: string,
  projectRoot: string,
  config: ResolvedTsConfig
): string | undefined {
  // Skip relative imports - they don't use path aliases
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return undefined;
  }

  // Try to match against paths
  if (config.paths) {
    for (const [pattern, targets] of Object.entries(config.paths)) {
      const match = matchPathPattern(importPath, pattern);
      if (match !== null) {
        // Try each target in order
        for (const target of targets) {
          const resolved = resolvePathTarget(
            match,
            target,
            config.baseUrl || config.configDir,
            projectRoot
          );
          if (resolved) {
            return resolved;
          }
        }
      }
    }
  }

  // Try baseUrl for non-relative imports
  if (config.baseUrl) {
    const resolved = tryResolveFile(path.join(config.baseUrl, importPath));
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

/**
 * Match an import path against a tsconfig path pattern
 * Returns the captured wildcard portion, or null if no match
 */
function matchPathPattern(importPath: string, pattern: string): string | null {
  // Exact match
  if (pattern === importPath) {
    return '';
  }

  // Wildcard pattern (e.g., "@/*" matches "@/foo/bar")
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1); // Remove the *
    if (importPath.startsWith(prefix)) {
      return importPath.slice(prefix.length);
    }
  }

  return null;
}

/**
 * Resolve a path target with the matched wildcard portion
 */
function resolvePathTarget(
  wildcardMatch: string,
  target: string,
  baseDir: string,
  projectRoot: string
): string | undefined {
  // Replace wildcard in target with matched portion
  let resolvedTarget = target;
  if (target.endsWith('*')) {
    resolvedTarget = target.slice(0, -1) + wildcardMatch;
  }

  // Resolve relative to baseUrl/configDir
  const fullPath = path.isAbsolute(resolvedTarget)
    ? resolvedTarget
    : path.join(baseDir, resolvedTarget);

  return tryResolveFile(fullPath);
}

/**
 * Try to resolve a path to an actual file with various extensions
 */
function tryResolveFile(basePath: string): string | undefined {
  const extensions = [
    '', // Exact match
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mts',
    '.cts',
    '.mjs',
    '.cjs',
    '/index.ts',
    '/index.tsx',
    '/index.js',
    '/index.jsx',
  ];

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }

  return undefined;
}

/**
 * Clear the config cache
 */
export function clearTsConfigCache(): void {
  configCache.clear();
}
