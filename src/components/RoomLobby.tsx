import { useState } from 'react'
import { ArrowRight, Clapperboard, History, LogIn, Plus, Trash2 } from 'lucide-react'
import { getAvatarSource } from '../lib/avatar'
import type { Profile } from '../lib/profile'
import { resolveRoomCode } from '../lib/room'
import { createRoomId, forgetRoom, formatVisitedAt, openRoom, readRecentRooms, type RecentRoom } from '../lib/rooms'

type RoomLobbyProps = {
  profile: Profile
  displayName: string
  theme: string
  onOpenProfile: () => void
}

export function RoomLobby({ profile, displayName, theme, onOpenProfile }: RoomLobbyProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [recents, setRecents] = useState<RecentRoom[]>(readRecentRooms)

  function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const roomId = resolveRoomCode(code)
    if (!roomId) {
      setError('Введите код комнаты.')
      return
    }
    openRoom(roomId)
  }

  function createRoom() {
    openRoom(createRoomId(recents))
  }

  return (
    <main className="app-shell lobby-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#lobby" aria-label="nyashki">
          <span className="brand-mark"><Clapperboard size={18} /></span>
          <span>nyashki<span className="brand-dot">.</span></span>
        </a>
        <div className="topbar-spacer" />
        <button className="lobby-profile" type="button" onClick={onOpenProfile} aria-label={`Открыть профиль ${displayName}`}>
          <img src={getAvatarSource(profile.avatar, 72)} alt="" />
          <span>{displayName}</span>
        </button>
      </header>

      <div className="lobby-body">
        <section className="lobby-join" aria-labelledby="lobby-join-title">
          <h1 className="lobby-title" id="lobby-join-title">Войти в комнату<span className="heading-period">.</span></h1>
          <p className="lobby-identity">
            <img src={getAvatarSource(profile.avatar, 80)} alt="" />
            <span>{displayName}</span>
            <button type="button" onClick={onOpenProfile}>Изменить профиль</button>
          </p>

          <form className="lobby-form" onSubmit={joinRoom}>
            <label className="lobby-field">
              <span className="lobby-field-label">Код комнаты</span>
              <input
                className="lobby-input"
                value={code}
                onChange={(event) => { setCode(event.target.value); setError('') }}
                placeholder="vecher-61e4 или ссылка"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'lobby-error' : undefined}
              />
            </label>
            {error ? <p className="lobby-error" id="lobby-error" role="alert">{error}</p> : null}
            <button className="lobby-submit" type="submit"><LogIn size={15} />Войти в комнату</button>
          </form>

          <button className="lobby-create" type="button" onClick={createRoom}>
            <Plus size={15} />
            Создать комнату
          </button>
        </section>

        <section className="lobby-recents" aria-labelledby="lobby-recents-title">
          <div className="lobby-recents-head">
            <h2 id="lobby-recents-title">Недавние комнаты</h2>
            {recents.length > 0 ? <span className="lobby-recents-count">{recents.length}</span> : null}
          </div>
          {recents.length > 0 ? (
            <ul className="lobby-register">
              {recents.map((room) => (
                <li className="recent-room" key={room.roomId}>
                  <button className="recent-room-main" type="button" onClick={() => openRoom(room.roomId)} aria-label={`Открыть комнату ${room.roomId}`}>
                    <span className="recent-room-symbol" aria-hidden="true"><Clapperboard size={14} /></span>
                    <span className="recent-room-copy">
                      <span className="recent-room-code">{room.roomId}</span>
                      <span className="recent-room-date">{formatVisitedAt(room.visitedAt)}</span>
                    </span>
                    <ArrowRight size={15} className="recent-room-open" />
                  </button>
                  <button className="recent-room-remove" type="button" onClick={() => setRecents(forgetRoom(room.roomId))} aria-label={`Убрать ${room.roomId} из недавних`}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="lobby-empty">
              <History size={18} />
              <span>Недавних комнат нет</span>
            </div>
          )}
        </section>
      </div>

      <footer className="app-footer">
        <span>nyashki<span className="brand-dot">.</span> <span className="footer-separator">/</span> вы рядом, даже если далеко</span>
        <span>комната приватная <span className="privacy-dot" /></span>
      </footer>
    </main>
  )
}
