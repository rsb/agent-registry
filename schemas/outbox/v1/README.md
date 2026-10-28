# Outbox v1

The agent's hand-back. The agent writes intended effects as files. The
custodian alone performs them, idempotently, in order.

## Layout

```
run/
  brief.json
  outbox/
    01-criteria-tick.json
    02-issue-comment.json
    03-pr-open.json
    manifest.json
```

- One JSON file per entry, named `NN-<kind>.json`. `NN` is the entry's
  place in the order, from `01`.
- `manifest.json` is written last. It lists every entry file with its
  sha256, in order. The order of the entries is the manifest's order.

## Sealed or no outbox

The outbox is sealed when the manifest is present and parses, it lists
every file in `outbox/`, and every hash matches. Anything else is no
outbox: the attempt failed with cause `no_outbox`. It is never a
rejection, because it is far more often an attempt killed mid-write.

## Validation

A sealed outbox is valid when all of these hold. Otherwise it is
rejected as a whole, and nothing is performed.

- Every entry matches `entry.schema.json`, and its file name matches
  its place and kind.
- Every kind is in the brief's `allowed_effects`.
- Every target is among the brief's targets: its issue numbers and its
  branch. The `issue` or `head` in the payload equals the target.
- A `pr-open` base equals the brief's `base_branch`, and its body
  carries `Closes #n` for each of the brief's closes issues.
- Commits are on the loop branch only. The custodian checks this in
  git.

## Kinds

| Kind | Class | Target | Payload |
|---|---|---|---|
| `pr-open` | effect | `{branch}` | `title`, `body`, `head`, `base` |
| `issue-comment` | effect | `{issue}` | `issue`, `body` |
| `criteria-tick` | effect | `{issue}` | `issue`, `criterion`, verbatim |
| `deviation` | effect, recorded only | `null` | `text`, `departs_from` |
| `review-findings` | reserved, reviewer only | `{pr}` | `pr`, `findings` |
| `flagged-for-human` | declaration | `null` | `text` |
| `blocked` | declaration | `null` | `reason` |

`kinds.json` holds each kind's `lookup`, `replay` and `supervision`.
`kinds.schema.json` enforces that `replay` is `safe` if and only if the
kind has a lookup. A kind with no lookup must declare `resend`,
`inspect` or `never`. `deviation` writes only to the store, so its
record is its lookup.

A declaration writes nothing to the world. Effects are performed in
order, then the loop parks (`agent_flagged`, `agent_blocked`) with the
agent's text attached byte for byte. A declaration may sit beside
effects in one outbox.

`review-findings` is defined but reserved. Its lookup, replay and
supervision are declared with the reviewer kind. A brief v1 names no
PR, so a coder's outbox can never carry it.

## The comment marker

The custodian finds an `issue-comment` it already posted by a hidden
marker in the body:

```
<!-- rsb-effect <loop>/<attempt>/<index> -->
```

The custodian adds the marker when it performs the comment. It is a
key, not prose, so the custodian still authors no prose. The agent
never writes one: a body that already carries `<!-- rsb-effect` is
invalid and rejects the outbox.
