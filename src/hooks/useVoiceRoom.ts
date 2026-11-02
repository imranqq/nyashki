import { useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'

export type VoiceParticipant = { id: string; muted: boolean }
export type VoiceStatus = 'idle' | 'connecting' | 'joined' | 'denied'

export type VoiceRoom = {
  status: VoiceStatus
  muted: boolean
  error: string
  participants: VoiceParticipant[]
  levels: Record<string, number>
  join: () => void
  leave: () => void
  toggleMute: () => void
}

type UseVoiceRoomOptions = {
  socket: Socket | null
  clientId: string
}

type VoicePeer = {
  connection: RTCPeerConnection
  audio: HTMLAudioElement
  analyser: AnalyserNode | null
  source: MediaStreamAudioSourceNode | null
  buffer: Float32Array<ArrayBuffer>
  pendingCandidates: RTCIceCandidateInit[]
}

const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const meterTickMs = 120
const analyserFftSize = 512

function readLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (let index = 0; index < buffer.length; index += 1) sum += buffer[index] * buffer[index]
  return Math.min(1, Math.sqrt(sum / buffer.length) * 5)
}

function describeMicrophoneError(error: unknown): string {
  if (!navigator.mediaDevices?.getUserMedia) return 'Микрофон работает только по https или на localhost.'
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Браузер запретил доступ к микрофону. Разрешите его в настройках сайта.'
    if (error.name === 'NotFoundError') return 'Микрофон не найден. Подключите его и повторите.'
    if (error.name === 'NotReadableError') return 'Микрофон занят другим приложением.'
  }
  return 'Не удалось включить микрофон. Повторите попытку.'
}

