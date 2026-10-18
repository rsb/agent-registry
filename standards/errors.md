# Errors

## errors

Every rsb Rust crate has one error enum per crate, derived with `snafu`. A
variant names one failure the crate can report, and its fields carry the
facts a caller or a reader needs: the path, the step, the dimensions. A
lower crate's error enters a higher one through a variant with a `source`
field, and the crossing is written at the call site as
`.context(OpenRawSnafu)`, never as a bare `?`. A check on data the caller
supplied is written with `ensure!(width >= 16, TooSmallSnafu { width })`;
a check on our own invariant is an `assert!`, which is a panic (see
`panics.md`).

`Display` is the whole story. Each variant's display string begins with
what the crate was doing, ends with `{source}` when it has one, and places
`{location}` after the operation. `{e}` is therefore one line, read left to
right from the command to the leaf cause, with the line of code that
wrapped each layer:

```
open-raf: develop (at crates/engine/src/lib.rs:119): open raw (at crates/develop/src/lib.rs:97): decode /photos/DSCF0001.RAF: open (at crates/libraw/src/adapter.rs:118): cannot open file (at crates/ffi/src/processor.rs:87): No such file or directory (os error 2)
```

Nobody walks `source()` to print. It exists so std, tests and typed matches
can reach the cause; a reporter that prints each layer would print the
cause twice. Every variant that has a `source` also has
`#[snafu(implicit)] location: rsb_errors::Loc`, filled in by the library at
the `.context` call. `Loc` prints ` (at file:line)` by default: the reader
of an error line is the owner at a terminal or an agent with one line of
context, and both want the file and line the first time, not after a
second run with a flag. `rsb_errors::show_locations(false)` turns the
locations off, which each binary wires to its `<APP>_ERROR_LOCATIONS=0`
variable, for a reply that goes into an agent record or a golden file,
where a line number that shifts with every edit is noise:

```
open-raf: develop: open raw: decode /photos/DSCF0001.RAF: open: cannot open file: No such file or directory (os error 2)
```

Each public error enum has `fn code(&self) -> &'static str` returning the
variant's path in lowercase, dotted, prefixed through each layer:
`engine.develop.open_raw`. Codes are API: add one, never rename one. A
command reply carries `code` and `message`; the boundary's one log line
carries the same two, so an agent joins a reply to its record.

One variant per app, `Internal { what, location }`, is the failure that is
our fault. Only the dispatcher builds it, when it catches a panic (see
`panics.md`); code that finds an impossible state panics with the
invariant, it does not return `Internal`. No caller branches on it. Every
other variant names a thing the user or an agent can act on: a variant is
a well-defined way the operation can fail with correct code.

Not used: `anyhow`, `eyre`, `color-eyre`, `failure`, `error-chain`,
`thiserror`, `Box<dyn Error>` in any position, and inside snafu `Whatever`,
`whatever!`, `#[snafu(context(false))]` and `snafu::Report`. Results are
never dropped: `unused_must_use` and `let_underscore_must_use` are deny.

**Why.** An error is read far from where it happened, by the owner or by an
agent with one line of context. The line must say the path to the failure
without a second lookup, and the type must let code act on the cause
without parsing text. `snafu` gives both from one derive, records the call
site for free through `#[track_caller]`, and makes every layer crossing an
explicit statement of intent. The old `#[from]` plus bare `?` recorded
nothing about where or why. `anyhow` and `eyre` erase the type; `thiserror`
cannot record a location without a hand-written constructor per variant.

**Paths.** Every crate in every rsb Rust repository. `rsb-errors` holds
`Loc`, `show_locations` and the check code.

**Check.** `cargo xtask errors` in each repository calls
`rsb_errors::check`, which fails on:

- a crate that lists a banned crate, or a line that boxes a `dyn Error`;
- a variant with a `source` field whose display string lacks `{source}`
  or whose variant lacks an implicit `Loc` named `location`;
- `context(false)`, `Whatever`, `whatever!` or `Report` anywhere;
- a `.source()` call outside an `error.rs` module or a test.

Each crate has `tests/error_line.rs`, which builds its deepest nested error
and asserts that the default `{e}` has one `(at ` segment per layer, then
calls `show_locations(false)` and asserts the line exactly. The asserted
line is the sample the owner approved; no test hard-codes a line number.

**Macro.** `#[derive(Snafu)]` generates `Display`, `Error::source`, and one
context selector struct per variant named `<Variant>Snafu` holding every
field except `source` and the implicit ones. `.context(Sel { .. })` is
`map_err(|e| Sel { .. }.into_error(e))`; selector fields accept `Into`, so
`&Path` becomes `PathBuf`. `Sel { .. }.fail()` returns `Err`, `.build()`
the value. `ensure!(c, Sel { .. })` is `if !c { return Sel { .. }.fail() }`.
Read the generated code with `cargo expand -p <crate> error`. Two errors
you will meet: `E0063 missing field` means a selector field was left out;
`E0271 type mismatch resolving <Sel as IntoError<Error>>::Source` means the
selector's variant takes a different source type than the error being
wrapped, or has none.

**Example.** `crates/engine/src/error.rs` and `tests/error_line.rs` in
`rsb/lumen`.
