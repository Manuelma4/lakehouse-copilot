import type { CSSProperties } from 'react'
import { ExternalLink } from 'lucide-react'
import { sourceLink } from '../openFootball'

export function Monogram({ name, large = false }: { name: string; large?: boolean }) {
  const letters = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
  const hue =
    Array.from(name).reduce((total, character) => total + (character.codePointAt(0) || 0), 0) % 360
  return (
    <span
      className={`team-badge ${large ? 'team-badge-large' : ''}`}
      style={{ '--badge-hue': `${hue}` } as CSSProperties}
      aria-hidden="true"
    >
      {letters}
    </span>
  )
}
export function SourceAnchor({
  href,
  children,
}: {
  href: string | null | undefined
  children: string
}) {
  const allowed = sourceLink(href)
  return allowed ? (
    <a href={allowed} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={12} />
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  ) : (
    <span>{children}</span>
  )
}
