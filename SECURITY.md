# Security policy

agent-registry holds the rules and profile files that keep
`rsb-workflow`'s coding agents within their limits. Gauge renders them
into every governed repository. A change here that loosens those limits,
or a private detail published here, is a vulnerability.

## Reporting

Report privately through GitHub: on this repository's Security tab, choose
"Report a vulnerability". Please don't open a public issue.

Include the file and line, the commit, and what an agent could do, or
what a reader could learn, that it shouldn't.

This is a one-person project maintained in spare time. Reports are read and
answered as soon as practical; there is no bounty. Only the latest `main`
is supported.

## In scope

- Anything the registry must never hold (README, "What this repo is
  not"): a secret, credential or token, data or telemetry, provider
  configuration, or a private host, path or project name, in the tree or
  the history.
- A rule, profile file or schema that weakens an agent's limits: for
  example a rule of the `containment` consequence class that misses what
  it claims to check, a gap in the `rsb:containment` region of the base
  `AGENTS.md`, a hook or `.claude/settings.json` deny rule that can be
  sidestepped, or a brief or outbox schema that accepts an effect the
  brief did not allow.
- A profile check script (`profiles/*/files/tools/rules/*.mjs`,
  `.githooks/*`) that can be made to pass a change it should refuse, or
  that runs untrusted input as code.

## Out of scope

- Rules that are merely strict, missing, or a matter of taste: open an
  issue.
- Flaws in Gauge, agent-box, Claude Code, Codex or GitHub themselves:
  report those to their own projects.
