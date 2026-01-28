# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.18.x  | :white_check_mark: |
| 0.13.x  | :white_check_mark: |
| < 0.13  | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Codi, please report it responsibly.

### How to Report

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email security concerns to: **codi@layne.pro**

Include the following information in your report:

1. **Description**: A clear description of the vulnerability
2. **Steps to Reproduce**: Detailed steps to reproduce the issue
3. **Impact**: What an attacker could achieve by exploiting this vulnerability
4. **Affected Versions**: Which versions of Codi are affected
5. **Suggested Fix**: If you have one (optional)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Updates**: We will provide updates on our progress as we investigate
- **Resolution**: We aim to resolve critical vulnerabilities within 7 days
- **Credit**: We will credit you in the release notes (unless you prefer anonymity)

---

## Threat Model

Codi is a CLI tool that gives AI models access to your local filesystem and shell. This document describes the security architecture and known risks.

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER'S MACHINE                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    CODI PROCESS                          │   │
│  │  ┌──────────────────┐    ┌─────────────────────────┐    │   │
│  │  │   AI Provider    │◄───│      Agent Loop         │    │   │
│  │  │   (API calls)    │    │  (orchestrates tools)   │    │   │
│  │  └──────────────────┘    └───────────┬─────────────┘    │   │
│  │                                      │                   │   │
│  │  ┌──────────────────────────────────▼──────────────┐    │   │
│  │  │               TOOL REGISTRY                      │    │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │    │   │
│  │  │  │read_file│ │write_fil│ │  bash   │ │  glob  │ │    │   │
│  │  │  └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │    │   │
│  │  └───────┼───────────┼───────────┼──────────┼──────┘    │   │
│  └──────────┼───────────┼───────────┼──────────┼───────────┘   │
│             │           │           │          │                │
│             ▼           ▼           ▼          ▼                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              LOCAL FILESYSTEM / SHELL                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Security Model

Codi operates with the **same permissions as the user running it**. There is no sandboxing or privilege separation. The security model relies on:

1. **User Approval** - Dangerous operations require user confirmation
2. **Pattern Blocking** - Known dangerous commands are blocked
3. **Path Validation** - File operations are restricted to the project directory
4. **Audit Logging** - All tool calls can be logged for review

### Protected Assets

| Asset | Protection Mechanism |
|-------|---------------------|
| Files outside project | Path traversal validation |
| System files | Dangerous pattern detection |
| Credentials | Pattern detection for secrets |
| User confirmation | Required for destructive ops |

### Threat Categories

#### 1. Prompt Injection

**Risk**: Malicious content in files could manipulate the AI to perform unintended actions.

**Mitigations**:
- User approval for all file modifications and shell commands
- Dangerous pattern detection before execution
- Audit logging for forensic analysis

**Residual Risk**: Medium - A sophisticated attack could potentially bypass pattern detection.

#### 2. Path Traversal

**Risk**: AI could be tricked into reading/writing files outside the project directory.

**Mitigations**:
- Path resolution and validation before file operations
- Rejection of paths containing `..` that escape project root
- Symlink following with boundary checks

**Residual Risk**: Low - Validation is performed at the tool level.

#### 3. Command Injection

**Risk**: Malicious input could lead to execution of unintended shell commands.

**Mitigations**:
- Blocking patterns for dangerous commands (`rm -rf /`, `sudo`, etc.)
- User confirmation for all bash commands
- Commands executed via shell (allows user to see full command)

**Residual Risk**: Medium - Complex command chains could bypass pattern detection.

#### 4. Credential Exposure

**Risk**: AI could accidentally include API keys or secrets in outputs/commits.

**Mitigations**:
- Pattern detection for common secret formats
- Warning when `.env` files are involved
- Git pre-commit hooks recommended (external)

**Residual Risk**: Medium - Novel secret formats may not be detected.

#### 5. Denial of Service

**Risk**: AI could consume excessive resources (infinite loops, large files).

**Mitigations**:
- Maximum iterations limit (50 by default)
- Wall-clock timeout (1 hour)
- Output truncation for large results
- Rate limiting on API calls
- Message array bounds (500 max)

**Residual Risk**: Low - Bounded by hard limits.

#### 6. Data Exfiltration

