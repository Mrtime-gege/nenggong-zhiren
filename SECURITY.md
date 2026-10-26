# Security Policy

能工智人 is intended for trusted LAN / internal deployments. Please read
[docs/security.md](docs/security.md) before exposing it beyond a trusted network.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose sessions,
credentials, or queue content. Contact the maintainers privately with:

- affected version or build;
- reproduction steps or proof of concept;
- impact assessment;
- whether you want public credit.

## Supported versions

The project is pre-1.0; security fixes are applied to the current published release.
There is no long-term support release yet.

## Not a security boundary

- The default HTTP mode does not encrypt passwords in transit. Use TLS.
- Human operators can read prompts, attachments and tool results. This is by design.
- The JSON Schema validator is not a security sandbox.
