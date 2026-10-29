# Contributing

agent-registry is a personal project: the rules and their consequences
are the owner's call, and it is shared as-is. It has one maintainer with
limited time, so the rules for pull requests are strict.

- **Issues are welcome.** A mistake in a rule, a broken schema, an
  unclear README: start with an issue.
- **Open an issue before a pull request.** A pull request needs an issue
  where the maintainer has agreed to the change. Typo and broken-link fixes
  are the only exception.
- **A person must have read and understood every line.** Using AI tools to
  write a change is fine. Opening a pull request you haven't reviewed
  yourself is not: you should be able to explain any line in it, and
  you're expected to answer review comments yourself.
- **Unsolicited or unreviewed pull requests are closed without review.**
  Accounts that keep opening them are blocked.

Security problems: see [SECURITY.md](SECURITY.md), not an issue.

A rule and the profile that selects it change in one commit. Say in the
pull request whether a change to `rules/`, `profiles/` or the brief and
outbox schemas widens or narrows what an agent may do, and why.

Before opening a pull request (Python 3.11+, `jsonschema`, `PyYAML`):

- `python3 schemas/check.py fixtures`
- `python3 schemas/check.py registry`

Commits follow [Conventional Commits](https://www.conventionalcommits.org),
with no AI attribution trailers.
