import type { SimulationSnapshot } from '../../core/sim/snapshot';
import { formatCompass } from '../format';

const toDeg = (radians: number): number => (radians * 180) / Math.PI;

export const AttitudeIndicator = ({ snapshot }: { snapshot: SimulationSnapshot }) => {
  const roll = toDeg(snapshot.drone.roll);
  const pitch = toDeg(snapshot.drone.pitch);
  const heading = snapshot.drone.heading;
  return (
    <div className="attitude">
      <svg viewBox="0 0 180 126" className="attitude__svg" role="img" aria-label="Attitude indicator">
        <defs>
          <clipPath id="attitude-clip">
            <circle cx="90" cy="62" r="49" />
          </clipPath>
          <linearGradient id="sky-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#17364a" />
            <stop offset="100%" stopColor="#2e6378" />
          </linearGradient>
          <linearGradient id="ground-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5e4a35" />
            <stop offset="100%" stopColor="#2b231b" />
          </linearGradient>
        </defs>
        <circle cx="90" cy="62" r="49" stroke="rgba(162,194,200,0.22)" fill="rgba(4,9,12,0.65)" />
        <g clipPath="url(#attitude-clip)">
          <g transform={`rotate(${-roll} 90 62) translate(0 ${Math.max(-28, Math.min(28, pitch * 1.55))})`}>
            <rect x="30" y="-30" width="120" height="92" fill="url(#sky-gradient)" />
            <rect x="30" y="62" width="120" height="92" fill="url(#ground-gradient)" />
            <line x1="30" y1="62" x2="150" y2="62" stroke="rgba(232,243,242,0.88)" strokeWidth="1.2" />
            <line x1="30" y1="62" x2="150" y2="62" stroke="rgba(111,227,242,0.3)" strokeWidth="3.2" />
            {[-20, -10, 10, 20].map((offset) => (
              <g key={offset}>
                <line x1="84" y1={62 + offset * 1.55} x2="96" y2={62 + offset * 1.55} stroke="rgba(218,235,236,0.5)" />
              </g>
            ))}
          </g>
        </g>
        <g stroke="rgba(214,236,238,0.72)" strokeWidth="1.4">
          <line x1="74" y1="62" x2="84" y2="62" />
          <line x1="96" y1="62" x2="106" y2="62" />
          <line x1="82" y1="62" x2="88" y2="66" />
          <line x1="98" y1="62" x2="92" y2="66" />
          <circle cx="90" cy="62" r="2.2" fill="rgba(111,227,242,0.95)" stroke="none" />
        </g>
        <g fill="rgba(160,186,191,0.75)" fontSize="7" fontFamily="JetBrains Mono, monospace">
          <text x="90" y="12" textAnchor="middle" fill="rgba(111,227,242,0.9)">{formatCompass(heading)}</text>
          <text x="18" y="115">BANK {Math.abs(roll).toFixed(0)}°</text>
          <text x="118" y="115" textAnchor="end">PITCH {pitch >= 0 ? '+' : ''}{pitch.toFixed(0)}°</text>
        </g>
      </svg>
      <div className="attitude__tape">
        {[-40, -20, 0, 20, 40].map((delta) => {
          const value = (heading + delta + 360) % 360;
          return (
            <span key={delta} className={delta === 0 ? 'is-center' : ''}>
              {String(Math.round(value / 10) * 10).padStart(3, '0')}
            </span>
          );
        })}
      </div>
    </div>
  );
};
