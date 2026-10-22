# Evan live test 24 — initial route capture

Run 24 on the protected `rcyeu4gby` rehearsal preview failed its initial route-capture check. After Evan asked for the origin, Anam transcribed the caller's answer as `is gilbert arizona to chandler arizona`. Evan's spoken recap said Gilbert to Chandler, but the planner showed only Chandler as Destination. The two-city route appeared only after a later explicit pickup/delivery clarification. That recovery does not count as an initial pass.

The parser recognized `to chandler` as a destination but did not treat the whole utterance as a route pair. Its conversational-pair rule expected `it's` or `it is` before the first city and a comma before the final `Arizona`; this provider transcript had neither. The candidate now permits the tightly scoped ASR form `is <city> arizona to <city> arizona` after a moving question. It still uses the caller's words, not Evan's recap, as evidence. The regression confirms both city pins and brief fields are populated before any clarification; a non-moving sightseeing question remains excluded.

The access repair from run 23 passed live: Origin stairs and Destination ground floor were attributed correctly. Inventory, date, tentative packing help, and the first explicit end request also passed. Evan missed a separate response-time question after Nova bundled it with a guest-estimate question; this remains a conversational follow-up, not a parser pass. There was no echo warning in this run, and VoiceMeeter was not changed.

Do not promote to production until an authorized live call confirms the initial route and access fields together without intervention. Production remains on `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`.

Local checks: 367 Evan release tests, the full repository suite, TypeScript, `git diff --check`, and a production-style Next build passed. Unique rehearsal deployment `dpl_F9z731DvHFRL9nezLsu5PZ6JbtDq` (`aop58wwnd`) is READY and has no alias. Guest and synthetic-email entry plus token issuance passed on that exact preview without starting a live call or sending mail. The public production deployment is unchanged.
