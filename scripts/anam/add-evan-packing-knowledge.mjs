import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const API = 'https://api.anam.ai/v1';
const PERSONA = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
const TOOL = 'fc93e067-9254-4635-a4a6-645970d12548';
const GROUP = 'c9ad40d1-05ba-4cd6-84b4-f9fa90b1a112';
const FILE = '09_packing_fragile_dishes.md';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('Only --apply is supported. Dry-run is the default.');
const apply = args.includes('--apply');

const localEnv = await fs.readFile(new URL('.env.local', ROOT), 'utf8').catch(() => '');
const localKey = localEnv.match(/^ANAM_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
const key = process.env.ANAM_API_KEY?.trim() || localKey;
if (!key) throw new Error('ANAM_API_KEY is required and is never printed.');

async function anam(path, init = {}) {
    const response = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key}`, ...(init.body instanceof FormData ? {} : { Accept: 'application/json' }) },
        signal: AbortSignal.timeout(30_000), redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Anam ${init.method || 'GET'} ${path} failed (HTTP ${response.status}).`);
    return response.status === 204 ? null : response.json();
}

const rowsOf = payload => Array.isArray(payload) ? payload : payload?.data ?? payload?.items ?? payload?.tools ?? payload?.documents ?? payload?.personas ?? [];
const idOf = value => value?._toolId ?? value?.id ?? null;
const manifest = JSON.parse(await fs.readFile(new URL('config/anam/evan/knowledge-manifest.json', ROOT), 'utf8'));
const bytes = await fs.readFile(new URL(`config/anam/evan/knowledge/${FILE}`, ROOT));
if (manifest.folderId !== GROUP || manifest.documents.at(-1) !== FILE || manifest.documents.length !== 9) {
    throw new Error('The isolated Evan knowledge manifest does not match this bounded update.');
}

async function preflight() {
    const [persona, tool, toolsPayload, personasPayload, sessions, documentsPayload] = await Promise.all([
        anam(`/personas/${PERSONA}`), anam(`/tools/${TOOL}`), anam('/tools?perPage=100'),
        anam('/personas?perPage=100'),
        anam(`/sessions?personaId=${PERSONA}&active=true&perPage=100`),
        anam(`/knowledge/groups/${GROUP}/documents`),
    ]);
    if (persona.id !== PERSONA || !(persona.tools ?? []).some(item => idOf(item) === TOOL)
        || tool.type !== 'SERVER_RAG' || JSON.stringify(tool.config?.documentFolderIds) !== JSON.stringify([GROUP])) {
        throw new Error('Evan persona, knowledge tool, or isolated folder identity changed.');
    }
    if (sessions.meta?.total !== 0 || rowsOf(sessions).length !== 0) throw new Error('Evan has an active session.');
    const groupTools = rowsOf(toolsPayload).filter(item => item.config?.documentFolderIds?.includes(GROUP));
    if (groupTools.length !== 1 || idOf(groupTools[0]) !== TOOL) throw new Error('Another tool references Evan knowledge.');
    const personas = rowsOf(personasPayload);
    if (personasPayload.meta?.total !== personas.length) throw new Error('Persona inventory was incomplete.');
    const details = await Promise.all(personas.map(item => anam(`/personas/${item.id}`)));
    const users = details.filter(item => item.tools?.some(attached => idOf(attached) === TOOL));
    if (users.length !== 1 || users[0].id !== PERSONA) throw new Error('Another persona uses Evan knowledge.');
    const documents = rowsOf(documentsPayload);
    if (documents.some(item => item.status !== 'READY')
        || new Set(documents.map(item => item.filename)).size !== documents.length
        || documents.some(item => !manifest.documents.includes(item.filename))
        || manifest.documents.slice(0, -1).some(filename => !documents.some(item => item.filename === filename))) {
        throw new Error('The existing Evan knowledge documents changed or are not ready.');
    }
    return documents;
}

async function verifyDocument(document) {
    const linkResponse = await anam(`/knowledge/documents/${encodeURIComponent(document.id)}/download`);
    const url = linkResponse?.downloadUrl ?? linkResponse?.url ?? linkResponse?.signedUrl;
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Anam did not return a signed document URL.');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Anam knowledge download failed (HTTP ${response.status}).`);
    const remote = Buffer.from(await response.arrayBuffer());
    const sha = value => createHash('sha256').update(value).digest('hex');
    if (sha(remote) !== sha(bytes)) throw new Error('The added knowledge document did not match local bytes.');
}

const before = await preflight();
const existing = before.find(item => item.filename === FILE);
if (!existing && apply) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'text/markdown' }), FILE);
    form.append('chunkSize', '800');
    form.append('chunkOverlap', '120');
    // Do not retry an ambiguous POST: inspect the folder before trying again.
    await anam(`/knowledge/groups/${GROUP}/documents`, { method: 'POST', body: form });
}
if (apply) {
    let ready = existing;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
        const documents = rowsOf(await anam(`/knowledge/groups/${GROUP}/documents`));
        if (documents.some(item => item.filename === FILE && item.status === 'FAILED')) throw new Error('Anam rejected the new knowledge document.');
        ready = documents.find(item => item.filename === FILE && item.status === 'READY');
        if (!ready) await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    if (!ready) throw new Error('Anam did not finish processing the new knowledge document.');
    await verifyDocument(ready);
    const after = await preflight();
    if (after.length !== 9) throw new Error('The final knowledge folder does not have exactly nine ready documents.');
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidatePersonaId: PERSONA,
    existingDocumentCount: before.length, document: FILE, alreadyPresent: Boolean(existing),
    readyAndByteVerified: apply, otherAgentsChanged: false }, null, 2));
