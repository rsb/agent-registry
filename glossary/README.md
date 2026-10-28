# Glossary

The registry's vocabulary. One TOML file per term, at the root scope of the
tree. A term defined here is the ubiquitous language of rsb-workflow: when a
name appears in a rule, a brief, a render or a scorecard, it means what its
file says and nothing else. A defined name also acts as a macro in prompts:
"keep this headless" expands, at the pinned registry revision, to the members
of the pattern named `headless`.

## Row format

Every file has one `[term]` table with these fields.

| field        | required | meaning                                                              |
|--------------|----------|----------------------------------------------------------------------|
| `id`         | yes      | the term, kebab-case; the file name is `<id>.toml`                   |
| `aliases`    | no       | other names the same thing goes by, including retired names          |
| `intent`     | yes      | one sentence; what an agent reads when the term appears in a brief   |
| `kind`       | yes      | `registry-entity`, `concept`, `component`, `measure`                 |
| `members`    | no       | rule and heuristic ids, for terms that name a pattern                |
| `status`     | yes      | `active`, `deprecated` (keep `superseded_by`), `merged` (keep alias) |
| `see_also`   | no       | related term ids                                                     |
| `definition` | no       | the longer statement for the system reference; may span paragraphs  |

`intent` is the field the render uses. Keep it to one sentence that can stand
alone; put nuance in `definition`.

## Invariants

- An `id` is never reused. A deprecated term keeps its file and gains
  `superseded_by`; a merged term keeps its file as an alias record.
- The glossary is covered by the render hash. A render produced against a
  registry revision expands names using that revision's glossary, so a
  glossary change is a registry change and bumps the revision.
- `rule` and `heuristic` are distinct entities. A rule must hold; a heuristic
  is weighed. A heuristic file is invalid without at least one `counter_case`
  (a recorded situation in which following it was the wrong call); a rule
  file is invalid with one. A heuristic that cannot name its counter-case is
  refiled as a rule with a judgement-class check.
- Check classes are `mechanical`, `approximate`, `judgement`. The class is a
  property of the check, not of the rule or heuristic it holds. The former
  class name `heuristic` is retired to avoid collision with the entity.
