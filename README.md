# rsb agent-registry

The registry the coding agents are held to, and the standards shared by the
rsb apps. It is part of RSB Workflow (`rsb-workflow`), the system that takes
an accepted ticket to a merged change with an agent as the implementer and
evidence in place of review. Gauge (`../gauge`), the workflow's engine,
reads this repository; it holds no rule content of its own. Agents never
read it: they read what Gauge renders from it.

## What lives here

- `rules/`: one TOML file per rule, `rules/<id>.toml`. Ids are opaque
  (`rl-NNNN`), assigned in creation order and never reused; a retired rule
  stays. A rule that restates an app's own numbered rule points at it
  (`source = { file, number }`) and never copies its text.
- `profiles/`: the layers repos are minted and reconciled from, chained
  `base › kind › variant › repo` (for example
  `base › service › cloudflare › gordana-milan`). Each layer has a
  `profile.toml` (parent, the rules it selects, its files and their
  ownership class: owned, pointer, merged, rendered or sample; see "How
  governance files are checked") and a `files/` tree.
- `standards/`: prose standards shared by the Rust apps.
- `repos.toml`: every repository in the portfolio with its role
  (`factory`, `project`, `reference`, `record`), local path and status.
  It is the authority for the local layout and for which repos a loop
  may open on.

`rules/` and `profiles/` move together at one revision, so a rule and the
profile that selects it land in one commit. A PR changes one of the two
trees, or both when they change for one reason: #5 moved rl-0003's and
rl-0005's CI pointers in `rules/` with the `pr.yml` they name in
`profiles/`.

A rule may serve one repo. A standard enters `standards/` only when a
second app needs it; until then it lives in the app's own `engineering/`.
Naming is the one exception, because it is family-level by definition.

## How governance files are checked

A managed file has one of five classes.

- Owned: has a template in a layer's `files/`. `overlay-diff.sh`
  compares it with the repo byte for byte and by mode; in CI, rl-0009
  reports any change to it that has no recorded exception.
- Pointer: compared byte for byte, like an owned file (`CLAUDE.md`).
  `overlay-diff.sh` and rl-0009 check it in the same way.
- Merged: `AGENTS.md`. Only its `rsb:containment` region is compared;
  the rest of the file is the repo's. `overlay-diff.sh` compares the
  region with the template's, and in CI rl-0009 reports a change to it
  that has no recorded exception.
- Rendered: `tools/rules/rules.json` and the `rsb:rules` region of
  `AGENTS.md`. The render produces them, and no layer carries a copy, so
  `overlay-diff.sh` does not check them. In CI, rl-0009 reports changes
  to them like changes to an owned file.
- Sample: a starting point the repo is free to change. `overlay-diff.sh`
  reports a difference without failing, and rl-0009 does not check it.

## Standards

One file per standard in `standards/`. Each has a Why, a Paths and a
Check section; an app's `engineering/` holds a pointer to the standard,
the app's boundary, and the check that enforces it there. These become
material for the `rust-linux` profile layer.

- `errors.md`: one snafu enum per crate, `{e}` is the whole line, with
  the file and line of each layer on by default.
- `panics.md`: a panic is a bug report, an error is an outcome; the
  process survives it.
- `logging.md`: log or return, never both; one line at the boundary.

The runtime pieces and the checks live in the `rsb-errors` crate,
repository `rsb/errors-rs`, pinned by tag (`v0.1.1`).

## Apps

| App | What it is | Repository |
|---|---|---|
| Lumen | raw developer and photo catalog | `rsb/lumen` |
| Pigment | pixel editor | not started |
| Pica | page layout | not started |
| Spline | vector drawing | not started |
| Datum | CAD | not started |

The theme is the base unit of each medium. Each app's README names its own
reference apps.

RSB Workflow's own pieces are not suite apps:

| Piece | What it is | Where |
|---|---|---|
| Gauge | the engine: registry, renders, sensing, the verdict, rule statistics; CLI `gauge` | `rsb/gauge` |
| Insights | the owner's desktop view across the workflow and all projects; composes what the CLI offers, holds no domain logic | package in `rsb/gauge` |
| `agent-driver` | the only binary that holds the GitHub App key; observes and acts on GitHub, runs the tick | package in `rsb/gauge` (`crates/agent-driver`) |

## Naming

- `rsb` is the organisation and the brand in every machine-facing name. It is
  always lowercase. `rsb.lab` appears only in prose about the photography and
  in About text.
- Repositories are `rsb/<name>` on GitHub and live locally under
  `~/code/software/rsb/` at the path `repos.toml` gives them, with the
  same `<name>`. The top level is one folder per role: `factory/`,
  `projects/` (split by kind: `services/`, `desktop/`, `lib/`), `ref/` and
  `research/`. A folder is for the owner; a repository declares its own
  kind and profile, and no tool infers them from the folder.
- Names come from vocabularies. Creative names from the art vocabulary
  (Lumen, Pigment, Pica, Spline, Datum) are reserved for the creative
  suite. A system with its own identity takes a proper name from another
  vocabulary: Gauge is from metrology. Infrastructure is descriptive.
- The `agent-` prefix marks a subsystem that serves only the agent, whether
  it is a repository or a workspace package: `agent-box`, `agent-host`,
  `agent-registry`, `agent-driver`. In `agent-driver` it also marks the
  custody boundary. `rsb-skills` and `research` serve the owner too and
  carry none.
- Binaries: the bare name belongs to the primary surface. A desktop-first
  app's GUI is `<app>` and any headless tool is `<app>-cli` (`lumen`,
  `lumen-cli`). A headless-first system's CLI is the bare name (`gauge`).