// One RTCPeerConnection per other person in voice; audio flows browser to browser,
// the socket server only relays offers, answers and ICE candidates.
export function useVoiceRoom({ socket, clientId }: UseVoiceRoomOptions): VoiceRoom {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const [participants, setParticipants] = useState<VoiceParticipant[]>([])
  const [levels, setLevels] = useState<Record<string, number>>({})

  const statusRef = useRef<VoiceStatus>('idle')
  const mutedRef = useRef(false)
  const localStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const selfAnalyserRef = useRef<AnalyserNode | null>(null)
  const selfBufferRef = useRef(new Float32Array(analyserFftSize))
  const peersRef = useRef(new Map<string, VoicePeer>())
  const levelsRef = useRef<Record<string, number>>({})

  function setStatusValue(next: VoiceStatus) {
    statusRef.current = next
    setStatus(next)
  }

  function getAudioContext(): AudioContext | null {
    if (!audioContextRef.current) {
      const AudioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextConstructor) return null
      audioContextRef.current = new AudioContextConstructor()
    }
    if (audioContextRef.current.state === 'suspended') void audioContextRef.current.resume()
    return audioContextRef.current
  }

  function attachAnalyser(stream: MediaStream): { analyser: AnalyserNode; source: MediaStreamAudioSourceNode } | null {
    const context = getAudioContext()
    if (!context) return null
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = analyserFftSize
    analyser.smoothingTimeConstant = 0.65
    source.connect(analyser)
    return { analyser, source }
  }

  function closePeer(peerId: string) {
    const peer = peersRef.current.get(peerId)
    if (!peer) return
    peer.connection.close()
    peer.source?.disconnect()
    peer.audio.remove()
    peersRef.current.delete(peerId)
  }

  function closeAllPeers() {
    for (const peerId of [...peersRef.current.keys()]) closePeer(peerId)
  }

  function createPeer(peerId: string): VoicePeer | null {
    const existing = peersRef.current.get(peerId)
    if (existing) return existing
    const stream = localStreamRef.current
    if (!stream) return null

    const connection = new RTCPeerConnection({ iceServers })
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.setAttribute('playsinline', 'true')
    audio.style.display = 'none'
    document.body.append(audio)

    const peer: VoicePeer = { connection, audio, analyser: null, source: null, buffer: new Float32Array(analyserFftSize), pendingCandidates: [] }
    peersRef.current.set(peerId, peer)

    for (const track of stream.getAudioTracks()) connection.addTrack(track, stream)
    connection.onicecandidate = (event) => {
      if (event.candidate) socket?.emit('voice:signal', { to: peerId, kind: 'ice', payload: event.candidate.toJSON() })
    }
    connection.ontrack = (event) => {
      const [remoteStream] = event.streams
      if (!remoteStream) return
      audio.srcObject = remoteStream
      void audio.play().catch(() => undefined)
      const attached = attachAnalyser(remoteStream)
      if (!attached) return
      peer.source?.disconnect()
      peer.source = attached.source
      peer.analyser = attached.analyser
      peer.buffer = new Float32Array(attached.analyser.fftSize)
    }

    return peer
  }

  async function offerTo(peerId: string) {
    const peer = createPeer(peerId)
    if (!peer) return
    try {
      const offer = await peer.connection.createOffer()
      await peer.connection.setLocalDescription(offer)
      if (peer.connection.localDescription) socket?.emit('voice:signal', { to: peerId, kind: 'offer', payload: peer.connection.localDescription })
    } catch {
      closePeer(peerId)
    }
  }

  function stopLocalStream() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    selfAnalyserRef.current = null
  }

  async function join() {
    if (statusRef.current === 'connecting' || statusRef.current === 'joined') return
    if (!socket?.connected) {
      setError('Нет соединения с комнатой. Проверьте сеть и повторите.')
      setStatusValue('denied')
      return
    }
    setError('')
    setStatusValue('connecting')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Микрофон работает только по https или на localhost.')
      setStatusValue('denied')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      localStreamRef.current = stream
      for (const track of stream.getAudioTracks()) track.enabled = !mutedRef.current
      const attached = attachAnalyser(stream)
      if (attached) {
        selfAnalyserRef.current = attached.analyser
        selfBufferRef.current = new Float32Array(attached.analyser.fftSize)
      }
      setStatusValue('joined')
      socket.emit('voice:join', { muted: mutedRef.current })
    } catch (microphoneError) {
      setError(describeMicrophoneError(microphoneError))
      setStatusValue('denied')
    }
  }

  function leave() {
    socket?.emit('voice:leave')
    stopLocalStream()
    closeAllPeers()
    setParticipants([])
    levelsRef.current = {}
    setLevels({})
    setStatusValue('idle')
  }

  function toggleMute() {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    const stream = localStreamRef.current
    if (stream) for (const track of stream.getAudioTracks()) track.enabled = !next
    socket?.emit('voice:mute', { muted: next })
  }

  useEffect(() => {
    if (!socket) return

    const handleMembers = (list: VoiceParticipant[]) => {
      setParticipants(list)
      if (statusRef.current !== 'joined') return
      const present = new Set(list.map((participant) => participant.id).filter((id) => id !== clientId))
      for (const peerId of [...peersRef.current.keys()]) {
        if (!present.has(peerId)) closePeer(peerId)
      }
      for (const peerId of present) {
        if (peersRef.current.has(peerId)) continue
        if (clientId < peerId) void offerTo(peerId)
        else createPeer(peerId)
      }
    }

    const handleSignal = async (message: { from?: string; kind?: string; payload?: unknown }) => {
      const from = message.from
      if (!from || from === clientId || statusRef.current !== 'joined') return
      if (message.kind === 'offer') {
        // A fresh offer means the other side rebuilt its connection, so ours is stale.
        if (peersRef.current.has(from)) closePeer(from)
        const peer = createPeer(from)
        if (!peer) return
        try {
          await peer.connection.setRemoteDescription(message.payload as RTCSessionDescriptionInit)
          for (const candidate of peer.pendingCandidates.splice(0)) await peer.connection.addIceCandidate(candidate).catch(() => undefined)
          const answer = await peer.connection.createAnswer()
          await peer.connection.setLocalDescription(answer)
          if (peer.connection.localDescription) socket.emit('voice:signal', { to: from, kind: 'answer', payload: peer.connection.localDescription })
        } catch {
          closePeer(from)
        }
        return
      }
      const peer = peersRef.current.get(from)
      if (!peer) return
      if (message.kind === 'answer') {
        try {
          await peer.connection.setRemoteDescription(message.payload as RTCSessionDescriptionInit)
          for (const candidate of peer.pendingCandidates.splice(0)) await peer.connection.addIceCandidate(candidate).catch(() => undefined)
        } catch {
          // A duplicate answer can arrive after a renegotiation; the live connection is kept.
        }
      } else if (message.kind === 'ice' && message.payload) {
        if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(message.payload as RTCIceCandidateInit).catch(() => undefined)
        else peer.pendingCandidates.push(message.payload as RTCIceCandidateInit)
      }
    }

    const rejoinAfterReconnect = () => {
      if (statusRef.current === 'joined') socket.emit('voice:join', { muted: mutedRef.current })
    }

    const dropDeadConnections = () => {
      closeAllPeers()
      levelsRef.current = {}
      setLevels({})
    }

    socket.on('voice:members', handleMembers)
    socket.on('voice:signal', handleSignal)
    socket.on('connect', rejoinAfterReconnect)
    socket.on('disconnect', dropDeadConnections)
    if (socket.connected && statusRef.current === 'joined') rejoinAfterReconnect()

    const meter = window.setInterval(() => {
      if (statusRef.current !== 'joined') return
      const selfAnalyser = selfAnalyserRef.current
      const selfLevel = selfAnalyser && !mutedRef.current ? readLevel(selfAnalyser, selfBufferRef.current) : 0
      const next: Record<string, number> = { [clientId]: Math.round(selfLevel * 20) / 20 }
      for (const [peerId, peer] of peersRef.current) {
        const level = peer.analyser ? readLevel(peer.analyser, peer.buffer) : 0
        next[peerId] = Math.round(level * 20) / 20
      }
      const changed = Object.keys(next).length !== Object.keys(levelsRef.current).length
        || Object.entries(next).some(([id, level]) => levelsRef.current[id] !== level)
      if (!changed) return
      levelsRef.current = next
      setLevels(next)
    }, meterTickMs)

    return () => {
      socket.off('voice:members', handleMembers)
      socket.off('voice:signal', handleSignal)
      socket.off('connect', rejoinAfterReconnect)
      socket.off('disconnect', dropDeadConnections)
      window.clearInterval(meter)
      closeAllPeers()
    }
    // Peer helpers only read refs, so the effect can stay tied to the socket instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, socket])

  useEffect(() => () => {
    stopLocalStream()
    void audioContextRef.current?.close()
    audioContextRef.current = null
  }, [])

  return { status, muted, error, participants, levels, join, leave, toggleMute }
}
