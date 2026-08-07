# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in nestjs-agentic, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email us at: **security@nestjs-agentic.dev**

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

We'll acknowledge your report within 48 hours and work with you to understand and resolve the issue before any public disclosure.

## Scope

Security concerns specific to nestjs-agentic include:

- **Policy bypass**: Cases where `@UsePolicies()` enforcement can be circumvented
- **Context leakage**: Agent context (userId, tenantId, permissions) leaking between sessions or tenants
- **Tool injection**: Ability to invoke tools that weren't registered for an agent
- **Session hijacking**: Accessing another user's session data

## Supported Versions

| Version | Supported |
|---|---|
| 0.x.x (latest) | ✅ |
| < 0.1.0 | ❌ |
