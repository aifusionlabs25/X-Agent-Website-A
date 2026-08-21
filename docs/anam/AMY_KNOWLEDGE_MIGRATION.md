# Amy knowledge v1 migration

Status: **local bundle verified; live migration not authorized or applied**

Amy's production persona is pinned to `0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08`, Cara 4 avatar `36e17abf-ef6c-4bef-99bd-3f925da155eb`, Jessica voice `b138c2a2-ba66-4887-95d5-1a57093fc92d`, and Qwen `65421f1c-c7de-4bc4-ac27-d171c16ef41f`.

## Why this is a clone-and-swap

In the dated pre-migration audit snapshot from 2026-08-20, the legacy `Knowledge_Amy` tool `9163bee5-493c-4552-97b4-4d32e6356872` was attached to both production Amy and the protected Preview persona. Its group, `Amy Insight SDR A`, had 24 READY documents but twelve duplicated filename pairs. The migration must not update that shared tool.

The guarded workflow instead:

1. reads every Anam persona and tool detail and proves both first-page inventories are complete;
2. proves the old tool is attached only to production Amy and the pinned Preview persona;
3. creates or safely reuses one versioned group named `Amy Insight SDR Anam KB 2026-08-20 v1`;
4. uploads only the eight files in `config/anam/amy/v1/knowledge-manifest.json`;
5. waits for all documents to report `READY`, downloads each one, and verifies exact bytes and SHA-256 hashes;
6. creates a new `Knowledge_Amy` SERVER_RAG tool with the source RAG configuration preserved and only `documentFolderIds` changed;
7. replaces only the old knowledge-tool ID on production Amy, preserving all other tool IDs and their order;
8. verifies Amy's prompt, greeting, Qwen, avatar, voice, settings, AgentMail, contact, Workbench, close, and every non-knowledge tool are unchanged;
9. verifies the Preview persona, old shared tool, and old group are byte-for-byte/state-hash unchanged for rollback.

Create requests are deliberately idempotent across ambiguous provider timeouts. A rerun reuses exactly one same-name versioned group only when its managed bundle description, allowlisted contents, and full-tool reference inventory prove it isolated. It reuses a managed tool only when the entire cloned config matches and no persona has attached it. Any duplicate, foreign reference, changed config, or non-exact orphan blocks the migration; the updater never deletes or “cleans up” provider state.

Anam already contains duplicate global tool names (`Knowledge_Liv`), so a second tool with the callable name `Knowledge_Amy` is supported by current provider evidence. If creation is rejected, the script stops before changing the production persona. It never silently falls back to a different callable name.

## Read-only commands

```powershell
npm run test:anam:amy-knowledge
npm run anam:update:amy-knowledge
npm run anam:audit:amy-knowledge
```

The updater defaults to a dry run. Before migration the expected result is `MIGRATION_REQUIRED`; the audit intentionally exits non-zero until a dedicated tool and exact group are pinned, attached, published, and verified.

## Guarded apply procedure

Do not run this procedure without explicit production approval.

1. Review the bundle and tests.
2. Change `deploymentStatus` from `draft` to `approved` or `publish_ready` and replace the manifest's no-sync sentence with a deliberate approval statement. The updater rejects `draft` and any source policy that still says external sync is unauthorized.
3. Rerun the dry run immediately and use its current hashes—never copied hashes from an older run.
4. Choose an absolute backup directory outside this repository.
5. Run:

```powershell
npm run anam:update:amy-knowledge -- --apply `
  --confirm=CONFIRM_AMY_KNOWLEDGE_V1_MIGRATION `
  --expected-provider-sha256=<dry-run provider hash> `
  --expected-preview-sha256=<dry-run Preview hash> `
  --expected-source-tool-sha256=<dry-run source-tool hash> `
  --expected-managed-tool-sha256=<dry-run value, normally ABSENT> `
  --expected-group-sha256=<dry-run group-landscape hash> `
  --backup-dir="C:\absolute\path\outside\the\repository"
```

The result returns the new group ID and tool ID. Pin them as `liveGroupId` and `liveToolId` in the knowledge manifest. After the guarded Workbench sync verifies, cross-pin those same IDs in `runtime-release-manifest.json`, populate every required runtime tool ID, exact prompt SHA-256, and `releasedAt`, then set the runtime manifest to `published`. Publish Amy in Anam only as part of that complete coordinated release and rerun both audits. `PASS` is allowed only when the new tool is dedicated to production Amy, the exact eight-document bundle is attached, no attached filename is duplicated, and the Preview/legacy isolation contract still holds.

If the production persona PUT times out after Anam commits it—or any later post-swap read-back fails—the updater automatically restores production Amy's original tool-ID list and verifies the production persona, Preview persona, and legacy tool against their pre-apply hashes. Even if the rollback PUT itself reports an ambiguous timeout, authoritative read-back determines whether rollback succeeded. The newly created isolated group/tool may remain unattached for deterministic reuse or diagnosis; the script never deletes provider data automatically.

## Runtime readiness contract

Runtime readiness now reads the cross-pinned manifests and requires:

- exact production persona ID;
- exact `Knowledge_Amy` tool ID equal to non-null `liveToolId`;
- type `SERVER_RAG` (provider persona summaries expose it as `server`);
- exact `config.documentFolderIds` equal to `[liveGroupId]`;
- the exact group ID and versioned folder name from the manifests;
- the exact group description `Amy-only public-safe KB. Bundle SHA-256: <bundleSha256>`;
- `liveToolId` and `liveGroupId` are non-null UUIDs.

Until both live IDs are pinned, readiness must report migration required rather than treating a matching tool name as sufficient.

## Rollback

The apply backup records the complete production and Preview personas, old shared tool, attachment usages, group landscape, and the original production tool ID. The old group and shared tool are never deleted or modified. Rollback is the inverse one-ID production persona swap back to `9163bee5-493c-4552-97b4-4d32e6356872`, followed by provider read-back and publication. Never attach the new dedicated tool to Preview or any other X Agent.
