import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assessPublicAudioInputLabel,
    assessPublicAudioInputStream,
    buildPublicAudioLoopbackMessage,
} from '../lib/anam/public-audio-safety.ts';

test('blocks explicit virtual playback and loopback microphone labels', () => {
    const cases = [
        ['VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)', 'voicemeeter-loopback'],
        ['VoiceMeeter Out B1 (VB-Audio VoiceMeeter VAIO)', 'voicemeeter-loopback'],
        ['VoiceMeeter Out B2', 'voicemeeter-loopback'],
        ['VoiceMeeter Out B3', 'voicemeeter-loopback'],
        ['VoiceMeeter Aux Output (VB-Audio VoiceMeeter AUX VAIO)', 'voicemeeter-loopback'],
        ['CABLE Output (VB-Audio Virtual Cable)', 'virtual-cable-loopback'],
        ['Stereo Mix (Realtek(R) Audio)', 'system-playback-loopback'],
        ['What U Hear (Sound Blaster Audigy)', 'system-playback-loopback'],
        ['What You Hear', 'system-playback-loopback'],
    ];

    for (const [label, expectedKind] of cases) {
        const assessment = assessPublicAudioInputLabel(label);

        assert.equal(assessment.disposition, 'block', label);
        assert.equal(assessment.kind, expectedKind, label);
        assert.match(assessment.message, /choose a physical microphone/i, label);
        assert.match(assessment.message, /VoiceMeeter is not required/i, label);
    }
});

test('allows ordinary physical and browser-default microphone labels', () => {
    const labels = [
        'Microphone (Yeti Stereo Microphone)',
        'Default - Microphone (Realtek USB2.0 MIC)',
        'Communications - Headset Microphone (Jabra Evolve2)',
        'Microphone Array (Intel Smart Sound Technology)',
        'HD Pro Webcam C920 Microphone',
        'MacBook Pro Microphone',
    ];

    for (const label of labels) {
        assert.deepEqual(assessPublicAudioInputLabel(label), {
            disposition: 'allow',
            kind: 'ordinary-microphone',
            label,
            message: undefined,
        });
    }
});

test('does not mistake VoiceMeeter playback inputs for an explicit loopback output', () => {
    const assessment = assessPublicAudioInputLabel(
        'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)',
    );

    assert.equal(assessment.disposition, 'allow');
});

test('keeps hidden or missing device information non-blocking but unverified', () => {
    assert.deepEqual(assessPublicAudioInputLabel('  '), {
        disposition: 'unverified',
        kind: 'missing-label',
        label: '',
        message: undefined,
    });

    assert.deepEqual(assessPublicAudioInputStream(undefined), {
        disposition: 'unverified',
        kind: 'missing-audio-track',
        label: '',
        message: undefined,
    });
});

test('stream assessment blocks if any active input track is a loopback device', () => {
    const assessment = assessPublicAudioInputStream({
        getAudioTracks: () => [
            { label: 'Microphone (Yeti Stereo Microphone)' },
            { label: 'CABLE Output (VB-Audio Virtual Cable)' },
        ],
    });

    assert.equal(assessment.disposition, 'block');
    assert.equal(assessment.kind, 'virtual-cable-loopback');
});

test('the user message explains the failure and the exact recovery action', () => {
    const message = buildPublicAudioLoopbackMessage('Stereo Mix (Realtek Audio)');

    assert.match(message, /virtual playback device/);
    assert.match(message, /feed the agent's voice back into the call/);
    assert.match(message, /browser's microphone control near the address bar/);
    assert.match(message, /restart the session/);
});