**Risk**: AI could send sensitive data to external services.

**Mitigations**:
- Web search is read-only (no POST capability)
- User can review all AI actions
- Network access is through approved tools only

**Residual Risk**: Low - Requires user approval for most operations.

### Dangerous Command Patterns

The following patterns are blocked or require confirmation:

| Category | Examples |
|----------|----------|
| Destructive | `rm -rf`, `mkfs`, `dd if=` |
| Privilege Escalation | `sudo`, `su -`, `chmod 777` |
| System Modification | `systemctl`, `service stop` |
| Remote Execution | `curl \| sh`, `wget \| bash` |
| Git Force Operations | `git push --force`, `git reset --hard` |
| Container Escape | `docker run --privileged` |

---

## Security Configuration

Users can configure security settings in `.codi.json`:

```json
{
  "autoApprove": ["read_file", "glob", "grep"],
  "dangerousPatterns": ["custom-pattern-.*"],
  "approvedCategories": ["read-only"]
}
```

**Recommendations**:
- Keep `autoApprove` minimal
- Add project-specific dangerous patterns
- Enable audit logging for security-sensitive work

---

## Audit Logging

Enable with `--audit` flag or `CODI_AUDIT=true`:

```bash
codi --audit
```

Logs are written to `~/.codi/audit/<session>.jsonl` and include:
- All tool calls with inputs and outputs
- API requests and responses
- User confirmations and denials
- Errors and aborts

---

## Multi-Agent Security

When using multi-agent orchestration (`/delegate`):
- Each worker runs in an isolated git worktree
- Permission requests are routed to the parent process
- All workers share the same user approval flow
- IPC uses Unix domain sockets (not network-exposed)

---

## Security Best Practices for Users

### API Keys

- Never commit API keys to version control
- Use environment variables for sensitive credentials
- Rotate API keys periodically

### Tool Approvals

- Review tool operations before approving
- Be cautious with bash commands from untrusted sources
- Use the diff preview feature before file modifications

### Configuration

- Keep `.codi.local.json` in `.gitignore` (it contains your approval patterns)
- Don't share configuration files containing sensitive paths
- Review auto-approve settings carefully

### General Recommendations

1. **Review before approval** - Always read the command/file before confirming
2. **Use version control** - Codi works best in git repos for easy rollback
3. **Enable audit logging** - For sensitive work, use `--audit`
4. **Minimal auto-approve** - Only auto-approve read-only operations
5. **Regular updates** - Keep Codi updated for security patches
6. **Isolated environments** - Consider running in containers for untrusted projects

---

## Security Features in Codi

1. **Tool Approval System**: Dangerous operations require explicit user approval
2. **Diff Preview**: See exactly what changes will be made before confirming
3. **Dangerous Pattern Detection**: Warns about potentially harmful bash commands
4. **Path Validation**: Prevents access to files outside project directory
5. **Undo History**: Recover from unintended file modifications
6. **Memory Bounds**: Limits on message history prevent resource exhaustion
7. **Rate Limiting**: Prevents API abuse and runaway loops
8. **Audit Logging**: Complete session recording for forensic analysis

---

## Known Limitations

1. **No sandboxing** - Codi has full user permissions
2. **Shell command visibility** - Complex shell commands may be hard to audit
3. **Pattern-based detection** - Can be bypassed with obfuscation
4. **Trust in AI provider** - API responses are generally trusted

---

## Scope

The following are in scope for security reports:

- Command injection vulnerabilities
- Path traversal attacks
- Credential/API key exposure
- Arbitrary code execution
- Authentication/authorization bypasses
- Memory exhaustion or DoS vectors

### Out of Scope

- Issues in third-party dependencies (report these upstream)
- Social engineering attacks
- Physical security issues
- Issues requiring physical access to a user's machine

---

## Security Updates

Security updates are released as patch versions. Subscribe to GitHub releases for notifications.

## Version History

| Version | Date | Security Changes |
|---------|------|------------------|
| 0.14.1 | 2026-01 | Path traversal protection, memory bounds |
| 0.14.0 | 2026-01 | Database cleanup on exit, rate limiter bounds |
| 0.13.0 | 2025-12 | Initial comprehensive security model |
