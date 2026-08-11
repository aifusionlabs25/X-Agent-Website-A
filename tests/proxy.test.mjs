import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const proxyPath = resolve(root, 'proxy.ts');
const middlewarePath = resolve(root, 'middleware.ts');
const proxySource = existsSync(proxyPath) ? readFileSync(proxyPath, 'utf8') : '';

async function loadProxyContract() {
    globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
    const { NextResponse } = await import('next/server.js');
    const executableSource = proxySource
        .replace(/^import \{ NextResponse \} from 'next\/server';\r?\n/m, '')
        .replace(/export function proxy/, 'function proxy')
        .replace(/export const config/, 'const config');

    return Function(
        'NextResponse',
        `'use strict';\n${executableSource}\nreturn { proxy, config };`,
    )(NextResponse);
}

test('Next 16 uses only the root proxy convention and named proxy export', () => {
    assert.equal(existsSync(proxyPath), true);
    assert.equal(existsSync(middlewarePath), false);
    assert.match(proxySource, /export function proxy\(\)/);
    assert.doesNotMatch(proxySource, /export (?:default )?function middleware\b/);
    assert.doesNotMatch(proxySource, /NextRequest|runtime\s*:/);
});

test('proxy matcher includes pages and excludes API, Next internals, favicon, and image assets', async () => {
    const { config } = await loadProxyContract();
    const testing = await import('next/experimental/testing/server.js');
    const doesProxyMatch = testing.unstable_doesProxyMatch
        ?? testing.unstable_doesMiddlewareMatch
        ?? testing.default?.unstable_doesProxyMatch
        ?? testing.default?.unstable_doesMiddlewareMatch;

    assert.equal(typeof doesProxyMatch, 'function');

    const matches = (url) => doesProxyMatch({ config, nextConfig: {}, url });
    assert.equal(matches('/'), true);
    assert.equal(matches('/agents/amy'), true);
    assert.equal(matches('/api/anam-token'), false);
    assert.equal(matches('/_next/static/chunks/app.js'), false);
    assert.equal(matches('/_next/image?url=%2Fagents%2Famy.png'), false);
    assert.equal(matches('/favicon.ico'), false);
    assert.equal(matches('/agents/amy.png'), false);
    assert.equal(matches('/agents/amy.jpg'), false);
    assert.equal(matches('/agents/amy.webp'), false);
});

test('proxy passes through normally and returns the branded 503 only in maintenance mode', async () => {
    const { proxy } = await loadProxyContract();
    const previousMaintenanceMode = process.env.MAINTENANCE_MODE;

    try {
        delete process.env.MAINTENANCE_MODE;
        const passThrough = proxy();
        assert.equal(passThrough.status, 200);
        assert.equal(passThrough.headers.get('x-middleware-next'), '1');

        process.env.MAINTENANCE_MODE = 'true';
        const maintenance = proxy();
        assert.equal(maintenance.status, 503);
        assert.match(maintenance.headers.get('content-type') ?? '', /^text\/html/i);
        const maintenanceHtml = await maintenance.text();
        assert.match(maintenanceHtml, /System Upgrade in Progress/);
        assert.match(maintenanceHtml, /X-Agent platform is currently down/);
    } finally {
        if (previousMaintenanceMode === undefined) {
            delete process.env.MAINTENANCE_MODE;
        } else {
            process.env.MAINTENANCE_MODE = previousMaintenanceMode;
        }
    }
});
