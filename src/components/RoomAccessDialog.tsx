import { useEffect, useState } from 'react'
import { Check, Copy, History, X } from 'lucide-react'
import { isLocalHost, resolveRoomCode } from '../lib/room'
import { leaveRoom, openRoom } from '../lib/rooms'

type RoomAccessDialogProps = {
  roomId: string
  onClose: () => void
}

export function RoomAccessDialog({ roomId, onClose }: RoomAccessDialogProps) {
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const shareUrl = window.location.href
  const localOnly = isLocalHost()

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  function joinByCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextRoom = resolveRoomCode(code)
    if (!nextRoom) {
      setError('Введите код комнаты.')
      return
    }
    if (nextRoom === roomId) {
      onClose()
      return
    }
    openRoom(nextRoom)
  }

  return (
    <div className="room-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="room-modal" role="dialog" aria-modal="true" aria-labelledby="room-modal-title">
        <header className="room-modal-header">
          <div>
            <h2 id="room-modal-title">Комната</h2>
            <span className="room-modal-code">{roomId}</span>
          </div>
          <button className="room-modal-close" type="button" onClick={onClose} aria-label="Закрыть"><X size={17} /></button>
        </header>

        <label className="room-modal-field">
          <span>Ссылка для друзей</span>
          <div className="room-modal-copy">
            <input value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Ссылка на комнату" />
            <button type="button" onClick={copyLink}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </label>

        {localOnly ? <p className="room-modal-warning">Адрес localhost открывается только на этом компьютере. Открой сайт по адресу туннеля и скопируй ссылку оттуда.</p> : null}

        <div className="room-modal-divider" />

        <form className="room-modal-join" onSubmit={joinByCode}>
          <label>
            <span>Войти по коду</span>
            <div className="room-modal-join-row">
              <input value={code} onChange={(event) => { setCode(event.target.value); setError('') }} placeholder="код из ссылки" aria-label="Код комнаты" />
              <button type="submit">Войти</button>
            </div>
          </label>
          {error ? <span className="room-modal-error" role="alert">{error}</span> : null}
        </form>

        <button className="room-modal-lobby" type="button" onClick={leaveRoom}>
          <History size={13} />
          Все комнаты
        </button>
      </section>
    </div>
  )
}
