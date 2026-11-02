import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crown, PenLine, X } from 'lucide-react'
import { getAvatarSource } from '../lib/avatar'

export type MemberCardProfile = {
  id: string
  username: string
  avatar: string
  bio?: string
  banner?: string
  isHost: boolean
}

export type MemberCardAnchor = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

type MemberCardProps = {
  member: MemberCardProfile
  isSelf: boolean
  anchor: MemberCardAnchor
  onClose: () => void
  onEditSelf?: () => void
}

const gutter = 10
const cardWidth = 322
const fallbackCount = 5

// Members without a banner get one of five dark surfaces, picked by their id so it stays the same.
function fallbackIndex(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return hash % fallbackCount
}

export function MemberCard({ member, isSelf, anchor, onClose, onEditSelf }: MemberCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [isSheet, setIsSheet] = useState(() => window.innerWidth < 760)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const onResize = () => setIsSheet(window.innerWidth < 760)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    cardRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  // The card opens beside the avatar and flips to the other side when the chat column is on the right.
  useLayoutEffect(() => {
    if (isSheet) return
    const card = cardRef.current
    if (!card) return
    const height = card.offsetHeight
    const preferredLeft = anchor.left - cardWidth - 12
    const rightFallback = anchor.right + 12
    let left = preferredLeft >= gutter ? preferredLeft : rightFallback
    left = Math.min(Math.max(gutter, left), Math.max(gutter, window.innerWidth - cardWidth - gutter))
    const centredTop = anchor.top + anchor.height / 2 - height / 2
    const top = Math.min(Math.max(gutter, centredTop), Math.max(gutter, window.innerHeight - height - gutter))
    setPosition({ top, left })
  }, [anchor, isSheet, member.id])

  const card = (
    <div
      ref={cardRef}
      className={`member-card ${isSheet ? 'is-sheet' : ''}`}
      role="dialog"
      aria-modal={isSheet}
      aria-label={`Профиль ${member.username}`}
      tabIndex={-1}
      style={isSheet || !position ? undefined : { top: position.top, left: position.left, visibility: position ? 'visible' : 'hidden' }}
    >
      {member.banner ? (
        <img className="member-card-banner" src={member.banner} alt="" />
      ) : (
        <div className={`member-card-banner is-fallback-${fallbackIndex(member.id)}`} aria-hidden="true" />
      )}
      <button className="member-card-close" type="button" onClick={onClose} aria-label="Закрыть карточку профиля"><X size={15} /></button>
      <div className="member-card-body">
        <div className="member-card-identity">
          <img className="member-card-avatar" src={getAvatarSource(member.avatar, 160)} alt="" />
          <div className="member-card-copy">
            <strong className="member-card-name">{member.username}</strong>
            {member.isHost ? <span className="member-card-host"><Crown size={9} />ведущий</span> : null}
          </div>
        </div>
        {member.bio ? <p className="member-card-bio">{member.bio}</p> : null}
        {isSelf && onEditSelf ? (
          <button className="member-card-edit" type="button" onClick={onEditSelf}><PenLine size={13} />Редактировать профиль</button>
        ) : null}
      </div>
    </div>
  )

  return createPortal(
    <div
      className={isSheet ? 'member-card-scrim' : 'member-card-layer'}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      {card}
    </div>,
    document.body,
  )
}
