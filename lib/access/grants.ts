import { createHash, randomUUID } from 'node:crypto';
import { ALL_AGENTS } from '../agents.ts';
import { accessRedisCommand } from './redis.ts';

export const ACCESS_CAPABILITIES = ['conversation', 'meeting', 'actions'] as const;
export type AccessCapability = typeof ACCESS_CAPABILITIES[number];
export type AccessRecord = {
    email: string;
    agent: string;
    capabilities: AccessCapability[];
    requestedCapabilities?: AccessCapability[];
    status: 'pending' | 'approved' | 'revoked' | 'declined';
    expiresAt: string | null;
    updatedAt: string;
    updatedBy: string;
    notificationId?: string;
    notificationKind?: 'request' | 'decision';
};

const PREFIX = 'xagent:access:policy:v1:';
const INDEX = `${PREFIX}index`;
const RECORD_TTL = 120 * 24 * 60 * 60;
const AGENTS = new Set(ALL_AGENTS.map(agent => agent.slug));

type AccessBrowserBinding = { userId: string; email: string; agent: string; browserId: string };

function browserKey(agent: string, browserId: string): string {
    if (!isAccessAgent(agent) || !/^[a-zA-Z0-9._:-]{8,200}$/.test(browserId)) throw new Error('Invalid browser binding');
    return `${PREFIX}browser:${agent}:${browserId}`;
}

export async function storeAccessBrowser(binding: AccessBrowserBinding): Promise<void> {
    if (!binding.userId || normalizeAccessEmail(binding.email) !== binding.email) throw new Error('Invalid access identity');
    const result = await accessRedisCommand(['SET', browserKey(binding.agent, binding.browserId), JSON.stringify(binding), 'NX', 'EX', 24 * 3600]);
    if (result !== 'OK') {
        const existing = await readAccessBrowser(binding.agent, binding.browserId);
        if (existing?.userId !== binding.userId || existing.email !== binding.email) throw new Error('Browser already belongs to another account');
    }
}

export async function readAccessBrowser(agent: string, browserId: string): Promise<AccessBrowserBinding | null> {
    const raw = await accessRedisCommand(['GET', browserKey(agent, browserId)]);
    if (raw === null) return null;
    const binding = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!binding || binding.agent !== agent || binding.browserId !== browserId || typeof binding.userId !== 'string'
        || normalizeAccessEmail(binding.email) !== binding.email) throw new Error('Invalid browser binding');
    return binding;
}

export function isAccessAgent(value: unknown): value is string {
    return typeof value === 'string' && AGENTS.has(value);
}

export function isAccessCapability(value: unknown): value is AccessCapability {
    return ACCESS_CAPABILITIES.includes(value as AccessCapability);
}

export function normalizeAccessEmail(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Enter a valid email address');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) {
        throw new Error('Enter a valid email address');
    }
    return email;
}

function recordId(email: string, agent: string): string {
    if (!isAccessAgent(agent)) throw new Error('Unknown agent');
    return createHash('sha256').update(`${normalizeAccessEmail(email)}\0${agent}`).digest('hex');
}

function parseRecord(raw: unknown): AccessRecord | null {
    if (raw === null) return null;
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!record || !isAccessAgent(record.agent) || !Array.isArray(record.capabilities)
        || !record.capabilities.every(isAccessCapability)
        || (record.requestedCapabilities !== undefined && (!Array.isArray(record.requestedCapabilities) || !record.requestedCapabilities.every(isAccessCapability)))
        || !['pending', 'approved', 'revoked', 'declined'].includes(record.status)
        || typeof record.updatedAt !== 'string'
        || (record.expiresAt !== null && !Number.isFinite(Date.parse(record.expiresAt)))
        || normalizeAccessEmail(record.email) !== record.email) {
        throw new Error('Access record is invalid');
    }
    return record as AccessRecord;
}

export async function readAccessRecord(email: string, agent: string): Promise<AccessRecord | null> {
    const record = parseRecord(await accessRedisCommand(['GET', `${PREFIX}record:${recordId(email, agent)}`]));
    if (record && (record.email !== normalizeAccessEmail(email) || record.agent !== agent)) {
        throw new Error('Access record identity did not match');
    }
    return record;
}

