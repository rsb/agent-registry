#!/usr/bin/env python3
"""Check files against the registry's schemas, and run the fixtures.

    check.py fixtures          every fixture passes or fails as its path says
    check.py spec <dir>        a spec folder: spec.md and NN-*.md frontmatter
    check.py brief <file>      a brief
    check.py outbox <run-dir>  run-dir/brief.json and run-dir/outbox/
    check.py registry [root]   root/rules/*.toml and root/heuristics/*.toml
                               (root defaults to this repository)

Needs Python 3.11 or later (tomllib) with jsonschema and PyYAML. Exit 0 when everything holds.
"""

import hashlib
import json
import re
import sys
import tomllib
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent


def validator(name, file):
    schema = json.loads((ROOT / name / "v1" / file).read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


SPEC = validator("spec", "spec.schema.json")
TICKET = validator("ticket", "ticket.schema.json")
BRIEF = validator("brief", "brief.schema.json")
ENTRY = validator("outbox", "entry.schema.json")
MANIFEST = validator("outbox", "manifest.schema.json")
KINDS_SCHEMA = validator("outbox", "kinds.schema.json")
RULE = validator("rule", "rule.schema.json")
HEURISTIC = validator("heuristic", "heuristic.schema.json")
KINDS = json.loads((ROOT / "outbox" / "v1" / "kinds.json").read_text())

# Strings that look like a credential. A brief holds none of any kind.
CREDENTIAL = re.compile(
    r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY|"
    r"sk-[A-Za-z0-9-]{20,}|xox[abpr]-"
)


def schema_errors(v, data, where):
    return [
        f"{where}: {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}"
        for e in sorted(v.iter_errors(data), key=lambda e: list(map(str, e.path)))
    ]


def frontmatter(path):
    text = path.read_text()
    m = re.match(r"---\n(.*?\n)---\n", text, re.S)
    if not m:
        return None, [f"{path}: no frontmatter"]
    try:
        return yaml.safe_load(m.group(1)), []
    except yaml.YAMLError as e:
        return None, [f"{path}: frontmatter does not parse: {e}"]


def check_markdown(v, path):
    data, errors = frontmatter(path)
    return errors or schema_errors(v, data, path)


def check_toml(v, path):
    try:
        data = tomllib.loads(Path(path).read_text())
    except (OSError, tomllib.TOMLDecodeError) as e:
        return [f"{path}: {e}"]
    return schema_errors(v, data, path)


def check_registry(root):
    """Every rule and heuristic file under root. heuristics/ may be absent."""
    root = Path(root)
    if not (root / "rules").is_dir():
        return [f"{root}: no rules/ directory"]
    errors = []
    for v, folder in [(RULE, "rules"), (HEURISTIC, "heuristics")]:
        for path in sorted((root / folder).glob("*.toml")):
            errors += check_toml(v, path)
    return errors


def check_spec(folder):
    folder = Path(folder)
    errors = check_markdown(SPEC, folder / "spec.md")
    for ticket in sorted(folder.glob("[0-9][0-9]-*.md")):
        errors += check_markdown(TICKET, ticket)
    return errors


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def check_brief_data(brief, where):
    errors = schema_errors(BRIEF, brief, where)
    if any(CREDENTIAL.search(s) for s in strings(brief)):
        errors.append(f"{where}: holds something that looks like a credential")
    return errors


def check_brief(path):
    path = Path(path)
    try:
        brief = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        return [f"{path}: {e}"]
    return check_brief_data(brief, path)


def seal(outbox):
    """The manifest's entries if the outbox is sealed, else (None, why)."""
    manifest_path = outbox / "manifest.json"
    if not manifest_path.is_file():
        return None, "no manifest"
    try:
        manifest = json.loads(manifest_path.read_bytes())
    except ValueError:
        return None, "manifest does not parse"
    if list(MANIFEST.iter_errors(manifest)):
        return None, "manifest does not match its schema"
    listed = [e["file"] for e in manifest["entries"]]
    if len(set(listed)) != len(listed):
        return None, "manifest lists a file twice"
    present = {p.name for p in outbox.iterdir()} - {"manifest.json"}
    if present != set(listed):
        return None, f"files and manifest differ: {sorted(present ^ set(listed))}"
    for e in manifest["entries"]:
        digest = hashlib.sha256((outbox / e["file"]).read_bytes()).hexdigest()
        if digest != e["sha256"]:
            return None, f"{e['file']}: hash mismatch"
    return listed, None


def validate_against_brief(outbox, files, brief):
    """Every reason the sealed outbox is rejected; empty when it is valid."""
    errors = []
    issues = set(brief["issues"]["refs"]) | set(brief["issues"]["closes"])
    for index, name in enumerate(files, start=1):
        where = f"{name}"
        try:
            entry = json.loads((outbox / name).read_bytes())
        except ValueError:
            errors.append(f"{where}: does not parse")
            continue
        found = schema_errors(ENTRY, entry, where)
        if found:
            errors += found
            continue
        kind, target, payload = entry["kind"], entry["target"], entry["payload"]
        if name != f"{index:02d}-{kind}.json":
            errors.append(f"{where}: entry {index} must be {index:02d}-{kind}.json")
        if kind not in brief["allowed_effects"]:
            errors.append(f"{where}: kind {kind} not in the brief's allowed_effects")
        if target is None:
            continue
        if "issue" in target:
            if payload["issue"] != target["issue"]:
                errors.append(f"{where}: payload issue differs from target")
            if target["issue"] not in issues:
                errors.append(f"{where}: issue #{target['issue']} not in the brief")
        if "branch" in target:
            if payload["head"] != target["branch"]:
                errors.append(f"{where}: payload head differs from target")
            if target["branch"] != brief["branch"]:
                errors.append(f"{where}: branch {target['branch']} not the brief's")
        if "pr" in target:
            errors.append(f"{where}: a brief v1 names no PR target")
        if kind == "pr-open":
            if payload["base"] != brief["base_branch"]:
                errors.append(f"{where}: base {payload['base']} not the brief's")
            for n in brief["issues"]["closes"]:
                if not re.search(rf"\bCloses #{n}\b", payload["body"]):
                    errors.append(f"{where}: body lacks Closes #{n}")
    return errors


def check_outbox(run_dir):
    """('valid' | 'unsealed' | 'rejected' | 'bad-brief', reasons)."""
    run_dir = Path(run_dir)
    errors = check_brief(run_dir / "brief.json")
    if errors:
        return "bad-brief", errors
    brief = json.loads((run_dir / "brief.json").read_text())
    outbox = run_dir / "outbox"
    if not outbox.is_dir():
        return "unsealed", ["no outbox directory"]
    files, why = seal(outbox)
    if files is None:
        return "unsealed", [why]
    errors = validate_against_brief(outbox, files, brief)
    return ("rejected", errors) if errors else ("valid", [])


def check_vocabulary():
    """The kind list is the same in kinds.json and every schema that names it."""
    errors = schema_errors(KINDS_SCHEMA, KINDS, "kinds.json")
    kinds = set(KINDS["kinds"])
    entry = set(ENTRY.schema["properties"]["kind"]["enum"])
    brief = set(BRIEF.schema["properties"]["allowed_effects"]["items"]["enum"])
    pattern = MANIFEST.schema["properties"]["entries"]["items"]["properties"]
    manifest = set(re.search(r"\((.*?)\)", pattern["file"]["pattern"]).group(1).split("|"))
    for name, found in [("entry", entry), ("brief", brief), ("manifest", manifest)]:
        if found != kinds:
            errors.append(f"{name} schema kinds differ from kinds.json: {sorted(found ^ kinds)}")
    return errors


def run_fixtures():
    failures = check_vocabulary()
    count = 0

    def expect(path, errors, should_pass):
        nonlocal count
        count += 1
        if should_pass and errors:
            failures.append(f"{path}: should pass\n    " + "\n    ".join(errors))
        if not should_pass and not errors:
            failures.append(f"{path}: should fail, passed")

    for name, v in [("spec", SPEC), ("ticket", TICKET)]:
        for outcome in ["valid", "invalid"]:
            for path in sorted((ROOT / name / "v1" / "fixtures" / outcome).glob("*.md")):
                expect(path, check_markdown(v, path), outcome == "valid")
    for name, v in [("rule", RULE), ("heuristic", HEURISTIC)]:
        for outcome in ["valid", "invalid"]:
            for path in sorted((ROOT / name / "v1" / "fixtures" / outcome).glob("*.toml")):
                expect(path, check_toml(v, path), outcome == "valid")
    for path in sorted((ROOT / "spec" / "v1" / "fixtures" / "folders").iterdir()):
        expect(path, check_spec(path), True)
    for outcome in ["valid", "invalid"]:
        for path in sorted((ROOT / "brief" / "v1" / "fixtures" / outcome).glob("*.json")):
            expect(path, check_brief(path), outcome == "valid")
        base = ROOT / "outbox" / "v1" / "fixtures"
        for path in sorted((base / "entries" / outcome).glob("*.json")):
            expect(path, schema_errors(ENTRY, json.loads(path.read_text()), path),
                   outcome == "valid")
        for path in sorted((base / "kinds" / outcome).glob("*.json")):
            expect(path, schema_errors(KINDS_SCHEMA, json.loads(path.read_text()), path),
                   outcome == "valid")
    for outcome in ["valid", "unsealed", "rejected"]:
        for path in sorted((ROOT / "outbox" / "v1" / "fixtures" / outcome).iterdir()):
            count += 1
            got, reasons = check_outbox(path)
            if got != outcome:
                failures.append(f"{path}: expected {outcome}, got {got}: {reasons}")

    for f in failures:
        print(f"FAIL {f}")
    print(f"{count} fixtures, {len(failures)} failures")
    return not failures


def main(argv):
    if argv[1:] == ["fixtures"]:
        return 0 if run_fixtures() else 1
    if len(argv) == 3 and argv[1] in ("spec", "brief"):
        errors = (check_spec if argv[1] == "spec" else check_brief)(argv[2])
        print("\n".join(errors) if errors else "valid")
        return 1 if errors else 0
    if len(argv) in (2, 3) and argv[1] == "registry":
        errors = check_registry(argv[2] if len(argv) == 3 else ROOT.parent)
        print("\n".join(errors) if errors else "valid")
        return 1 if errors else 0
    if len(argv) == 3 and argv[1] == "outbox":
        outcome, reasons = check_outbox(argv[2])
        print(outcome)
        for r in reasons:
            print(f"  {r}")
        return 0 if outcome == "valid" else 1
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
