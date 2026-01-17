# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.8.x   | :white_check_mark: |
| < 0.8   | :x:                |

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

### Scope

The following are in scope for security reports:

- Command injection vulnerabilities
- Path traversal attacks
- Credential/API key exposure
- Arbitrary code execution
- Authentication/authorization bypasses

### Out of Scope

- Issues in third-party dependencies (report these upstream)
- Social engineering attacks
- Physical security issues
- Issues requiring physical access to a user's machine

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

## Security Features in Codi

Codi includes several security features:

1. **Tool Approval System**: Dangerous operations require explicit user approval
2. **Diff Preview**: See exactly what changes will be made before confirming
3. **Dangerous Pattern Detection**: Warns about potentially harmful bash commands
4. **Undo History**: Recover from unintended file modifications
5. **Local Config Separation**: User-specific settings are kept separate and gitignored
