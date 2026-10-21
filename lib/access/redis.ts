import { Redis, type Requester } from '@upstash/redis';
import { createHash } from 'node:crypto';
import { AccessUnavailableError, readAccessRedisConfig } from './auth-config.ts';

export async function accessRedisCommand(command: (string | number)[]): Promise<unknown> {
    const config = readAccessRedisConfig();
    if (!config.configured || !command.length || command.length > 100 || JSON.stringify(command).length > 131072) {
        throw new AccessUnavailableError();
    }
    try {
        // Preview keys are isolated from production and other preview branches,
        // even when the hosting integration points at the same Redis instance.
        if (process.env.VERCEL_ENV === 'preview') command = previewAccessCommand(command);
        const response = await fetch(config.url, {
            method: 'POST', cache: 'no-store', redirect: 'error',
            headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(command), signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new AccessUnavailableError();
        const reader = response.body?.getReader();
        if (!reader) throw new AccessUnavailableError();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1048576) { await reader.cancel(); throw new AccessUnavailableError(); }
            chunks.push(value);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!payload || payload.error || !Object.prototype.hasOwnProperty.call(payload, 'result')) throw new AccessUnavailableError();
        return payload.result;
    } catch { throw new AccessUnavailableError(); }
}

export function previewAccessCommand(command: (string | number)[]): (string | number)[] {
    const scope = process.env.VERCEL_GIT_COMMIT_REF || process.env.VERCEL_URL;
    if (!scope) throw new AccessUnavailableError();
    const prefix = `xagent:preview:${createHash('sha256').update(scope).digest('hex').slice(0, 24)}:`;
    const result = [...command];
    const op = String(command[0]).toUpperCase();
    const indices = op === 'EVAL' ? Array.from({ length: Number(command[2]) }, (_, index) => index + 3)
        : ['MGET', 'DEL'].includes(op) ? command.slice(1).map((_, index) => index + 1)
            : ['GET', 'GETDEL', 'SET', 'SMEMBERS', 'SADD', 'SREM', 'ZREVRANGE'].includes(op) ? [1] : [];
    if (!indices.length) throw new AccessUnavailableError();
    for (const index of indices) {
        const key = String(result[index]);
        result[index] = key.startsWith(prefix) ? key : prefix + key;
    }
    return result;
}

// The maintained adapter still uses the official SDK for command serialization
// and JSON hydration. Its transport shares the bounded, no-retry REST helper.
export function createAccessRedisClient(): Redis {
    const requester: Requester = {
        async request<TResult>({ body }: Parameters<Requester['request']>[0]) {
            if (!Array.isArray(body) || body.some(value => typeof value !== 'string' && typeof value !== 'number')) {
                throw new AccessUnavailableError();
            }
            return { result: await accessRedisCommand(body) as TResult };
        },
    };
    return new Redis(requester);
}
