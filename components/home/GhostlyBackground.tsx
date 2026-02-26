// components/home/GhostlyBackground.tsx
// Nova's SVG displacement filter for the liquid-metal "X AGENT" ghost

export default function GhostlyBackground() {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0 flex items-center justify-center">
            <svg
                className="w-full h-full opacity-[0.04] mix-blend-overlay"
                viewBox="0 0 1000 400"
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    <filter id="liquidGhost" x="-20%" y="-20%" width="140%" height="140%">
                        <feTurbulence
                            type="fractalNoise"
                            baseFrequency="0.01"
                            numOctaves="3"
                            result="noise"
                        />
                        <feDisplacementMap
                            in="SourceGraphic"
                            in2="noise"
                            scale="20"
                            xChannelSelector="R"
                            yChannelSelector="G"
                        />
                    </filter>
                </defs>
                <text
                    x="50%"
                    y="50%"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="180"
                    fontWeight="900"
                    fontFamily="system-ui, sans-serif"
                    letterSpacing="-0.04em"
                    filter="url(#liquidGhost)"
                >
                    X AGENT
                </text>
            </svg>
        </div>
    );
}
