# Schemas

The formats that cross between the owner, the agent and the custodian,
and the registry's own entries. One schema language for all of them:
JSON Schema 2020-12. Spec and ticket frontmatter is checked as parsed
YAML, rule and heuristic files as parsed TOML.

| Schema | Describes | Written by | Read by |
|---|---|---|---|
| `spec/v1` | the frontmatter of `specs/S-NNNN-<slug>/spec.md` | `to-spec`, the owner | `spec apply` |
| `ticket/v1` | the frontmatter of `specs/S-NNNN-<slug>/NN-<slug>.md` | `to-tickets`, the owner | `spec apply`, `implement` |
| `brief/v1` | `run/brief.json`, one attempt's task and limits | the custodian | the agent |
| `outbox/v1` | `run/outbox/`, the agent's intended effects | the agent | the custodian |
| `rule/v1` | `rules/rl-NNNN.toml`, one rule | the owner | Gauge |
| `heuristic/v1` | `heuristics/hr-NNNN.toml`, one heuristic | the owner | Gauge |

The custodian is the owner at desk (`brief new`, `handback apply`) and
`agent-driver` in the loop. Both read the same files. See
[outbox/v1/README.md](outbox/v1/README.md) for the outbox contract.

Sources: `research/rsb-workflow/decisions/2026-10-26-user-flows-and-boundaries.md`
(§2, §3, §4) and `2026-10-27-effects-and-unfinished-work.md` (§3 to §7).

## Spec and ticket

- Ids are opaque: `S-NNNN` for a spec, `S-NNNN/n` for a ticket. The
  slug follows the id in the folder name only.
- `slice` is one of `groundwork`, `technical`, `feature`, `human`.
- A ticket has no `status` while it is live. A dropped ticket says
  `status: dropped` and gives `dropped_reason`. `spec apply` closes its
  issue as not planned.
- Each contract names its other end, a ticket id or `external`, and
  its `shape`.
- A seam is a line, or `label: text`. YAML parses the second as a
  one-key mapping, and both are accepted.
- `serves` is a YAML flow list, which splits at commas:
  `[gauge §3.3 rows 3, 4, 19]` yields the integers 4 and 19. Integers
  are accepted. A renderer joins the items with `, `.
- PyYAML reads YAML 1.1, where a bare `no`, `yes`, `on` or `off` is a
  boolean. Quote such a value.

The schema checks one file. These rules span files and belong to
`spec apply`: the slug and id match the folder, every id resolves, the
graph of `depends_on` is acyclic, and every edge carries a contract on
both ends.

## Rule and heuristic

`rule/v1` and `heuristic/v1` are copies. Gauge's `rsb-gauge-schema`
crate (`crates/rsb-gauge-schema/src/rule.rs`) is the schema: its types
read the files and derive these JSON Schemas. Never edit the copies;
regenerate them from a gauge checkout beside this one:

```sh
cargo run -q --manifest-path ../gauge/Cargo.toml -p rsb-gauge-cli -- registry schema rule \
  > schemas/rule/v1/rule.schema.json
cargo run -q --manifest-path ../gauge/Cargo.toml -p rsb-gauge-cli -- registry schema heuristic \
  > schemas/heuristic/v1/heuristic.schema.json
```

The schema checks one file. Gauge's load and lint check the rest: the
file is named for its id, statements are unique, a trial or enforced
entry has a check unless it is judgement, an entry past draft has
`lifecycle.since`.

```sh
cargo run -q --manifest-path ../gauge/Cargo.toml -p rsb-gauge-cli -- registry lint .
```

## Checking

`check.py` needs Python 3.11 or later (for `tomllib`) with `jsonschema`
and `PyYAML`.

```sh
schemas/check.py fixtures                 # every fixture passes or fails as named
schemas/check.py spec ../gauge/specs/S-0001-thin-loop
schemas/check.py brief run/brief.json
schemas/check.py outbox run/              # run/brief.json and run/outbox/
schemas/check.py registry                 # rules/*.toml and heuristics/*.toml here
```

`check.py outbox` is the reference for the seal check and the checks
against the brief, which a schema cannot express. It prints `valid`,
`unsealed` or `rejected` with the reasons.

## Fixtures

Each schema keeps fixtures under `v1/fixtures/`, as `.md`, `.json` or
`.toml` by what the schema describes. The directory a
fixture sits in is its expected outcome: `valid` or `invalid`, and for
whole outboxes `valid`, `unsealed` or `rejected`.

`spec/v1/fixtures/folders/S-0001-thin-loop/` is a copy of gauge's
S-0001 at `c025bd8`, unedited. It is the worked example the spec and
ticket schemas were checked against.

## Versions

A schema's major version is its directory. A file names its version in
`schema` where it has that field (`brief/v1`, `outbox/v1`). A change a
v1 reader would reject is a new version beside the old one.
