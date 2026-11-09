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

## Agent tools and local privilege

Using an Agent with terminal, filesystem, browser, package-install, or network
tools is equivalent to handing an automated process the current user's machine
permissions. Many local privilege-escalation and persistence paths need only one
command execution opportunity; they do not require a remote exploit against this
project.

This repository exposes OpenAI/Anthropic-compatible endpoints but does not provide an Agent shell. When it is used as a
model endpoint from DSH, the host decides whether shell/filesystem/browser tools
are enabled and what they can reach. Treat those tools as having the same
privileges as the account running the host.

Run Agents in a container or VM with a low-privilege account, read-only sensitive
mounts, explicit command approval, egress restrictions, snapshots, and audit
review. Never expose production hosts, root/admin credentials, SSH keys, cloud
tokens, customer data, or unrestricted home directories to an unisolated Agent.

## Monitoring and browser origin defaults

`/metrics` requires an administrator session or the configured
`server.metricsToken` bearer token. `server.corsOrigins` defaults to an empty
list; explicitly configure trusted origins for browser clients.

## Not a security boundary

- The default HTTP mode does not encrypt passwords in transit. Use TLS.
- Human operators can read prompts, attachments and tool results. This is by design.
- The JSON Schema validator is not a security sandbox.
