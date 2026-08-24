# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Use GitHub's private vulnerability reporting:
<https://github.com/ranveerlabs/meldr/security/advisories/new>

Include a description, reproduction steps, affected versions, and any
proof-of-concept. You can expect an initial response within 7 days.

meldr is a developer tool: never point it at APIs you are not authorized to
test, and never commit credentials or tokens into contract files.

## Key handling (BYOK)

- API keys are read only from environment variables and are held in process
  memory for the lifetime of the command that uses them.
- Keys are never written to disk, never cached, never included in logs, and
  are scrubbed from error messages before display.
- The only outbound request carrying a key goes to the provider base URL you
  explicitly configure.
