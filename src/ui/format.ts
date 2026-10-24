export const formatMissionTime = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `T+${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
};

export const formatClock = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export const formatNumber = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

export const formatCompass = (degrees: number): string => {
  if (!Number.isFinite(degrees)) return '---';
  const normalized = ((degrees % 360) + 360) % 360;
  return `${String(Math.round(normalized)).padStart(3, '0')}°`;
};

export const formatSigned = (value: number, digits = 1, unit = ''): string => {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0.05 ? '+' : '';
  return `${sign}${value.toFixed(digits)}${unit}`;
};

export const phaseIndex = (phase: string): number => {
  switch (phase) {
    case 'TAKEOFF':
      return 0;
    case 'ACQUIRE':
      return 1;
    case 'TRACK':
    case 'LOST':
      return 2;
    case 'RTH':
      return 3;
    case 'LAND':
    case 'COMPLETE':
      return 4;
    default:
      return -1;
  }
};

export const statusTone = (status: string): 'good' | 'warn' | 'bad' | 'neutral' => {
  if (status === 'TRACKING' || status === 'COMPLETE') return 'good';
  if (status === 'COASTING' || status === 'ACQUIRING' || status === 'LOST') return 'warn';
  if (status === 'FAILED' || status === 'EMERGENCY') return 'bad';
  return 'neutral';
};
