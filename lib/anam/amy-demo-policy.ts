// A release-level safety boundary, separate from the existing check-in flags.
// Do not enable returning memory until server-verified email ownership exists.
// Stored history and operator review are preserved; public recall/delete are paused.
export const AMY_RETURNING_MEMORY_AVAILABLE: boolean = false;
export const AMY_MEMORY_ACCESS_MODE = 'fresh_session_only' as const;
export const AMY_MEMORY_PAUSED_MESSAGE =
    'Returning memory is paused for this demo. Your current conversation and email follow-up are still available.';
