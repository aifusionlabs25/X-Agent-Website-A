import { createJamesServer } from './server.ts';
import { CURRENT_JAMES_PERSONA_ID } from './state.ts';

// Separate cookies, encrypted state namespace and launch label. Both current
// James pages share this server; the legacy canary is isolated. No prompt/KB override.
export const { get, post } = createJamesServer({
    personaId: CURRENT_JAMES_PERSONA_ID,
    cookie: 'xagent_james_notepad_demo',
    prefix: 'xagent:james:notepad-demo:v1:',
    allowDemoEmail: true,
});
