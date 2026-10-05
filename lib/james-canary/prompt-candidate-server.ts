import { createJamesServer } from './server.ts';

export const JAMES_PROMPT_CANDIDATE_ID = '016e2c66-166b-43bd-8ebf-70b56c46575c';

// Keep candidate sessions, browser authorization, and receipts separate from
// the canonical James legal-pad route. The persona is fixed server-side.
export const { get, post, recover } = createJamesServer({
    personaId: JAMES_PROMPT_CANDIDATE_ID,
    cookie: 'xagent_james_prompt_candidate',
    prefix: 'xagent:james:prompt-candidate:v1:',
    allowDemoEmail: true,
    runtimeClose: true,
});
