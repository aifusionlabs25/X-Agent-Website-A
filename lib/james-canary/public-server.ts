import { createJamesServer } from './server.ts';
import { RUNTIME_CANDIDATE_ID } from './runtime-session.ts';

// The public James path uses the bounded candidate runtime, but never shares
// browser authorization or encrypted session keys with the previous release.
// The prior persona and v1 store remain intact for an immediate code rollback.
export const { get, post } = createJamesServer({
    personaId: RUNTIME_CANDIDATE_ID,
    cookie: 'xagent_james_notepad_v2',
    prefix: 'xagent:james:notepad:v2:',
    allowDemoEmail: true,
    allowEmail: false,
    runtimeClose: true,
});
