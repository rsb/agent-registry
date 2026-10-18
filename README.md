# rsb rules

Standards shared by the rsb apps. A standard enters this repository only when a
second app needs it; until then it lives in the app's own `engineering/`.
Naming is the one exception, because it is family-level by definition.

## Standards

One file per standard in `standards/`. Each has a Why, a Paths and a
Check section; an app's `engineering/` holds a pointer to the standard,
the app's boundary, and the check that enforces it there.

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

## Naming

- `rsb` is the organisation and the brand in every machine-facing name. It is
  always lowercase. `rsb.lab` appears only in prose about the photography and
  in About text.
- Repositories are `rsb/<name>` on GitHub and `~/code/software/rsb/<name>`
  locally.
- Configuration lives in `~/.config/rsb/<app>/`, data in
  `~/.local/share/rsb/<app>/`. The monitor-to-ICC-profile map is shared by all
  apps at `~/.config/rsb/monitors.toml`.
- Crates shared across apps carry the prefix `rsb-` (`rsb-ui`, `rsb-color`,
  `rsb-libraw`). Crates inside one app's workspace are bare (`catalog`,
  `develop`).
- Binaries are `<app>` for the desktop app and `<app>-cli` for headless use.
- App ids are the reverse of a domain we hold, fixed before the first desktop
  entry ships. The domain is `rsb.sh`.
- App names are capitalised in UI text (Lumen, Pigment, Pica, Spline, Datum)
  and lowercase in every id, path, crate name and binary.
- Names from the archived attempts are never reused: lab, studio, atlas,
  observatory, easel.

## Repositories

- `rsb/rules`: this repository.
- `rsb/notes`: research, studies, retrospectives, drafts. Never referenced from
  an app's `AGENTS.md`.
- `rsb/skills`: how the owner and agents work.
- `rsb/errors-rs`: the `rsb-errors` crate, runtime pieces and checks of
  the errors, panics and logging standards. Public, because `rsb/libraw`
  is public and depends on it.
- `rsb/<app>`: one repository per app, holding its code, its `engineering/`
  rules with their checks, and its `product/` truth.
