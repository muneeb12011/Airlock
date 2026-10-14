import { useId } from "react";

// The sign-in chamber. The door's status light and motion follow the real
// sign-in state:
//   idle      — sealed, amber light breathing
//   verifying — a scan passes down the door while the server checks
//   mfa       — first door cleared, waiting for the second check
//   error     — the door jolts and the light goes red
//   granted   — light turns green and the doors slide open
export const READOUT = {
  idle: "Sealed. Sign in to enter.",
  verifying: "Checking credentials…",
  mfa: "Password OK. Second check.",
  error: "Access denied.",
  granted: "Access granted.",
};

export default function AirlockDoor({ phase = "idle", compact = false }) {
  const uid = useId().replace(/:/g, "");
  const id = (n) => `${n}-${uid}`;
  const rivets = Array.from({ length: 12 }, (_, i) => 176 + i * 22);

  return (
    <div className={`chamber phase-${phase} ${compact ? "compact" : ""}`}>
      <svg className="chamber-svg" viewBox="0 0 360 470" role="img" aria-label={READOUT[phase]}>
        <defs>
          <clipPath id={id("opening")}>
            <path d="M75 440V205a105 105 0 0 1 210 0v235z" />
          </clipPath>
          <radialGradient id={id("glow")} cx="50%" cy="62%" r="60%">
            <stop offset="0" stopColor="#c9fff0" />
            <stop offset="0.35" stopColor="#6ee7c4" stopOpacity="0.85" />
            <stop offset="1" stopColor="#0b4d41" stopOpacity="0.2" />
          </radialGradient>
          <linearGradient id={id("leafL")} x1="0" x2="1">
            <stop offset="0" stopColor="#1a242d" />
            <stop offset="1" stopColor="#24313c" />
          </linearGradient>
          <linearGradient id={id("leafR")} x1="1" x2="0">
            <stop offset="0" stopColor="#1a242d" />
            <stop offset="1" stopColor="#24313c" />
          </linearGradient>
          <linearGradient id={id("beam")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6ee7c4" stopOpacity="0" />
            <stop offset="0.5" stopColor="#6ee7c4" stopOpacity="0.55" />
            <stop offset="1" stopColor="#6ee7c4" stopOpacity="0" />
          </linearGradient>
          <pattern id={id("hazard")} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="16" fill="#e3b341" />
            <rect x="8" width="8" height="16" fill="#151d24" />
          </pattern>
          <filter id={id("blur")} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        {/* bulkhead rings, drawn in on first load */}
        <g className="rings" fill="none" strokeLinecap="butt">
          <path pathLength="1" className="ring r3" d="M9 452V205a171 171 0 0 1 342 0v247" stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
          <path pathLength="1" className="ring r2" d="M33 452V205a147 147 0 0 1 294 0v247" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
          <path pathLength="1" className="ring r1" d="M54 452V205a126 126 0 0 1 252 0v247" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        </g>

        {/* what's behind the door */}
        <g clipPath={`url(#${id("opening")})`}>
          <rect className="beyond" x="60" y="90" width="240" height="360" fill={`url(#${id("glow")})`} />
          <g className="leaves">
            <g className="leaf left">
              <rect x="60" y="90" width="119" height="360" fill={`url(#${id("leafL")})`} />
              <path d="M75 300h104M75 372h104" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
              <rect x="152" y="292" width="10" height="44" rx="5" fill="rgba(255,255,255,0.16)" />
              {rivets.map((y) => <circle key={y} cx="170" cy={y} r="1.8" fill="rgba(255,255,255,0.18)" />)}
            </g>
            <g className="leaf right">
              <rect x="181" y="90" width="119" height="360" fill={`url(#${id("leafR")})`} />
              <path d="M181 300h104M181 372h104" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
              <rect x="198" y="292" width="10" height="44" rx="5" fill="rgba(255,255,255,0.16)" />
              {rivets.map((y) => <circle key={y} cx="190" cy={y} r="1.8" fill="rgba(255,255,255,0.18)" />)}
            </g>
          </g>
          <rect className="beam" x="60" y="70" width="240" height="56" fill={`url(#${id("beam")})`} />
        </g>

        {/* frame */}
        <path pathLength="1" className="frame" d="M75 448V205a105 105 0 0 1 210 0v243" fill="none" stroke="#e9eef2" strokeWidth="11" strokeLinecap="butt" />

        {/* threshold */}
        <rect x="40" y="446" width="280" height="12" rx="3" fill={`url(#${id("hazard")})`} opacity="0.85" />

        {/* status light */}
        <circle className="lamp-glow" cx="180" cy="62" r="20" filter={`url(#${id("blur")})`} />
        <circle className="lamp" cx="180" cy="62" r="9" />
      </svg>
      <div className="readout" role="status" aria-live="polite">
        <span className="readout-lamp" aria-hidden />
        <span>{READOUT[phase]}</span>
      </div>
    </div>
  );
}
