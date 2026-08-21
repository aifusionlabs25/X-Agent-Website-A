export const VOICEMEETER_AUDIO_BRIDGE = 'voicemeeter' as const;

export type AnamAudioBridge = typeof VOICEMEETER_AUDIO_BRIDGE;

type ResolveAnamAudioBridgeOptions = {
    agentSlug: string;
    isAmyCara4Canary: boolean;
    isQaMode: boolean;
    requestedAudioBridge?: string;
    runtimeEnvironment?: string;
};

type AudioInputDevice = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;
type AudioBridgeMediaDevices = Pick<MediaDevices, 'enumerateDevices' | 'getUserMedia'>;

export function resolveAnamAudioBridge({
    agentSlug,
    isAmyCara4Canary,
    isQaMode,
    requestedAudioBridge,
    runtimeEnvironment = process.env.NODE_ENV,
}: ResolveAnamAudioBridgeOptions): AnamAudioBridge | undefined {
    // VoiceMeeter is a machine-local QA bridge. Never honor its query parameter
    // in a preview or production build, including from a stale shared URL.
    if (runtimeEnvironment !== 'development') return undefined;

    const isAmyCara4VoiceSession = agentSlug === 'amy' && isAmyCara4Canary && !isQaMode;

    return isAmyCara4VoiceSession && requestedAudioBridge === VOICEMEETER_AUDIO_BRIDGE
        ? VOICEMEETER_AUDIO_BRIDGE
        : undefined;
}

export function findVoiceMeeterB1Input(devices: AudioInputDevice[]): AudioInputDevice | undefined {
    return devices.find((device) => {
        if (device.kind !== 'audioinput') return false;

        const label = device.label.toLowerCase();
        const isVoiceMeeterB1 = label.includes('voicemeeter output')
            || label.includes('voicemeeter out b1');
        const isAnotherBus = label.includes('aux')
            || label.includes('vaio3')
            || label.includes('b2')
            || label.includes('b3');

        return isVoiceMeeterB1 && !isAnotherBus;
    });
}

export async function selectVoiceMeeterB1DeviceId(
    mediaDevices: AudioBridgeMediaDevices = navigator.mediaDevices,
): Promise<string> {
    let devices = await mediaDevices.enumerateDevices();
    let bridgeInput = findVoiceMeeterB1Input(devices);

    const labelsAreHidden = devices.some(
        (device) => device.kind === 'audioinput' && !device.label.trim(),
    );

    if (!bridgeInput && labelsAreHidden) {
        let permissionStream: MediaStream | undefined;

        try {
            permissionStream = await mediaDevices.getUserMedia({ audio: true });
        } catch {
            throw new Error(
                'Microphone access is required so Chrome can select VoiceMeeter Out B1.',
            );
        } finally {
            permissionStream?.getTracks().forEach((track) => track.stop());
        }

        devices = await mediaDevices.enumerateDevices();
        bridgeInput = findVoiceMeeterB1Input(devices);
    }

    if (!bridgeInput) {
        throw new Error(
            'VoiceMeeter Out B1 was not found. Start VoiceMeeter Banana and confirm B1 is enabled.',
        );
    }

    return bridgeInput.deviceId;
}
