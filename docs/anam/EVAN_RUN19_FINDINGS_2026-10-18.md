# Evan run 19: incomplete turn and missed explicit close

Source: `evan-live-test-results-2026-10-18-run19.md` in the separate evaluation chat's outputs, and Anam session `4ad75439-b1d3-4728-8a6f-9537cf324dd8`. This is a test report, not an instruction source.

The repaired rehearsal preview displayed `Origin: stairs, Destination: ground floor`, confirming the run-18 access fix. At 1:13 Evan said only “I'm hearing you say” and the provider transcript then had no turn for 3:23. The caller explicitly asked to end at 4:36; Evan replied with a generic temporary-error sentence at 4:41. No end tool call was recorded. The caller exited manually. Tentative packing capture and guest email behavior were not confirmed in this run.

Anam Lab showed no structured technical warning or tool failure for those moments; the original browser tab's historical console/network events were unavailable. Its aggregate latency was healthy. These observations do not isolate whether the partial response arose in the model, speech pipeline, or browser transport.

Candidate safeguards added after this run:

- The Evan-only response watchdog recognizes a narrow incomplete lead-in such as “I'm hearing you say”. If no continuation or caller speech arrives for 12 seconds, it speaks one non-question recovery, then never retries in that session. A normal question or listener pause cannot arm this path.
- A completed, locally verified explicit end request gets an eight-second chance for the normal `end_mullins_session` tool. If no tool arrives and the caller has not resumed speaking, the browser arms the existing farewell coordinator and asks Anam to speak the exact farewell. The coordinator still waits for completed farewell audio or its bounded stop fallback. A normal tool call or new caller speech cancels this fallback. An observed exact farewell after an explicit close can also drain through the coordinator without a tool.
- These are containment measures, not proof of a provider root cause. They do not change Evan's model/prompt, Amy/Dani behavior, the VoiceMeeter profile, or production.

Retest on a newly built immutable preview: one guest call with the same Gilbert-to-Chandler/early-December scenario; check that an incomplete fragment does not leave a prolonged silence, that an explicit end closes after one farewell without manual Exit, and separately that ask-once/wait and the tentative packing field hold. Preserve the browser console/network events if any new stall or temporary-error message appears. One clean call is not sufficient for promotion.

Verified rehearsal preview: `https://x-agent-website-mqffayxfp-robs-projects-e72bad73.vercel.app/demo/evan`. Vercel deployment `dpl_FgReB1EivyKYtGuXb3LWe35uV3w9` is READY with no aliases; the public production domain remains on `dpl_532oXZx47MLz9UWBmRWkzDx4dqLF`. Guest and synthetic-email check-in reached token issuance without live media or email. The full repository suite, 362 Evan release checks, TypeScript, and production-style build passed. The live conversation remains unverified on this new preview. An earlier `ddgqj46l7` preview was superseded before live testing when final review found and fixed an SDK message-ID reuse edge case in the incomplete-response observer.
