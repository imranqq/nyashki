import { useState } from 'react'
import { ChevronDown, Crown, Mic, MicOff, PhoneOff, RotateCw } from 'lucide-react'
import type { VoiceRoom } from '../hooks/useVoiceRoom'
import { getAvatarSource } from '../lib/avatar'

type VoiceMember = { id: string; username: string; avatar: string; isHost: boolean }

type VoicePanelProps = {
  members: VoiceMember[]
  clientId: string
  voice: VoiceRoom
}

const meterSegments = 5
const speakingLevel = 0.18

export function VoicePanel({ members, clientId, voice }: VoicePanelProps) {
  const [listenersOpen, setListenersOpen] = useState(false)
  const inVoice = new Set(voice.participants.map((participant) => participant.id))
  const joined = voice.status === 'joined'
  const connecting = voice.status === 'connecting'
  const self = members.find((member) => member.id === clientId)
  const selfName = self?.username || 'Ты'
  const others = members.filter((member) => member.id !== clientId && inVoice.has(member.id))
  const listeners = members.filter((member) => member.id !== clientId && !inVoice.has(member.id))
  const selfSpeaking = joined && !voice.muted && (voice.levels[clientId] ?? 0) > speakingLevel

  function isMuted(memberId: string): boolean {
    if (memberId === clientId) return voice.muted
    return voice.participants.find((participant) => participant.id === memberId)?.muted ?? false
  }

  function renderMeter(memberId: string) {
    const level = voice.levels[memberId] ?? 0
    const lit = Math.min(meterSegments, Math.ceil(level * meterSegments))
    return (
      <span className={`voice-meter ${lit > 0 ? 'is-live' : ''}`} aria-hidden="true">
        {Array.from({ length: meterSegments }, (_, segment) => <i key={segment} className={segment < lit ? 'is-lit' : ''} />)}
      </span>
    )
  }

  function renderNameplate(member: VoiceMember) {
    const muted = isMuted(member.id)
    const speaking = !muted && (voice.levels[member.id] ?? 0) > speakingLevel
    return (
      <span className="voice-strip-copy">
        <span className="voice-strip-name">{member.username}</span>
        <span className="voice-strip-state">{muted ? 'микрофон выключен' : speaking ? 'говорит' : 'микрофон открыт'}</span>
      </span>
    )
  }

  return (
    <section className="voice-room" aria-label="Голос комнаты">
      <div className="voice-status-line">
        <strong aria-live="polite">{inVoice.size} в голосе</strong>
        {voice.status === 'denied' ? <span className="voice-status-side">микрофон недоступен</span> : null}
      </div>

      <div className="voice-strips">
        <article className={`voice-strip is-self ${joined ? 'is-live' : 'is-idle'} ${joined && voice.muted ? 'is-muted' : ''} ${selfSpeaking ? 'is-speaking' : ''}`}>
          <span className="voice-strip-avatar">
            <img src={getAvatarSource(self?.avatar, 80)} alt="" />
            {self?.isHost && <Crown size={10} className="voice-strip-crown" />}
          </span>
          <span className="voice-strip-copy">
            <span className="voice-strip-name">{selfName}</span>
            <span className="voice-strip-state">{joined ? (voice.muted ? 'микрофон выключен' : 'микрофон открыт') : connecting ? 'подключаюсь' : 'не в голосе'}</span>
          </span>
          {joined ? renderMeter(clientId) : null}
          {joined ? (
            <button
              className={`voice-key ${voice.muted ? 'is-off' : ''}`}
              type="button"
              onClick={voice.toggleMute}
              aria-pressed={voice.muted}
              aria-label={voice.muted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {voice.muted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
          ) : (
            <button className="voice-connect" type="button" onClick={voice.join} disabled={connecting}>
              <Mic size={13} />
              {connecting ? 'Подключаюсь' : 'Подключиться'}
            </button>
          )}
        </article>

        {voice.status === 'denied' ? (
          <div className="voice-notice" role="status">
            <MicOff size={13} />
            <span>{voice.error}</span>
            <button type="button" onClick={voice.join}><RotateCw size={12} />Повторить</button>
          </div>
        ) : null}

        {others.map((member) => {
          const muted = isMuted(member.id)
          const speaking = !muted && (voice.levels[member.id] ?? 0) > speakingLevel
          return (
            <article className={`voice-strip ${speaking ? 'is-speaking' : ''} ${muted ? 'is-muted' : ''}`} key={member.id}>
              <span className="voice-strip-avatar">
                <img src={getAvatarSource(member.avatar, 80)} alt="" />
                {member.isHost && <Crown size={10} className="voice-strip-crown" />}
              </span>
              {renderNameplate(member)}
              {renderMeter(member.id)}
              <span className="voice-strip-mic" aria-label={muted ? 'Микрофон выключен' : 'Микрофон открыт'}>{muted ? <MicOff size={13} /> : null}</span>
            </article>
          )
        })}
      </div>

      {joined && others.length === 0 ? <p className="voice-empty">Кроме тебя в голосе никого</p> : null}
      {!joined && others.length === 0 ? <p className="voice-empty">Голос пока никто не включил</p> : null}

      {listeners.length > 0 ? (
        <div className="voice-listeners">
          <button className="voice-listeners-toggle" type="button" aria-expanded={listenersOpen} onClick={() => setListenersOpen((value) => !value)}>
            <span>не в голосе</span>
            <span className="voice-listeners-count">{listeners.length}</span>
            <ChevronDown size={13} className={listenersOpen ? 'is-open' : ''} />
          </button>
          {listenersOpen ? (
            <ul className="voice-listeners-list">
              {listeners.map((member) => (
                <li key={member.id}>
                  <img src={getAvatarSource(member.avatar, 48)} alt="" />
                  <span>{member.username}</span>
                  {member.isHost && <Crown size={10} />}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {joined ? (
        <button className="voice-leave" type="button" onClick={voice.leave}>
          <PhoneOff size={13} />
          Отключиться от голоса
        </button>
      ) : null}
    </section>
  )
}
