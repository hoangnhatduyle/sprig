# .claude — Harness OS project scaffold

Stamped by `harness init`. Governed by the global Harness OS constitution; the files here
are the project's thin override layer (specific beats general).

```
.claude/
├── constitution/      # thin overrides of the global constitution
├── specifications/    # machine-readable specs (SPEC-<AREA>-<NNN>.yaml), git-tracked
├── templates/         # project-local PRD/spec templates (optional)
├── tests/             # generated, spec-traceable RED test plans
├── agents/            # project-specific agent notes (optional)
├── workflows/         # project workflow overrides (optional)
└── harness.json       # project metadata: stack + risk profile
```

New work flows through Harness OS: `run_workflow` (new-feature | security-change | hotfix)
enforcing Constitution → Spec → Tests → Code. Legacy code is fixed opportunistically.
