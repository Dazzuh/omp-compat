# Agent contract: omp-compat

Direct imperatives. Follow them in order of appearance.

## 1. Source of truth

- Kata project `omp-compat` holds all task status and dependencies.
- Use the `kata.*` MCP tools first. At session start load the groups `kata.load_issue_discovery`, `kata.load_issue_mutation`, `kata.load_issue_lifecycle` and `kata.load_coordination`.
- Use the CLI only for verbs with no MCP tool (`notify`, `projects`). Always pass `--as omp-agent`.
- Never write task state anywhere else.

## 2. Session start

- Check that an issue created or claimed through MCP shows owner/author `omp-agent`.
- Call `kata.ready` with `labels: ["ready-for-agent"]` and `unowned: true`, then take `kata.next`.
- With nothing ready, report that and stop.

## 3. State model

| State | Representation |
|---|---|
| Planned | open, unowned, label `ready-for-agent` |
| Ready | planned with no open `blocked_by` |
| Active | owner `omp-agent`, `work.attention=ok`, `work.attention_msg` set |
| Blocked on work | `work.attention=stuck`, `work.attention_msg`, `blocked_by` edge to the blocking issue |
| Needs human | `work.attention=needs-human`, label `ready-for-agent` removed and `ready-for-human` added (one lane at a time), `kata notify --to Dazzuh`; reversed when the human answers |
| Discovered | new issue with labels `needs-triage` and `discovered`, `related` to the source issue, no parent |
| Done | closed `done` with evidence |

## 4. Working an issue

- `kata.claim`, then set `work.attention=ok` and the msg.
- Work only to the issue's ACs.
- Commit with a trailer line `Kata: omp-compat#<shortid>`.
- Push to `main` after the issue closes (R1 onward).

## 5. Unexpected problems

- If the fix is within this issue's ACs and touches only code this issue changed, fix it.
- Otherwise create a Discovered issue and don't work it in this issue.
- If it blocks an AC and no pre-approved fallback or internal adjustment resolves it, also add `blocks: <current>` on the new issue, set the current issue to `stuck`, and escalate.

## 6. Decide without asking

Record each of these as a `Decision` comment on the issue, then continue:

- Internal implementation adjustments that keep every AC as written: module internals, helper names, test structure, adding a TypeScript diagnostic code to the host-imports mapping, regex or parsing fixes, retry/timeout values, and the CI step layout within the jobs and permissions specified.
- Additive CLI flags or report fields that remove nothing specified in the design.
- Every fallback the plan marks *pre-approved*:
  - If S1 finds no spec form that validates a local plugin dir offline, `omp-load` installs from a git spec: `git+file://` of a temp git repo for path entries, `github:<owner>/<repo>#<sha>` for git entries. If that also skips validation, escalate.
  - If S1 shows valid host subpath imports fail under the real binary for installed plugins, `omp-load` still reports what OMP reports. Use a package-root-only value import in the `good` fixture and file a Discovered issue describing the upstream behaviour.
  - If the 18.12.5 npm package lacks `dist/types`, replace 18.12.5 in `pinned` with the oldest 18.x release that has them.
  - If `actions/upload-artifact@v4` fails under `permissions: {}` in `runtime-untrusted`, drop that upload step and rely on the step summary. Never widen permissions.
  - If `scripts/diff-exports.ts` finds no removal by step 4 of its search, continue to step 5 (17.x to 18.0.0). If step 5 also finds nothing, escalate.

Decision comment format:

```markdown
## Decision
- What: <the adjustment or fallback taken>
- Why: <observed fact that forced it, with command/output>
- ACs: unchanged | <AC n reworded as …, preserving its observable outcome>
```

## 7. Escalate

Set `needs-human`, swap `ready-for-agent` for `ready-for-human`, notify Dazzuh, stop work on that issue, and take the next ready issue (or stop if none). Escalate for:

- **Architecture.** Adding, removing or replacing a check. Changing how a check executes (for example, replacing `omp-load` with a harness). Removing or renaming a specified CLI flag, exit code, `src/types.ts` field or corpus field. Changing the regression or expectation semantics.
- **Security.** Anything that would run third-party plugin code outside the `runtime-untrusted` CI job. Widening any workflow `permissions`, adding `secrets.*`, `pull_request_target`, or cache use in `runtime-untrusted`. Any credential exposure.
- **Scope.** New features, new corpus plugins, OMP version policy changes beyond the pre-approved fallback, and any runtime dependency other than `typescript`.
- **Unsatisfiable requirements.** An AC that can't be met as written and has no pre-approved fallback.
- **Irreversible actions.** Force-push, `kata delete`/`purge`, repo settings, merging a PR.

## 8. Runtime safety

- An isolated HOME is not a sandbox.
- Never install, import or run a third-party plugin on this machine: no `omp plugin install` of it, no `bun install` in its clone, and no `--allow-runtime` against it.
- Only this repo's `fixtures/` and `test/drill/` may run under `--allow-runtime` locally.
- Untrusted runtime checks run only in the `runtime-untrusted` CI job.

## 9. Closing

- Run every AC's command fresh.
- Post one comment in the Evidence comment format.
- Close with `reason: "done"`, a message of 40+ chars naming scope and verification, and evidence entries `commit:<sha>` plus `test:<cmd>` for each AC command (and `pr:<url>` where a PR or run URL is the evidence).
- If any AC isn't PASS, don't close. Add `needs-review` with a comment naming what remains.
- Never close E0. Phase issues close only under section 10.

Evidence comment format:

```markdown
## Evidence
- AC1: PASS. `<command>` → <observed output, ≤3 lines>
- AC2: PASS. …
Commit: <sha>
```

## 10. Phase checkpoint

Phase checkpoints are informational, not approval gates. When the last work issue in a phase closes and every child passed its ACs:

- Post a comment on the phase issue listing every `Decision` comment made in the phase and each child's evidence.
- Close the phase issue `done` with `commit:<sha>` evidence plus the child issue refs, then continue with the next ready issue in the same session. Don't restart OMP.
- If any child isn't closed on PASS evidence, or the phase has an open `stuck`, `needs-human` or `needs-review` child, don't close the phase; escalate per section 7.
- Human escalation stays for scope, architecture, security and acceptance-criteria problems (section 7). Discovered issues stay tracked separately (section 5). Never expand scope to finish a phase.

## 11. Not allowed

No `tern-kata worker`, `worker.toml`, `kata cron` jobs, `kata agent-hook install`, `/loop`, or unattended or background execution.

## 12. Links in chat

Write Kata refs as `[<id>](https://kata.invalid/omp-compat/<id>)` in chat replies only. Use the bare id everywhere else.
