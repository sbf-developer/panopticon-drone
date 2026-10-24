import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

interface PanelProps {
  title: string;
  eyebrow?: string;
  icon?: ComponentType<LucideProps>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'accent' | 'danger';
}

export const Panel = ({
  title,
  eyebrow,
  icon: Icon,
  action,
  children,
  className = '',
  tone = 'default',
}: PanelProps) => (
  <section className={`panel panel--${tone} ${className}`}>
    <header className="panel__header">
      <div className="panel__title-wrap">
        {Icon ? (
          <span className="panel__icon">
            <Icon size={13} strokeWidth={1.7} />
          </span>
        ) : null}
        <div>
          {eyebrow ? <div className="panel__eyebrow">{eyebrow}</div> : null}
          <h2 className="panel__title">{title}</h2>
        </div>
      </div>
      {action ? <div className="panel__action">{action}</div> : null}
    </header>
    <div className="panel__body">{children}</div>
  </section>
);

export const StatusDot = ({ tone = 'good', pulse = false }: { tone?: 'good' | 'warn' | 'bad' | 'neutral'; pulse?: boolean }) => (
  <span className={`status-dot status-dot--${tone} ${pulse ? 'status-dot--pulse' : ''}`} />
);

export const DataRow = ({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: string }) => (
  <div className="data-row">
    <span className="data-row__label">{label}</span>
    <span className={`data-row__value ${tone ? `is-${tone}` : ''}`}>
      {value}
      {unit ? <em>{unit}</em> : null}
    </span>
  </div>
);

export const Bar = ({ value, tone = 'cyan', label }: { value: number; tone?: string; label?: string }) => (
  <div className="meter" aria-label={label}>
    <div className={`meter__fill meter__fill--${tone}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
  </div>
);
