# Keep Execution Local And Agent-Neutral

Docs Trials will let operators use an external coding agent and will execute v0
verification locally. A hosted controlled agent could improve isolation and
capture, but the archived cloud design grew across many services before the
verification contract worked. Local agent-neutral execution ships the core
method sooner and tests the tools operators already use. Cloudflare joins first
for static delivery and later for explicit report sharing, not trial execution.

This choice accepts unsandboxed same-user execution. The product must require
disposable workspaces, limit inherited environment variables, and avoid claims
of filesystem isolation or remote attestation.
