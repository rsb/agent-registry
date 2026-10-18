# Logging

## logging

A log line records that something happened; an error reports that a
requested thing did not. Code that returns an error adds context and
returns it. It does not log it. The one place that logs a failure is the
boundary where the error stops travelling: the command dispatcher in an
app, the job loop in a daemon. It logs once:

```rust
error!(command, id, code = %e.code(), error = %e, "command failed");
```

`error` is the full one-line `Display`; `code` is the same string the reply
carries. Logging and returning the same error, or `#[instrument(err)]` on
an inner function, both log it twice and are not done.

Levels. `error`: a requested command did not complete. `warn`: it
completed but degraded, and someone could act on the line. `info`:
lifecycle, plus one line per command with its id and duration. `debug`:
internals, written to the file by default. `trace`: per-tile and per-FFI
call detail, opt-in. Library crates, including `rsb-libraw`, log at `debug`
and `trace` only; the app owns `info` and above.

Mechanics. Every crate uses `tracing`, never `log`, `println!` or
`eprintln!` for diagnostics. The binary installs one `tracing-subscriber`
with two layers: human-readable on stderr, filtered by `RUST_LOG` with the
app's default at `info`; JSON lines in `$XDG_STATE_HOME/rsb/<app>/logs/`,
one file a day through `tracing-appender`, at `debug`. The JSON layer does
not walk `source()` and would print only the top `Display` if it tried,
which is one more reason `Display` is the whole line.

Secrets. A credential is held as `secrecy::SecretString` from the moment it
is read, so `?e` and `{:?}` print `[REDACTED]`. A path is not a secret and
appears as written.

**Why.** A failure logged at every layer appears five times with five
partial messages, and the reader has to reassemble it. One line at the
boundary, carrying the full `Display` and the code, is grep-able, joins to
the reply an agent received, and says everything the layers knew. Levels
have meaning only if a library cannot promote itself to `warn`.

**Paths.** Every crate. The subscriber and the boundary log in each
binary's `main` and dispatcher.

**Check.** `cargo xtask errors` fails on `println!`, `eprintln!` or the
`log` crate outside `main` and tests, on `warn!` or `error!` outside the
boundary module each repository names in its `engineering/logging.md`, and
on `#[instrument(err)]` anywhere. Clippy `print_stdout` and
`print_stderr` are deny, with `#[expect]` on the CLI's output path.

**Example.** `main` and `Session::execute` in `rsb/lumen`.
