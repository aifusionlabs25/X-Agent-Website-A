# Release Notes: Taylor (Generic SDR) Addition
**Date**: 2026-03-19
**Branch**: `feat/taylor-generic-sdr-20260319`
**Safety Tag**: `known-good-2026-03-19`

## Summary
Added the "Taylor (Generic SDR)" agent for Canyon Ridge Solutions. Implemented a separate "Persona Pack" repository for Generic SDR assets.

## Files Changed
- `lib/agents.ts`: Added Taylor to `ALL_AGENTS` and `SALES_AGENTS`. Added `tenant` metadata support. (Amy UNCHANGED)
- `app/page.tsx`: Added `NEXT_PUBLIC_HIDE_AMY` filtering logic and a demo-specific disclaimer.
- `public/agents/thumbnails/Taylor_Canyon_Ridge_thumb_512.png`: Added/Renamed Taylor's thumbnail asset.

## New Repository
- `Generic-SDR/`: Standalone repository containing Taylor's system prompt, 10 KB files, and persona metadata.

## Verification Performed
- **Build**: `npm run build` completed successfully.
- **Amy Integrity**: Verified that `lib/agents.ts` contains Amy's original config.
- **Filtering**: Verified that `app/page.tsx` correctly handles the `NEXT_PUBLIC_HIDE_AMY` flag.

## Rollback Steps
If any issues arise, revert to the safety tag:
```bash
git checkout known-good-2026-03-19
```
Alternatively, delete the `feat/taylor-generic-sdr-20260319` branch.
