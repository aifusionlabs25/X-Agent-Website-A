import { assertEvanDemoCloneMatches, expectedEvanDemoCheckpoint } from './evan-demo-persona.ts';
import type { EvanDemoSavedPersona } from './evan-demo-persona.ts';
import type { EvanDemoPolicy } from './evan-demo-policy.ts';

export async function verifyEvanDemoPersona(apiKey: string, policy: EvanDemoPolicy, fetchImpl: typeof fetch = fetch): Promise<void> {
    async function read(id: string): Promise<EvanDemoSavedPersona> {
        const response = await fetchImpl(`https://api.anam.ai/v1/personas/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store', signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error('Evan demo configuration could not be verified');
        return response.json();
    }
    const source = expectedEvanDemoCheckpoint();
    const clone = await read(policy.providerPersonaId);
    assertEvanDemoCloneMatches({ source, clone, expectedCloneId: policy.providerPersonaId, maxSessionLengthSeconds: policy.maxSeconds });
}
