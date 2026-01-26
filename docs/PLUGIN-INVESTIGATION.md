# Plugin System Investigation

**GitHub Issue**: #17
**Status**: Temporarily Disabled
**Last Updated**: 2026-01-26

## Current State

The plugin system is implemented in `src/plugins.ts` with commands in `src/commands/plugin-commands.ts`, but loading is disabled in `src/index.ts` (lines 2469-2474).

### Implemented Features

- Plugin loading from `~/.codi/plugins/` directory
- `CodiPlugin` interface supporting:
  - Custom tools (via `BaseTool`)
  - Custom commands (via `Command`)
  - Custom providers (via factory pattern)
  - Lifecycle hooks (`onLoad`, `onUnload`)
- Plugin validation and registration
- Commands: `/plugins`, `/plugins info <name>`, `/plugins dir`

### Why It Was Disabled

The plugin system was disabled pending investigation of security and stability concerns. Loading arbitrary ESM modules from user directories introduces risks that need careful consideration.

---

## Security Analysis

### Risk Assessment

| Risk | Severity | Description |
|------|----------|-------------|
| **Arbitrary Code Execution** | Critical | Plugins run with full Node.js privileges |
| **File System Access** | High | Plugins can read/write any files |
| **Network Access** | High | Plugins can make HTTP requests, open sockets |
| **Process Control** | High | Plugins can spawn child processes |
| **Credential Theft** | High | Plugins could access environment variables, keychains |
| **Supply Chain** | Medium | No verification of plugin source/integrity |

### Current Mitigations

1. **Manual Installation**: Users must manually place plugins in `~/.codi/plugins/`
2. **Warning Messages**: Errors during plugin loading are logged (but not blocking)
3. **Interface Validation**: Basic schema validation of the `CodiPlugin` interface

### Missing Mitigations

1. **No Sandboxing**: Plugins run in the same process with full access
2. **No Permission System**: No granular control over what plugins can do
3. **No Signature Verification**: No way to verify plugin authenticity
4. **No Version Compatibility**: No check if plugin is compatible with Codi version
5. **No Dependency Resolution**: Plugins with conflicting dependencies could cause issues

---

## Security Recommendations

### Tier 1: Documentation & Warnings (Minimal Effort)

1. **Clear Documentation**: Document that plugins run with full privileges
2. **Startup Warning**: Show warning when plugins are loaded
3. **Trust Model**: Document that users should only install plugins from trusted sources

### Tier 2: Basic Isolation (Medium Effort)

1. **Separate Process**: Run plugins in child processes with IPC
2. **Permission Prompts**: Prompt user before allowing sensitive operations
3. **Allowlist/Blocklist**: Let users configure which plugins can load

### Tier 3: Full Sandboxing (High Effort)

1. **VM Isolation**: Use `vm` module or `isolated-vm` for sandboxing
2. **Capability-Based Security**: Grant plugins specific capabilities
3. **Resource Limits**: Limit CPU, memory, file handles per plugin

### Recommended Approach

Start with **Tier 1** (documentation) plus selected elements from **Tier 2**:

```typescript
// Example: Permission-based loading
interface PluginPermissions {
  fileSystem: 'none' | 'read' | 'read-write';
  network: boolean;
  subprocess: boolean;
  environment: boolean;
}

// User approves permissions on first load
async function loadPluginWithConsent(pluginDir: string): Promise<CodiPlugin> {
  const permissions = readPluginManifest(pluginDir);
  const approved = await promptUserPermissions(permissions);
  if (!approved) throw new Error('Plugin permissions denied');
  return loadPlugin(pluginDir);
}
```

---

## API Stability Assessment

### Stable (Safe for Plugins)

| Interface | Location | Notes |
|-----------|----------|-------|
| `CodiPlugin` | `src/plugins.ts` | Core plugin interface |
| `BaseTool` | `src/tools/base.ts` | Well-established, used internally |
| `Command` | `src/commands/index.ts` | Stable command structure |
| `ProviderConfig` | `src/types.ts` | Standard provider options |

### Unstable (May Change)

| Interface | Location | Risk |
|-----------|----------|------|
| `Agent` | `src/agent.ts` | Internal implementation details |
| `Message`, `ContentBlock` | `src/types.ts` | May evolve with new model features |
| Tool schemas | Various | May add new required fields |

### Recommendations

1. **Version the Plugin API**: Plugins declare minimum Codi version
2. **Semantic Versioning**: Breaking changes bump major version
3. **Deprecation Warnings**: Warn before removing plugin APIs
4. **Plugin SDK**: Consider publishing a separate `@codi/plugin-sdk` package

---

## Missing Features

### Discovery & Installation

- **npm Registry**: Allow `codi plugin install <package>` from npm
- **Plugin Marketplace**: Curated list of verified plugins
- **Auto-Update**: Check for plugin updates

### Management

- **Enable/Disable**: Toggle plugins without deleting
- **Dependency Resolution**: Handle plugin dependencies
- **Conflict Detection**: Warn if plugins conflict

### Development

- **Plugin Template**: `codi plugin create <name>` scaffolding
- **Testing Utilities**: Mock Codi environment for plugin tests
- **Hot Reload**: Reload plugins without restarting Codi

---

## Roadmap to Re-enablement

### Phase 1: Documentation (Ready Now)

1. Create user documentation for plugin security model
2. Add startup warning when plugins are loaded
3. Re-enable plugin loading with warnings

**Deliverables**:
- Update CLAUDE.md with plugin security notes
- Add `--plugins` / `--no-plugins` CLI flags
- Console warning: "Plugins loaded. Plugins have full system access."

### Phase 2: Basic Safety (1-2 weeks)

1. Add plugin manifest with declared permissions
2. Prompt user to approve permissions on first load
3. Store approved plugins list in `~/.codi/approved-plugins.json`

**Deliverables**:
- `permissions` field in plugin `package.json`
- One-time approval prompt
- `--approve-plugins` flag for CI/automation

### Phase 3: Process Isolation (2-4 weeks)

1. Run plugins in child worker processes
2. Use IPC for tool/command registration
3. Timeout and resource limits

**Deliverables**:
- Worker-based plugin host
- Plugin crash doesn't crash Codi
- `max-plugin-memory` config option

### Phase 4: Distribution (Future)

1. Plugin publishing to npm with `codi-plugin` keyword
2. `codi plugin install/uninstall/update` commands
3. Optional plugin signing/verification

---

## Quick Re-enablement (If Accepting Risk)

To re-enable the plugin system with current implementation:

1. Uncomment lines 2471-2474 in `src/index.ts`
2. Add warning message to startup output
3. Document security implications in README

```typescript
// src/index.ts - Line 2469
const loadedPlugins = await loadPluginsFromDirectory();
if (loadedPlugins.length > 0) {
  console.log(chalk.yellow('Warning: Plugins loaded. Plugins have full system access.'));
  console.log(chalk.dim(`Plugins: ${loadedPlugins.map(p => p.plugin.name).join(', ')}`));
}
```

---

## Appendix: Example Plugin

```javascript
// ~/.codi/plugins/hello-world/index.js
export default {
  name: 'hello-world',
  version: '1.0.0',
  description: 'Example plugin',

  commands: [{
    name: 'hello',
    description: 'Say hello',
    execute: async (args) => `Hello, ${args || 'world'}!`,
  }],

  onLoad: async () => {
    console.log('Hello World plugin loaded!');
  },
};
```

```json
// ~/.codi/plugins/hello-world/package.json
{
  "name": "codi-plugin-hello-world",
  "version": "1.0.0",
  "main": "index.js",
  "type": "module"
}
```
