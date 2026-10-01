import { createJamesServer } from './server.ts';
import { CURRENT_JAMES_PERSONA_ID } from './state.ts';

// Separate cookies, encrypted state namespace and launch label. The original
// public James route, legacy canary, persona prompt and KB are not modified.
export const { get, post } = createJamesServer({
    personaId: CURRENT_JAMES_PERSONA_ID,
    cookie: 'xagent_james_notepad_demo',
    prefix: 'xagent:james:notepad-demo:v1:',
    allowDemoEmail: true,
});
