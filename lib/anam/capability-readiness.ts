import { readAmyAnamHermesShadowConfig } from './hermes-shadow.ts';
import { readAmyAnamRecoveryConfig } from './session-recovery.ts';
import { readAmyAnamSpineConfig } from './session-spine.ts';
import { readAmyAnamMemoryConfig } from './user-memory.ts';

type DisabledCapabilityReadiness = {
    implemented: false;
    enabled: boolean;
    killSwitchActive: boolean;
    requestedGateOpen: boolean;
    effectiveGateOpen: false;
};

function value(source: NodeJS.ProcessEnv, name: string): string {
    return String(source[name] ?? '')
        .trim()
        .replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF)+/, '')
        .replace(/(?:\\r|\\n)+$/, '')
        .trim();
}

function disabledCapability(
    source: NodeJS.ProcessEnv,
    prefix: 'AMY_ANAM_AGENTMAIL' | 'AMY_ANAM_TOOLS',
): DisabledCapabilityReadiness {
    const enabled = value(source, `${prefix}_ENABLED`) === 'true';
    const killSwitchActive = value(source, `${prefix}_KILL_SWITCH`) !== 'false';
    return {
        implemented: false,
        enabled,
        killSwitchActive,
        requestedGateOpen: enabled && !killSwitchActive,
        effectiveGateOpen: false,
    };
}

export function buildAmyAnamCapabilityReadiness(
    source: NodeJS.ProcessEnv = process.env,
) {
    const spine = readAmyAnamSpineConfig(source);
    const recovery = readAmyAnamRecoveryConfig(source);
    const hermes = readAmyAnamHermesShadowConfig(source);
    const memory = readAmyAnamMemoryConfig(source);
    const outboundEnabled = value(source, 'AMY_ANAM_OUTBOUND_ACTIONS_ENABLED') === 'true';
    const outboundKillSwitchActive = value(source, 'AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH') !== 'false';

    return {
        schemaVersion: 'amy_anam_capability_readiness_v1' as const,
        agentSlug: 'amy' as const,
        provider: 'anam' as const,
        phase: 'post_session_shadow' as const,
        environment: value(source, 'VERCEL_ENV') || 'local',
        sessionSpine: {
            enabled: spine.enabled,
            configured: spine.configured,
            killSwitchActive: spine.killSwitchActive,
            gatesOpen: spine.gatesOpen,
        },
        recovery: {
            enabled: recovery.enabled,
            killSwitchActive: recovery.killSwitchActive,
            authenticationConfigured: recovery.authenticationConfigured,
            productionApprovalRequired: recovery.productionApprovalRequired,
            productionPromotionApproved: recovery.productionPromotionApproved,
            gatesOpen: recovery.gatesOpen && spine.gatesOpen,
            dailyBackstopCommitted: true,
            productionSchedulerObserved: false,
            qstashConfigured: Boolean(
                value(source, 'QSTASH_TOKEN')
                && value(source, 'QSTASH_CURRENT_SIGNING_KEY')
                && value(source, 'QSTASH_NEXT_SIGNING_KEY')
            ),
            contentFree: true,
        },
        hermesShadow: {
            enabled: hermes.enabled,
            mode: hermes.mode,
            killSwitchActive: hermes.killSwitchActive,
            queueConfigured: hermes.queueConfigured,
            gatesOpen: hermes.gatesOpen && spine.gatesOpen,
            postSessionOnly: true,
            pointerOnlyQueue: true,
            localWorkerRequired: true,
            cloudContentAllowed: false,
        },
        memory: {
            implemented: true,
            enabled: memory.enabled,
            configured: memory.configured,
            killSwitchActive: memory.killSwitchActive,
            requestedGateOpen: memory.enabled && !memory.killSwitchActive,
            effectiveGateOpen: memory.gatesOpen,
            consentBound: true,
            operatorApprovalRequired: true,
            promotionEnabled: memory.promotionEnabled,
            promotionKillSwitchActive: memory.promotionKillSwitchActive,
            promotionConfigured: memory.promotionConfigured,
            promotionGateOpen: memory.promotionGatesOpen,
            rawEmailStored: false,
            maxApprovedRecords: 8,
        },
        tools: {
            ...disabledCapability(source, 'AMY_ANAM_TOOLS'),
            invocationsPerformed: 0,
        },
        agentMail: {
            ...disabledCapability(source, 'AMY_ANAM_AGENTMAIL'),
            providerForcedOff: value(source, 'AMY_EMAIL_PROVIDER') === 'off',
            emailsSent: 0,
        },
        globalOutbound: {
            implemented: false,
            enabled: outboundEnabled,
            killSwitchActive: outboundKillSwitchActive,
            requestedGateOpen: outboundEnabled && !outboundKillSwitchActive,
            effectiveGateOpen: false,
            actionsPerformed: 0,
        },
        productionPromotionApproved: recovery.productionPromotionApproved,
        outboundActionTaken: false,
        contentIncluded: false,
    };
}

export type AmyAnamCapabilityReadiness = ReturnType<typeof buildAmyAnamCapabilityReadiness>;
