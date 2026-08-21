export type PublicAudioLoopbackKind =
    | 'voicemeeter-loopback'
    | 'virtual-cable-loopback'
    | 'system-playback-loopback';

export type PublicAudioInputAssessment =
    | {
        disposition: 'allow';
        kind: 'ordinary-microphone';
        label: string;
        message: undefined;
    }
    | {
        disposition: 'block';
        kind: PublicAudioLoopbackKind;
        label: string;
        message: string;
    }
    | {
        disposition: 'unverified';
        kind: 'missing-label' | 'missing-audio-track';
        label: string;
        message: undefined;
    };

type PublicAudioTrack = Pick<MediaStreamTrack, 'label'>;

type PublicAudioStream = {
    getAudioTracks: () => PublicAudioTrack[];
};

const LOOPBACK_LABELS: ReadonlyArray<{
    kind: PublicAudioLoopbackKind;
    pattern: RegExp;
}> = [
    {
        kind: 'voicemeeter-loopback',
        pattern: /\bvoicemeeter\b.*\b(?:output|out\s+b[123])\b/i,
    },
    {
        kind: 'virtual-cable-loopback',
        pattern: /\bcable\s+output\b/i,
    },
    {
        kind: 'system-playback-loopback',
        pattern: /\bstereo\s+mix\b|\bwhat\s+(?:u|you)\s+hear\b/i,
    },
];

function normalizeDeviceLabel(label: string | null | undefined): string {
    return (label ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function buildPublicAudioLoopbackMessage(label: string): string {
    return `Your browser is using the virtual playback device “${label}” as your microphone. `
        + 'That can feed the agent\'s voice back into the call. Open the browser\'s microphone control '
        + 'near the address bar, choose a physical microphone (such as a headset, webcam, or Yeti), '
        + 'then restart the session. VoiceMeeter is not required for a public X-Agent session.';
}

export function assessPublicAudioInputLabel(
    label: string | null | undefined,
): PublicAudioInputAssessment {
    const normalizedLabel = normalizeDeviceLabel(label);

    if (!normalizedLabel) {
        return {
            disposition: 'unverified',
            kind: 'missing-label',
            label: '',
            message: undefined,
        };
    }

    const loopbackMatch = LOOPBACK_LABELS.find(({ pattern }) => pattern.test(normalizedLabel));

    if (loopbackMatch) {
        return {
            disposition: 'block',
            kind: loopbackMatch.kind,
            label: normalizedLabel,
            message: buildPublicAudioLoopbackMessage(normalizedLabel),
        };
    }

    return {
        disposition: 'allow',
        kind: 'ordinary-microphone',
        label: normalizedLabel,
        message: undefined,
    };
}

export function assessPublicAudioInputStream(
    stream: PublicAudioStream | null | undefined,
): PublicAudioInputAssessment {
    const tracks = stream?.getAudioTracks() ?? [];

    if (tracks.length === 0) {
        return {
            disposition: 'unverified',
            kind: 'missing-audio-track',
            label: '',
            message: undefined,
        };
    }

    const assessments = tracks.map((track) => assessPublicAudioInputLabel(track.label));

    return assessments.find((assessment) => assessment.disposition === 'block')
        ?? assessments.find((assessment) => assessment.disposition === 'allow')
        ?? assessments[0];
}
