interface InsightMotionMarkProps {
  className?: string;
}

export default function InsightMotionMark({ className }: InsightMotionMarkProps) {
  return (
    <svg
      data-insight-motion
      className={className}
      viewBox="0 0 400 400"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(50 50)">
        <circle cx="30" cy="80" r="25" fill="#C70068" />
        <rect x="75" y="0" width="40" height="150" rx="5" fill="#E8005A" />
        <circle cx="250" cy="20" r="30" fill="#A7008E" />
        <rect x="150" y="60" width="180" height="40" rx="5" fill="#D2007B" />
        <rect x="15" y="180" width="180" height="40" rx="5" fill="#E8113E" />
        <circle cx="100" cy="260" r="25" fill="#D1004B" />
        <rect x="220" y="125" width="40" height="150" rx="5" fill="#A8188E" />
        <circle cx="295" cy="200" r="25" fill="#ED1B4A" />
      </g>
    </svg>
  );
}
