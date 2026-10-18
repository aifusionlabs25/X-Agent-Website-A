const LOCAL_BASE = 'https://access.invalid';

/** Keep the complete local destination without accepting an external redirect. */
export function safeAccessReturnTo(value: unknown, fallback = '/'): string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
        || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
    try {
        const url = new URL(value, LOCAL_BASE);
        const decodedPath = decodeURIComponent(url.pathname);
        if (url.origin !== LOCAL_BASE || decodedPath.startsWith('//')
            || /[\\\u0000-\u001f\u007f]/.test(decodedPath)) return fallback;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return fallback;
    }
}