- Crates inside one workspace are bare unless they are meant for use
  outside it; crates shared across apps carry the prefix `rsb-`
  (`rsb-errors`, `rsb-libraw`). Gauge's library crates are layered and
  named `rsb-gauge-*` (`rsb-gauge-schema` first); its CLI crate is
  `rsb-gauge-cli` (binary `gauge`).
- Configuration lives in `~/.config/rsb/<app>/`, data in
  `~/.local/share/rsb/<app>/`. The monitor-to-ICC-profile map is shared by all
  apps at `~/.config/rsb/monitors.toml`.
- App ids are the reverse of a domain we hold, fixed before the first desktop
  entry ships. The domain is `rsb.sh`.
- App names are capitalised in UI text and lowercase in every id, path,
  crate name and binary.
- Names from the archived attempts are never reused: lab, studio, atlas,
  observatory. Easel named the archived UI toolkit, was reissued on
  2026-10-19 to the workflow's control center, and was retired from it on
  2026-10-23 when the engine became Gauge. Whether Easel returns to the
  creative suite is open.

## Repositories

The full list, with roles and paths, is `repos.toml`. Notes on some:

- `rsb/agent-registry`: this repository. Renamed from `rsb/rules` on
  2026-10-19.
- `rsb/gauge`: RSB Workflow's engine monorepo (the `rsb-gauge-*`
  libraries, CLI `gauge`, `agent-driver`, Insights later). Renamed from
  `rsb/easel`.
- `rsb/agent-driver`: archived. Its key, token and GitHub client code
  moved into `rsb/gauge`; its gatekeeper design (an agent asking it to act
  mid-run) was replaced by the brief and outbox.
- `rsb/agent-box`: the bubblewrap sandbox; the only place an agent runs.
- `rsb/agent-host`: the at-desk sandbox configuration, kept in git.
- `rsb/rsb-skills`: how the owner and agents work.
- `rsb/research`: research, decisions, handoffs and retrospectives, one
  folder per effort; `rsb-workflow/` is RSB Workflow's. Renamed from
  `rsb/notes` on 2026-10-19. Never referenced from an app's `AGENTS.md`.
- `rsb/errors-rs`: the `rsb-errors` crate, runtime pieces and checks of
  the errors, panics and logging standards. Public, because `rsb/libraw`
  is public and depends on it.
- `rsb/<app>`: one repository per app, holding its code, its `engineering/`
  rules with their checks, and its `product/` truth.
