<!-- rsb:containment:begin -->
Sessions run from this repo. Other repos may be read for reference and are
not changed from here.

## Conventions

Conventional Commits. A branch is named `<type>/<slug>` with a
Conventional Commits type, and the ticket number leads the slug when
there is one: `build/27-workspace-tooling`, `docs/logs`. Never add
`Co-Authored-By`, `Claude-Session`, or any other AI attribution to a
commit or PR. Do not commit or push unless asked. Dates are
America/Los_Angeles.

## What is the owner's

Work happens on a branch and reaches `main` through a pull request. Agents
never merge. Tags, deploys, secrets, and anything that touches the
production or staging database are the owner's. `.claude/settings.json` and
`.githooks/` are the owner's; propose changes to them, do not make them.
<!-- rsb:containment:end -->
<!-- rsb:rules:begin -->
<!-- rsb:rules:end -->
