// Browser UX/fallback only. The provider's saved persona enforces the real limit.
export function createEvanDemoClock(maxSeconds: number, now = () => Date.now()) {
    if (maxSeconds !== 180 && maxSeconds !== 1800) throw new Error('Invalid Evan demo duration');
    let deadline: number | null = null;
    let expired = false;
    return {
        start() { if (deadline === null) deadline = now() + maxSeconds * 1000; },
        read() {
            const remaining = deadline === null ? maxSeconds : Math.max(0, Math.ceil((deadline - now()) / 1000));
            const justExpired = deadline !== null && remaining === 0 && !expired;
            if (justExpired) expired = true;
            return { remaining, justExpired, started: deadline !== null };
        },
    };
}

export function formatEvanDemoTime(seconds: number) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
