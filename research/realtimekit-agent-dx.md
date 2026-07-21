# RealtimeKit Agent-DX Evidence

## Status

This note summarizes internal material reviewed on 2026-07-16. The source pages were partially truncated by the available retrieval tool; claims below intentionally stay within the retrieved material.

## Reported Evidence

### Agent-native developer experience proposal

Source: internal wiki page `1435540704`, "Proposal: RealtimeKit agent-native developer experience."

Reported problems include coding agents that:

- hallucinate package names;
- skip backend authentication;
- create broken integrations;
- lead developers to select more familiar competitors.

Implication: a RealtimeKit documentation evaluation must verify package selection, authentication boundaries, and running behavior, not merely whether an agent retrieves relevant pages.

### Customer discussion: Vedant Anand, assumechat.com

Source: internal wiki page `1435540689`, "Customer Call: Vedant Anand (assumechat.com) - 2026-07-09."

Reported signals:

- a solo founder uses Cursor and expects rapid integration;
- documentation was described as good enough, while agent packaging and verification/debugging remained problematic;
- multi-device media testing without Apple hardware was a practical concern.

Implication: the initial trial should validate a concrete browser flow and leave physical-device coverage as an explicit later capability.

### Realtime SFU discovery and composition proposal

Source: internal wiki page `1437570756`, "Proposal: Make Realtime SFU Easier to Discover and Compose."

Reported signals:

- realtime primitives are flexible but difficult to discover and compose;
- authoritative deployable blueprints are recommended;
- a third-party evaluation cited excessive assembly and a gap between SFU and RealtimeKit.

Implication: Docs Trials should eventually compare docs-only against blueprint, skill, and MCP resource variants. The first trial establishes the docs-only baseline.

## Product Consequence

The RealtimeKit two-participant room is a credible first trial because it requires a coding agent to navigate the practical boundaries that agent-native DX material identifies: package choice, auth, media lifecycle, state propagation, and real browser verification.