export function recordAllows(record: AccessRecord | null, capability: AccessCapability, now = Date.now()): boolean {
    return record?.status === 'approved' && record.capabilities.includes(capability)
        && record.expiresAt !== null && Date.parse(record.expiresAt) > now;
}

export async function writeAccessRecord(record: AccessRecord): Promise<void> {
    parseRecord(record);
    const id = recordId(record.email, record.agent);
    // The record and dashboard index change together; expired rows are trimmed.
    await accessRedisCommand(['EVAL',
        "redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4]); redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',ARGV[5]); return 1",
        2, `${PREFIX}record:${id}`, INDEX, JSON.stringify(record), RECORD_TTL,
        Date.parse(record.updatedAt), id, Date.now() - RECORD_TTL * 1000,
    ]);
}

export async function requestAccess(email: string, agent: string, capability: AccessCapability): Promise<AccessRecord> {
    const id = recordId(email, agent);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const raw = await accessRedisCommand(['GET', `${PREFIX}record:${id}`]);
        const existing = parseRecord(raw);
        const active = existing?.status === 'approved' && existing.expiresAt && Date.parse(existing.expiresAt) > Date.now();
        if (active && existing.capabilities.includes(capability)) return existing;
        if (existing?.notificationId && ((active && existing.requestedCapabilities?.includes(capability))
            || (existing.status === 'pending' && existing.capabilities.includes(capability)))) return existing;
        const record: AccessRecord = active ? {
            ...existing, requestedCapabilities: [...new Set([...(existing.requestedCapabilities ?? []), capability])],
            updatedAt: new Date().toISOString(),
        } : {
            email: normalizeAccessEmail(email), agent,
            capabilities: [...new Set([...(existing?.status === 'pending' ? existing.capabilities : []), capability])],
            requestedCapabilities: [], status: 'pending', expiresAt: null,
            updatedAt: new Date().toISOString(), updatedBy: normalizeAccessEmail(email),
        };
        record.notificationId = randomUUID();
        record.notificationKind = 'request';
        // A concurrent owner decision must never be overwritten by a request.
        const saved = await accessRedisCommand(['EVAL',
            "local old=redis.call('GET',KEYS[1]); if (old or '')~=ARGV[5] then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4]); return 1",
            2, `${PREFIX}record:${id}`, INDEX, JSON.stringify(record), RECORD_TTL, Date.now(), id,
            raw === null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw),
        ]);
        if (saved === 1) return record;
    }
    throw new Error('Access changed concurrently. Please try again.');
}

export async function listDisabledAccessAgents(): Promise<string[]> {
    const result = await accessRedisCommand(['SMEMBERS', `${PREFIX}disabled`]);
    if (!Array.isArray(result) || !result.every(isAccessAgent)) throw new Error('Agent access settings are invalid');
    return result;
}

export async function setAccessAgentDisabled(agent: string, disabled: boolean): Promise<void> {
    if (!isAccessAgent(agent)) throw new Error('Unknown agent');
    await accessRedisCommand([disabled ? 'SADD' : 'SREM', `${PREFIX}disabled`, agent]);
}

export async function listAccessRecords(): Promise<AccessRecord[]> {
    const ids = await accessRedisCommand(['ZREVRANGE', INDEX, 0, 199]);
    if (!Array.isArray(ids)) throw new Error('Access index is unavailable');
    if (!ids.length) return [];
    if (ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new Error('Access index is invalid');
    const batches = [];
    for (let index = 0; index < ids.length; index += 80) {
        batches.push(accessRedisCommand(['MGET', ...ids.slice(index, index + 80).map(id => `${PREFIX}record:${id}`)]));
    }
    const results = await Promise.all(batches);
    if (results.some(result => !Array.isArray(result))) throw new Error('Access records are unavailable');
    const raw = results.flat() as unknown[];
    return raw.map(parseRecord).filter((record): record is AccessRecord => record !== null);
}

export async function consumeAccessRate(key: string, limit: number, seconds: number): Promise<boolean> {
    const digest = createHash('sha256').update(key).digest('hex');
    const count = await accessRedisCommand(['EVAL',
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        1, `${PREFIX}rate:${digest}`, seconds,
    ]);
    if (typeof count !== 'number') throw new Error('Access limiter is unavailable');
    return count <= limit;
}
