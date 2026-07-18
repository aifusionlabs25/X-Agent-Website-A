import { readAmyAnamSpineConfig } from './session-spine.ts';

export type AmyAnamAgentMailConfig = {
    implemented: true;
    provider: 'agentmail' | 'off' | 'unsupported';
    enabled: boolean;
    killSwitchActive: boolean;
    toolsEnabled: boolean;
    toolsKillSwitchActive: boolean;
    outboundEnabled: boolean;
    outboundKillSwitchActive: boolean;
    configured: boolean;
    requestedGateOpen: boolean;
    effectiveGateOpen: boolean;
    inboxAddressConfigured: boolean;
    apiKeyConfigured: boolean;
    redisUrl: string;
    redisToken: string;
};

function value(source: NodeJS.ProcessEnv, name: string): string {
    return String(source[name] ?? '')
        .trim()
        .replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF)+/, '')
        .replace(/(?:\\r|\\n)+$/, '')
        .trim();
}

export function readAmyAnamAgentMailConfig(
    source: NodeJS.ProcessEnv = process.env,
): AmyAnamAgentMailConfig {
    const spine = readAmyAnamSpineConfig(source);
    const providerName = value(source, 'AMY_EMAIL_PROVIDER').toLowerCase();
    const provider: AmyAnamAgentMailConfig['provider'] = providerName === 'agentmail'
        ? 'agentmail'
        : providerName === 'off' || !providerName
            ? 'off'
            : 'unsupported';
    const apiKeyConfigured = value(source, 'AGENTMAIL_API_KEY').length >= 16;
    const inboxAddress = value(source, 'AMY_AGENTMAIL_ADDRESS').toLowerCase();
    const inboxAddressConfigured = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inboxAddress);
    const enabled = value(source, 'AMY_ANAM_AGENTMAIL_ENABLED') === 'true';
    const killSwitchActive = value(source, 'AMY_ANAM_AGENTMAIL_KILL_SWITCH') !== 'false';
    const toolsEnabled = value(source, 'AMY_ANAM_TOOLS_ENABLED') === 'true';
    const toolsKillSwitchActive = value(source, 'AMY_ANAM_TOOLS_KILL_SWITCH') !== 'false';
    const outboundEnabled = value(source, 'AMY_ANAM_OUTBOUND_ACTIONS_ENABLED') === 'true';
    const outboundKillSwitchActive = value(source, 'AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH') !== 'false';
    const configured = provider === 'agentmail'
        && apiKeyConfigured
        && inboxAddressConfigured
        && spine.configured;
    const requestedGateOpen = enabled
        && !killSwitchActive
        && toolsEnabled
        && !toolsKillSwitchActive
        && outboundEnabled
        && !outboundKillSwitchActive;

    return {
        implemented: true,
        provider,
        enabled,
        killSwitchActive,
        toolsEnabled,
        toolsKillSwitchActive,
        outboundEnabled,
        outboundKillSwitchActive,
        configured,
        requestedGateOpen,
        effectiveGateOpen: configured && requestedGateOpen && spine.gatesOpen,
        inboxAddressConfigured,
        apiKeyConfigured,
        redisUrl: spine.redisUrl,
        redisToken: spine.redisToken,
    };
}
