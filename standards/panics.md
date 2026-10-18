# Panics

## panics

A panic is a bug report. An error is an outcome. The test for which one a
failure gets: could it happen while our code is correct? A missing file, a
malformed RAF, a LibRaw return code, a bad argument from the user or an
agent, a refused connection: these happen to correct code and are `Error`
variants with a message, a location and a code. An index past a length we
computed, a `None` from a map we just filled, a match arm the type system
says cannot be reached: these happen only when our code is wrong, and they
panic. Using a panic to stop a well-defined failure path, or an `Error` to
paper over a violated invariant, are both wrong, and the second is worse
because it hides the bug behind a message the user cannot act on.

An intentional panic says what it believed. `expect("decoder set width
before unpack")`, `assert!(len % 4 == 0, "RGBA rows are whole pixels")`,
`unreachable!("variant filtered by caller")`. Each message states the
invariant, so the panic line that lands in the log explains itself, and
`grep -rn 'expect("'` lists every place the code asserts something. The
forms with no message, `unwrap()`, bare `panic!()`, bare `unreachable!()`,
`todo!()` and `unimplemented!()`, are not used; they say that the author did
not decide. A public function in a library crate that can panic says so in
a `# Panics` section, and the caller is responsible for the invariant.

A panic does not take the process down. Every release profile states
`panic = "unwind"` and `overflow-checks = true`, so an overflow in pixel
math is a panic in release too, not silently wrong pixels. One
`catch_unwind`, around command dispatch, turns a panic that reaches it into
`Internal`, the command fails, and the session carries on. The hook from
`rsb_errors::panic` is installed once at startup and records the message
and file:line in a thread-local; the catch reads it, so the error says
where the bug is:

```
internal error in `export-jpeg`: RGBA rows are whole pixels at crates/develop/src/export.rs:79:17
```

Every `extern "C"` callback handed to LibRaw has its own `catch_unwind`.
Since Rust 1.81 a panic escaping an `extern "C"` function aborts the
process regardless of any outer catch. The callback returns the cancel code
and the wrapper reports `LIBRAW_CANCELLED_BY_CALLBACK` as `Internal`.

`unsafe` is forbidden in every crate except the FFI crate, where each block
starts with `// SAFETY:` and `undocumented_unsafe_blocks` is deny.

| Lint, deny | Catches |
|---|---|
| `unwrap_used`, `get_unwrap` | a panic with no stated reason |
| `todo`, `unimplemented` | a stub shipped as code |
| `missing_assert_message`, `manual_assert` | an assertion with no invariant, or one written as `if` + `panic!` |
| `missing_panics_doc` | a public library function that can panic and does not say so |
| `string_slice` | a byte index into a `str`, which almost always comes from data |
| `exit` | `process::exit` outside `main`, which skips the catch and the log |

`expect_used`, `panic`, `unreachable` and `indexing_slicing` are allowed:
with a message they are the intentional forms. `clippy.toml` allows
`unwrap` and the missing messages in tests.

**Why.** An editor that crashes loses work, and a daemon that crashes stops
serving, so the process survives a panic. But a bug converted into an
`Error` is a bug nobody sees: the user reads a message about their file
when the fault is ours, and the agent retries something that will never
work. A panic with a stated invariant and a recorded location is the
fastest route from symptom to fix, and the catch makes it safe to have.

**Paths.** Every crate. The FFI crate for `unsafe` and callback guards.
`main` for the hook and the profile.

**Check.** `cargo clippy --workspace --all-targets -- -D warnings` through
`[workspace.lints]` in the root `Cargo.toml` and `clippy.toml`.
`cargo xtask errors` also fails on a release profile without
`panic = "unwind"` and `overflow-checks = true`, on `panic!()`,
`unreachable!()` or `expect("")` with no message, on a second
`catch_unwind` outside the dispatcher and the FFI callbacks, and on an
`extern "C" fn` whose body does not begin with `catch_unwind`.

**Contract.** The dispatcher, `Session::execute` in
`crates/engine/src/lib.rs` for Lumen. `rsb_errors::panic::{install, take}`.
