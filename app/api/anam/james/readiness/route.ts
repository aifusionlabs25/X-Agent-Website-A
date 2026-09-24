import { NextResponse } from 'next/server';
import jamesRuntimeReleaseManifest from '@/config/anam/james/v2/runtime-release-manifest.json';
import { inspectJamesReleasePolicy } from '@/lib/anam/james-release-policy';

export async function GET() {
    const policy = inspectJamesReleasePolicy(jamesRuntimeReleaseManifest);
    const response = NextResponse.json({
        agent: 'james',
        ready: policy.ready,
        deploymentStatus: jamesRuntimeReleaseManifest.deploymentStatus,
        privacyMode: policy.privacyMode,
        failures: policy.failures,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
