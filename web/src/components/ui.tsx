import type { CSSProperties, ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import type { Prediction } from '../types'

export const pct = (value: number, decimals = 0) => `${(value * 100).toFixed(decimals)}%`
export const date = (value: string, long = false) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(long
      ? { year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }
      : { hour: '2-digit', minute: '2-digit' }),
    timeZone: 'UTC',
  }).format(new Date(value))
export const dayLabel = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
export const time = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(value),
  )
export function Badge({ name, large = false }: { name: string; large?: boolean }) {
  const hash = Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0)
  return (
    <span
      className={`team-badge ${large ? 'team-badge-large' : ''}`}
      style={{ '--badge-hue': `${hash % 360}` } as CSSProperties}
      aria-hidden="true"
    >
      {name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')}
    </span>
  )
}
export function SectionTitle({
  eyebrow,
  title,
  aside,
}: {
  eyebrow?: string
  title: string
  aside?: ReactNode
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {aside}
    </div>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <CircleHelp size={28} />
      <p>{children}</p>
    </div>
  )
}
export function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  )
}
export function ProbabilityBar({
  prediction,
  compact = false,
}: {
  prediction: Prediction
  compact?: boolean
}) {
  const { a, b, draw } = prediction.probabilities
  return (
    <div className={`probability ${compact ? 'probability-compact' : ''}`}>
      <div className="probability-labels">
        <span>
          <b>{pct(a, 1)}</b>
          <small>{compact ? 'Team A' : prediction.team_a}</small>
        </span>
        {draw !== undefined && (
          <span className="draw-label">
            <b>{pct(draw, 1)}</b>
            <small>Draw</small>
          </span>
        )}
        <span>
          <b>{pct(b, 1)}</b>
          <small>{compact ? 'Team B' : prediction.team_b}</small>
        </span>
      </div>
      <div
        className="probability-track"
        role="img"
        aria-label={`${prediction.team_a} ${pct(a, 1)}${draw !== undefined ? `, draw ${pct(draw, 1)}` : ''}, ${prediction.team_b} ${pct(b, 1)}`}
      >
        <span className="prob-a" style={{ width: pct(a, 5) }} />
        {draw !== undefined && <span className="prob-draw" style={{ width: pct(draw, 5) }} />}
        <span className="prob-b" style={{ width: pct(b, 5) }} />
      </div>
    </div>
  )
}
