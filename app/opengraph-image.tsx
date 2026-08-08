import { ImageResponse } from 'next/og';

export const alt = 'X Agents by AI Fusion Labs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    alignItems: 'center',
                    background: 'linear-gradient(135deg, #09090b 0%, #18181b 55%, #312e81 100%)',
                    color: 'white',
                    display: 'flex',
                    height: '100%',
                    justifyContent: 'center',
                    padding: '72px',
                    width: '100%',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '980px' }}>
                    <div
                        style={{
                            color: '#a5b4fc',
                            display: 'flex',
                            fontSize: 26,
                            fontWeight: 700,
                            letterSpacing: '0.2em',
                            marginBottom: 34,
                            textTransform: 'uppercase',
                        }}
                    >
                        AI Fusion Labs
                    </div>
                    <div style={{ display: 'flex', fontSize: 104, fontWeight: 900, letterSpacing: '-0.04em' }}>
                        X Agents
                    </div>
                    <div
                        style={{
                            color: '#d4d4d8',
                            display: 'flex',
                            fontSize: 38,
                            lineHeight: 1.35,
                            marginTop: 24,
                        }}
                    >
                        Interactive AI agent demos for sales, intake, service, and operations.
                    </div>
                </div>
            </div>
        ),
        size,
    );
}
