import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findVoiceMeeterB1Input,
    resolveAnamAudioBridge,
    selectVoiceMeeterB1DeviceId,
    VOICEMEETER_AUDIO_BRIDGE,
} from '../lib/anam/audio-bridge.ts';

test('the bridge is enabled only for Amy Cara 4 voice sessions', () => {
    const enabled = resolveAnamAudioBridge({
        agentSlug: 'amy',
        isAmyCara4Canary: true,
        isQaMode: false,
        requestedAudioBridge: VOICEMEETER_AUDIO_BRIDGE,
    });

    assert.equal(enabled, VOICEMEETER_AUDIO_BRIDGE);

    const disabledCases = [
        { agentSlug: 'amy', isAmyCara4Canary: false, isQaMode: false, requestedAudioBridge: VOICEMEETER_AUDIO_BRIDGE },
        { agentSlug: 'taylor', isAmyCara4Canary: true, isQaMode: false, requestedAudioBridge: VOICEMEETER_AUDIO_BRIDGE },
        { agentSlug: 'amy', isAmyCara4Canary: true, isQaMode: true, requestedAudioBridge: VOICEMEETER_AUDIO_BRIDGE },
        { agentSlug: 'amy', isAmyCara4Canary: true, isQaMode: false, requestedAudioBridge: 'unknown' },
        { agentSlug: 'amy', isAmyCara4Canary: true, isQaMode: false, requestedAudioBridge: undefined },
    ];

    for (const input of disabledCases) {
        assert.equal(resolveAnamAudioBridge(input), undefined);
    }
});

test('the B1 matcher rejects physical microphones and other VoiceMeeter buses', () => {
    const devices = [
        { deviceId: 'physical', kind: 'audioinput', label: 'Microphone (Realtek USB2.0 MIC)' },
        { deviceId: 'b2', kind: 'audioinput', label: 'VoiceMeeter Aux Output (VB-Audio VoiceMeeter AUX VAIO)' },
        { deviceId: 'b3', kind: 'audioinput', label: 'VoiceMeeter Out B3 (VB-Audio VoiceMeeter VAIO)' },
        { deviceId: 'b1', kind: 'audioinput', label: 'VoiceMeeter Out B1 (VB-Audio VoiceMeeter VAIO)' },
    ];

    assert.equal(findVoiceMeeterB1Input(devices)?.deviceId, 'b1');
    assert.equal(findVoiceMeeterB1Input(devices.filter((device) => device.deviceId !== 'b1')), undefined);
});

test('hidden labels trigger a stopped permission probe and re-enumeration', async () => {
    let enumerationCount = 0;
    let permissionCount = 0;
    let stoppedTracks = 0;
    const mediaDevices = {
        async enumerateDevices() {
            enumerationCount += 1;
            return enumerationCount === 1
                ? [{ deviceId: 'default', kind: 'audioinput', label: '' }]
                : [{ deviceId: 'b1-after-permission', kind: 'audioinput', label: 'VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)' }];
        },
        async getUserMedia() {
            permissionCount += 1;
            return {
                getTracks: () => [{ stop: () => { stoppedTracks += 1; } }],
            };
        },
    };

    assert.equal(await selectVoiceMeeterB1DeviceId(mediaDevices), 'b1-after-permission');
    assert.equal(enumerationCount, 2);
    assert.equal(permissionCount, 1);
    assert.equal(stoppedTracks, 1);
});

test('the selector fails clearly instead of falling back to a physical microphone', async () => {
    const mediaDevices = {
        async enumerateDevices() {
            return [{ deviceId: 'physical', kind: 'audioinput', label: 'Microphone (Realtek USB2.0 MIC)' }];
        },
        async getUserMedia() {
            throw new Error('should not be called when labels are visible');
        },
    };

    await assert.rejects(
        selectVoiceMeeterB1DeviceId(mediaDevices),
        /VoiceMeeter Out B1 was not found/,
    );
});

test('a denied permission probe produces an actionable bridge error', async () => {
    const mediaDevices = {
        async enumerateDevices() {
            return [{ deviceId: 'default', kind: 'audioinput', label: '' }];
        },
        async getUserMedia() {
            throw new Error('denied');
        },
    };

    await assert.rejects(
        selectVoiceMeeterB1DeviceId(mediaDevices),
        /Microphone access is required/,
    );
});
