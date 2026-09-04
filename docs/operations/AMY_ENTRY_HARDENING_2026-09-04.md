# Amy protected-production implementation — 2026-09-04

Status: local candidate; not promoted. Do not interpret fixture tests as live acceptance.

## Protected rollback point

- Tag: `checkpoint-insight-amy-sdr-demo-progress-rw-2026-09-04`
- Commit: `8019cfee5bbd3703125ad686941a5fcbc16c66ca`
- Candidate branch: `codex/amy-entry-memory-hardening-20260904`
- Production entry: `https://xagent.aifusionlabs.app/agents/amy`
- Existing direct entry: `https://xagent.aifusionlabs.app/demo/amy?variant=cara4`

Preserve historical personas, canaries, configurations, branches, worktrees and routes. No cleanup, deletion, renaming or migration is authorized in this pass. Other agents, hosted prompt/model/avatar, email architecture and Hermes remain out of scope.

## Bounded changes

1. Missing/blank Amy variants resolve through the approved configured persona and check-in. Malformed variants fail closed; other agents retain their existing resolution.
2. Legacy Amy transcript submissions are rejected before analysis, persistence or email. The route remains for existing non-Amy behavior.
3. Amy token issuance requires working server check-in gates, trusted origin, rate allowance, browser identity and the existing follow-up contact token.
4. Public returning-memory recall and deletion are paused independently of check-in configuration. Existing history and operator workflows are preserved. A typed email plus consent is not ownership verification. Do not re-enable `AMY_RETURNING_MEMORY_AVAILABLE` until a separately reviewed ownership-verification implementation exists.
5. Check-in retains private follow-up contact, shows the demo disclosure and real privacy destination, and advances directly to the existing player. The player's microphone/start gesture remains unchanged.
6. Amy-specific metadata avoids unsupported accuracy guarantees. Global non-Amy metadata remains untouched.

## Local verification evidence

- 27 focused route, entry and memory tests passed, including actual handlers with deny-by-default mocked external effects.
- Successful token fixture verifies approved persona, session tracking, enabled follow-up and disabled recall; no live provider request is made.
- TypeScript check passed.
- 103 Amy conversation/artifact tests passed before adding the new entry tests to the standard command.
- 38 email regression tests passed; no real email was sent by these tests.
- Broader suite: 404 passed, 1 skipped, 2 Dani knowledge checksum failures. Read-only diagnosis confirmed all 13 LF-normalized and committed file hashes match; local CRLF checkout causes the mismatch. Dani files were not edited.
- Default Turbopack initially failed on the worktree's shared dependency junction; webpack was also unsuitable for existing global CSS selectors. Neither configuration was changed. A separate temporary snapshot with `npm ci` and the unchanged `npm run build` subsequently PASSED, including TypeScript and 38 static pages. No live credentials were copied.
- Standard Amy regression command, now including entry hardening: 110 passed.
- Built local entry renders the visible disclosure, disabled returning-memory control and real privacy link. Without backend credentials it correctly reports check-in unavailable; this is not a successful live session rehearsal.

## Mandatory promotion gate — NOT YET COMPLETE

Use an authorized test identity and fictional facts. Do not probe real users' history or run destructive tests against production.

- Confirm checkpoint still resolves and compare candidate against it.
- Verify working production baseline via normal Amy entry/check-in.
- Verify candidate check-in and Anam startup using unchanged model/avatar.
- Hear a real conversation; check input/output audio and interruption behavior.
- Open a workbench artifact, correct a concrete fact, and confirm the visible revision.
- Make a late correction and finish the session cleanly, with no reopening or duplicate finalization.
- Confirm visitor recap, intake brief and operations record arrive exactly once in the expected inboxes and reflect final corrected facts.
- Check rendered disclosure, privacy navigation and missing-variant Amy bookmarks.
- Confirm no non-Amy functional/configuration changes.

Do not promote based only on unit tests, a build, or a provider token. Any required expansion beyond these boundaries needs owner review first.
