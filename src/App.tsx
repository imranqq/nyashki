import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Clapperboard, Crown, ImagePlus, Link2, ListVideo, Lock, Maximize2, MessageCircle, Mic, Minimize2, MoreHorizontal, Pause, Play, Plus, RotateCcw, RotateCw, Send, Smile, ThumbsUp, Volume2 } from 'lucide-react'
import { io, type Socket } from 'socket.io-client'
import { MemberCard, type MemberCardAnchor, type MemberCardProfile } from './components/MemberCard'
import { ProfileDialog } from './components/ProfileDialog'
import { RoomAccessDialog } from './components/RoomAccessDialog'
import { RoomLobby } from './components/RoomLobby'
import { VoicePanel } from './components/VoicePanel'
import { useVoiceRoom } from './hooks/useVoiceRoom'
import { getAvatarSource } from './lib/avatar'
import { autoNamePattern, persistProfile, readPreferredName, readProfile, rememberPreferredName, resolveDisplayName, type Profile } from './lib/profile'
import { readRoomFromUrl, rememberRoom } from './lib/rooms'
import './App.css'
import './styles/lobby.css'
import './styles/overlays.css'

type ChatMessage = { id?: string; userId?: string; name: string; avatar?: string; text: string; time: string; mine?: boolean; system?: boolean; media?: string; sticker?: boolean }
type QueueVideo = { id: string; title: string; url: string; addedBy: string; votes: string[]; voterIds?: string[] }
type RoomMember = { id: string; username: string; avatar: string; isHost: boolean }
type RoomSnapshot = { messages: ChatMessage[]; queue: QueueVideo[]; members: RoomMember[]; playback: { url: string; title: string; playing: boolean; progress: number; currentTime: number; duration: number } }
type YouTubePlayer = {
  destroy: () => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  pauseVideo: () => void
  playVideo: () => void
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void
  setVolume: (volume: number) => void
}
type YouTubeApi = {
  PlayerState: { ENDED: number; PAUSED: number; PLAYING: number }
  Player: new (elementId: string, options: {
    videoId: string
    host: string
    playerVars: Record<string, string | number>
    events: {
      onReady: (event: { target: YouTubePlayer }) => void
      onStateChange: (event: { data: number; target: YouTubePlayer }) => void
    }
  }) => YouTubePlayer
}
type VkPlayerState = { state: string; time: number; duration: number; volume: number; muted?: boolean }
type VkPlayer = {
  play: () => void
  pause: () => void
  seek: (time: number) => void
  setVolume: (volume: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  getState: () => string
  on: (event: string, listener: (state: VkPlayerState) => void) => void
  destroy: () => void
}
type VkApi = { VideoPlayer: (iframe: HTMLIFrameElement) => VkPlayer }

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
    VK?: VkApi
  }
}

let youtubeApiPromise: Promise<YouTubeApi> | null = null
let vkApiPromise: Promise<VkApi> | null = null

const emojiGroups = {
  Смайлы: ['😀', '😂', '🥹', '😍', '😎', '🥰', '🤔', '😭', '😴', '🤯', '😅', '🤍'],
  Реакции: ['👏', '🔥', '💯', '✨', '🙌', '👀', '🫶', '🤝', '💀', '🎉', '🤌', '🫡'],
  Символы: ['❤️', '🧡', '💛', '💚', '🩵', '💙', '💜', '🖤', '🤍', '💔', '💫', '⭐'],
}

const stickerOptions = ['🥹', '😎', '😭', '🫶', '🔥', '✨', '🍿', '🐸', '🧸', '👀', '💅', '🫠']

function getYouTubeVideoId(rawUrl: string): string | null {
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null
    if (!host.endsWith('youtube.com')) return null
    return url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ?? url.searchParams.get('v')
  } catch {
    return null
  }
}

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (youtubeApiPromise) return youtubeApiPromise

  const pending = new Promise<YouTubeApi>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('YouTube API timed out')), 15000)
    const existingCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      existingCallback?.()
      window.clearTimeout(timeout)
      if (window.YT) resolve(window.YT)
      else reject(new Error('YouTube API did not initialize'))
    }
    if (!document.querySelector('script[data-youtube-iframe-api]')) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.dataset.youtubeIframeApi = 'true'
      script.onerror = () => {
        window.clearTimeout(timeout)
        reject(new Error('YouTube API failed to load'))
      }
      document.head.append(script)
    }
  })
  youtubeApiPromise = pending.catch((error: unknown) => {
    youtubeApiPromise = null
    throw error
  })

  return youtubeApiPromise!
}

function loadVkApi(): Promise<VkApi> {
  if (window.VK?.VideoPlayer) return Promise.resolve(window.VK)
  if (vkApiPromise) return vkApiPromise
  const pending = new Promise<VkApi>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('VK player API timed out')), 15000)
    const script = document.createElement('script')
    script.src = 'https://vk.com/js/api/videoplayer.js'
    script.async = true
    script.dataset.vkPlayerApi = 'true'
    script.onload = () => {
      window.clearTimeout(timeout)
      if (window.VK?.VideoPlayer) resolve(window.VK)
      else reject(new Error('VK player API did not initialize'))
    }
    script.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('VK player API failed to load'))
    }
    document.head.append(script)
  })
  vkApiPromise = pending.catch((error: unknown) => {
    vkApiPromise = null
    throw error
  })
  return vkApiPromise!
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`
}

function getVideoEmbedUrl(rawUrl: string): string | null {
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.replace(/^www\./, '')

    if (host === 'youtu.be' || host.endsWith('youtube.com')) {
      const videoId = getYouTubeVideoId(rawUrl)
      return videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` : null
    }

    if (host.endsWith('rutube.ru')) {
      const videoId = url.pathname.match(/\/(?:video|play\/embed)\/([a-zA-Z0-9-]+)/)?.[1]
      return videoId ? `https://rutube.ru/play/embed/${encodeURIComponent(videoId)}/` : null
    }

    if (host === 'vk.com' || host.endsWith('.vk.com') || host === 'vkvideo.ru') {
      if (url.pathname.endsWith('/video_ext.php')) {
        url.searchParams.set('js_api', '1')
        return url.href
      }
      const match = url.pathname.match(/\/video(-?\d+)_(\d+)/)
      if (match) return `https://vk.com/video_ext.php?oid=${match[1]}&id=${match[2]}&js_api=1`
    }
  } catch {
    return null
  }
  return null
}

function isVkVideoUrl(rawUrl: string): boolean {
  if (!rawUrl) return false
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.replace(/^www\./, '')
    if (host !== 'vk.com' && !host.endsWith('.vk.com') && host !== 'vkvideo.ru') return false
    return url.pathname.endsWith('/video_ext.php') || /\/video(-?\d+)_(\d+)/.test(url.pathname)
  } catch {
    return false
  }
}

function isDirectVideoUrl(rawUrl: string): boolean {
  try { return /\.(mp4|webm|ogv|ogg)$/i.test(new URL(rawUrl).pathname) } catch { return false }
}

function getQueueVideoPreview(rawUrl: string): { provider: string; thumbnail: string | null; direct: boolean } {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.replace(/^www\./, '')
    const embedUrl = getVideoEmbedUrl(rawUrl)
    const youtubeId = embedUrl?.match(/youtube-nocookie\.com\/embed\/([^/?]+)/)?.[1]
    if (youtubeId) return { provider: 'YouTube', thumbnail: `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`, direct: false }
    const rutubeId = url.pathname.match(/\/(?:video|play\/embed)\/([a-zA-Z0-9-]+)/)?.[1]
    if (host.endsWith('rutube.ru') && rutubeId) return { provider: 'Rutube', thumbnail: `https://rutube.ru/api/video/${rutubeId}/thumbnail/?redirect=1`, direct: false }
    if (host === 'vk.com' || host.endsWith('.vk.com') || host === 'vkvideo.ru') return { provider: 'VK Видео', thumbnail: null, direct: false }
    if (isDirectVideoUrl(rawUrl)) return { provider: 'Видеофайл', thumbnail: null, direct: true }
    return { provider: host, thumbnail: null, direct: false }
  } catch {
    return { provider: 'Видео', thumbnail: null, direct: false }
  }
}

function getQueueVideoTitle(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.replace(/^www\./, '')
    const embedUrl = getVideoEmbedUrl(rawUrl)
    const youtubeId = embedUrl?.match(/youtube-nocookie\.com\/embed\/([^/?]+)/)?.[1]
    if (youtubeId) return `YouTube · ${youtubeId.slice(0, 8)}`
    const rutubeId = url.pathname.match(/\/(?:video|play\/embed)\/([a-zA-Z0-9-]+)/)?.[1]
    if (host.endsWith('rutube.ru') && rutubeId) return `Rutube · ${rutubeId.slice(0, 8)}`
    const vkMatch = url.pathname.match(/\/video(-?\d+)_(\d+)/)
    if (vkMatch) return `VK Видео · ${vkMatch[1]}_${vkMatch[2]}`
    if (isDirectVideoUrl(rawUrl)) return decodeURIComponent(url.pathname.split('/').pop() || 'Видеофайл')
    return host
  } catch {
    return 'Видео по ссылке'
  }
}

function getClientId(): string {
  try {
    const stored = localStorage.getItem('nyashki-client-id')
    if (stored) return stored
    const clientId = generateBrowserId()
    localStorage.setItem('nyashki-client-id', clientId)
    return clientId
  } catch {
    return generateBrowserId()
  }
}

function generateBrowserId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

type WatchRoomProps = {
  roomId: string
  profile: Profile
  theme: string
  onOpenProfile: () => void
}

function WatchRoom({ roomId, profile, theme, onOpenProfile }: WatchRoomProps) {
  const youtubeContainerId = `nyashki-youtube-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [clientId] = useState(getClientId)
  const [roomConnected, setRoomConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [preferredName, setPreferredName] = useState(readPreferredName)
  const [memberProfiles, setMemberProfiles] = useState<Record<string, MemberCardProfile>>({})
  const [openCard, setOpenCard] = useState<{ memberId: string; anchor: MemberCardAnchor; fallback?: MemberCardProfile } | null>(null)
  const cardTriggerRef = useRef<HTMLElement | null>(null)
  const [roomError, setRoomError] = useState('')
  const [queueError, setQueueError] = useState('')
  const [members, setMembers] = useState<RoomMember[]>([])
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(68)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [roomAccessOpen, setRoomAccessOpen] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [videoTitle, setVideoTitle] = useState('')
  const [activeVideoUrl, setActiveVideoUrl] = useState('')
  const [videoError, setVideoError] = useState('')
  const [videoQueue, setVideoQueue] = useState<QueueVideo[]>([])
  const [queueOpen, setQueueOpen] = useState(false)
  const [queueMode, setQueueMode] = useState<'vote' | 'host'>('vote')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [chatTab, setChatTab] = useState<'chat' | 'voice'>('chat')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerCategory, setPickerCategory] = useState<'emoji' | 'gif' | 'sticker'>('emoji')
  const [emojiGroup, setEmojiGroup] = useState<keyof typeof emojiGroups>('Смайлы')
  const [gifUrl, setGifUrl] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const profileRef = useRef(profile)
  const messageListRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const queueDragStart = useRef<number | null>(null)
  const draggedQueueHandle = useRef(false)
  const progressRef = useRef(progress)
  const currentTimeRef = useRef(currentTime)
  const durationRef = useRef(duration)
  const playingRef = useRef(playing)
  const directVideoRef = useRef<HTMLVideoElement>(null)
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null)
  const youtubeReadyRef = useRef(false)
  const rutubeFrameRef = useRef<HTMLIFrameElement>(null)
  const rutubeReadyRef = useRef(false)
  const vkFrameRef = useRef<HTMLIFrameElement>(null)
  const vkPlayerRef = useRef<VkPlayer | null>(null)
  const vkReadyRef = useRef(false)
  const lastVkSyncRef = useRef(0)
  const seekSyncRef = useRef<{ lastSentAt: number; timer: number; pendingTime: number | null }>({ lastSentAt: 0, timer: 0, pendingTime: null })
  const isHostRef = useRef(false)
  const [vkFailedUrl, setVkFailedUrl] = useState('')

  const voice = useVoiceRoom({ socket, clientId })
  const isHost = members.some((member) => member.id === clientId && member.isHost)
  const hostName = members.find((member) => member.isHost)?.username ?? '…'
  const selfName = members.find((member) => member.id === clientId)?.username
  const myName = selfName || profile.username || preferredName || 'Пользователь'
  const friends = members.map((member, index) => ({
    ...member,
    name: member.username,
    color: ['lime', 'coral', 'blue', 'pink'][index % 4],
    status: member.isHost ? 'Ведущий' : 'Смотрит',
  }))

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  // The lobby lists room history, so entering a room records it on this device only.
  useEffect(() => {
    rememberRoom(roomId)
  }, [roomId])

  useEffect(() => {
    isHostRef.current = isHost
  }, [isHost])

  useEffect(() => {
    const socket = io({ path: '/socket.io', autoConnect: false })
    socketRef.current = socket
    socket.on('connect', () => {
      setRoomConnected(true)
      setSocket(socket)
      setRoomError('')
      socket.emit('room:join', { roomId, user: { id: clientId, username: profileRef.current.username, preferredName: profileRef.current.username ? '' : readPreferredName(), avatar: profileRef.current.avatar, bio: profileRef.current.bio, banner: profileRef.current.banner } })
    })
    socket.on('disconnect', () => setRoomConnected(false))
    socket.on('connect_error', () => {
      setRoomConnected(false)
      setRoomError('Не удалось подключиться к комнате. Переподключаемся…')
    })
    socket.on('room:error', (error: string) => {
      setRoomError(error)
      setQueueError(error)
    })
    socket.on('room:state', (snapshot: RoomSnapshot) => {
      setQueueError('')
      setRoomError('')
      setMessages(snapshot.messages.map((item) => ({ ...item, mine: item.userId === clientId })))
      setVideoQueue(snapshot.queue)
      setMembers(snapshot.members)
      if (!profileRef.current.username) {
        const self = snapshot.members.find((member) => member.id === clientId)
        if (self && autoNamePattern.test(self.username)) {
          rememberPreferredName(self.username)
          setPreferredName(self.username)
        }
      }
      setActiveVideoUrl(snapshot.playback.url)
      setVideoTitle(snapshot.playback.title)
      setPlaying(snapshot.playback.playing)
      setProgress(snapshot.playback.progress)
      progressRef.current = snapshot.playback.progress
      setCurrentTime(snapshot.playback.currentTime)
      currentTimeRef.current = snapshot.playback.currentTime
      setDuration(snapshot.playback.duration)
      durationRef.current = snapshot.playback.duration
      playingRef.current = snapshot.playback.playing
    })
    // Banners and bios arrive separately so the frequent state updates stay small.
    socket.on('room:profiles', (profiles: MemberCardProfile[]) => {
      setMemberProfiles(Object.fromEntries(profiles.map((member) => [member.id, member])))
    })
    socket.connect()
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [clientId, roomId])

  useEffect(() => {
    if (!roomConnected) return
    socketRef.current?.emit('user:update', { username: profile.username, avatar: profile.avatar, bio: profile.bio, banner: profile.banner })
  }, [profile.username, profile.avatar, profile.bio, profile.banner, roomConnected])


  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  // The chat scrolls inside its own panel, so it follows new messages only while the reader is at the bottom.
  useEffect(() => {
    if (chatTab !== 'chat' || !stickToBottomRef.current) return
    const list = messageListRef.current
    if (!list) return
    const scrollToLatest = () => {
      list.scrollTop = list.scrollHeight
    }
    let cancelled = false
    const scrollIfStuck = () => {
      if (!cancelled && stickToBottomRef.current) scrollToLatest()
    }
    scrollToLatest()
    // Layout settles after fonts arrive, so the newest bubble is never half hidden.
    const frame = window.requestAnimationFrame(scrollIfStuck)
    const timer = window.setTimeout(scrollIfStuck, 150)
    void document.fonts?.ready.then(scrollIfStuck)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [chatTab, messages])

  function handleMessageListScroll() {
    const list = messageListRef.current
    if (!list) return
    stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90
  }

  useEffect(() => {
    if (activeVideoUrl || !playing || !isHost) return
    const timer = window.setInterval(() => {
      const next = currentTimeRef.current + 1
      currentTimeRef.current = next >= durationRef.current ? 0 : next
      const nextProgress = durationRef.current > 0 ? currentTimeRef.current / durationRef.current * 100 : 0
      progressRef.current = nextProgress
      setProgress(nextProgress)
      setCurrentTime(currentTimeRef.current)
      socketRef.current?.emit('player:update', { playing: true, currentTime: currentTimeRef.current, duration: durationRef.current })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeVideoUrl, isHost, playing])

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.fullscreenElement) void document.exitFullscreen?.()
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    window.addEventListener('keydown', exitOnEscape)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      window.removeEventListener('keydown', exitOnEscape)
    }
  }, [])

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = message.trim()
    if (!text) return
    socketRef.current?.emit('chat:send', { text })
    setMessage('')
  }

  function sendSticker(sticker: string) {
    socketRef.current?.emit('chat:send', { text: sticker, sticker: true })
    setPickerOpen(false)
  }

  function sendGif(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const url = new URL(gifUrl)
      if (!['http:', 'https:'].includes(url.protocol)) return
      socketRef.current?.emit('chat:send', { text: 'GIF', media: url.href })
      setGifUrl('')
      setPickerOpen(false)
    } catch {
      // Keep the picker open until a valid GIF URL is entered.
    }
  }

  function sendCustomMedia(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    if (file.size > 2_000_000) {
      setRoomError('Файл слишком большой для чата. Максимальный размер — 2 МБ.')
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      socketRef.current?.emit('chat:send', { text: file.name, media: reader.result })
      setPickerOpen(false)
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function startSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const rawUrl = sourceUrl.trim()
    if (!rawUrl) return
    try {
      const parsedUrl = new URL(rawUrl)
      if (parsedUrl.protocol === 'magnet:') {
        setSourceError('Торрент-ссылку нельзя воспроизвести прямо в браузере. Нужна ссылка на видеофайл или встроенный плеер платформы.')
        return
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported protocol')
      const title = getQueueVideoTitle(parsedUrl.href)
      if (isHost) {
        socketRef.current?.emit('player:start', { url: parsedUrl.href, title })
      } else {
        socketRef.current?.emit('queue:add', { title, url: parsedUrl.href })
        setQueueOpen(true)
      }
      setSourceUrl('')
      setSourceError('')
    } catch {
      setSourceError('Вставь корректную ссылку на видео или страницу платформы.')
    }
  }

  function addVideo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = videoUrl.trim()
    try {
      const parsedUrl = new URL(url)
      if (parsedUrl.protocol === 'magnet:') {
        setVideoError('Торрент-ссылку нельзя воспроизвести прямо в браузере. Нужна ссылка на видеофайл или встроенный плеер платформы.')
        return
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported protocol')
      const title = getQueueVideoTitle(parsedUrl.href)
      socketRef.current?.emit('queue:add', { title, url: parsedUrl.href })
      setVideoError('')
      setQueueError('')
      setVideoUrl('')
      setQueueOpen(true)
    } catch {
      setVideoError('Вставь корректную ссылку на видео или страницу поддерживаемой платформы.')
    }
  }

  function voteForVideo(videoId: string) {
    socketRef.current?.emit('queue:vote', videoId)
    setQueueError('')
  }

  function playQueuedVideo(video: QueueVideo) {
    if (!isHost) {
      setQueueError('Только ведущий комнаты может запустить видео.')
      return
    }
    socketRef.current?.emit('queue:play', video.id)
    setQueueError('')
  }

  function togglePlayback() {
    if (!isHost) return
    applySharedPlaying(!playing)
  }

  function applySeek(time: number) {
    if (directVideoRef.current && Number.isFinite(directVideoRef.current.duration)) directVideoRef.current.currentTime = time
    if (youtubeReadyRef.current) youtubePlayerRef.current?.seekTo(time, true)
    if (vkReadyRef.current) vkPlayerRef.current?.seek(time)
    sendRutubeCommand('player:setCurrentTime', { time })
  }

  function emitSeek(target: number) {
    const sync = seekSyncRef.current
    const send = (time: number) => {
      seekSyncRef.current.lastSentAt = Date.now()
      socketRef.current?.emit('player:update', { playing: playingRef.current, currentTime: time, duration: durationRef.current })
    }
    if (sync.pendingTime !== null) {
      sync.pendingTime = target
      return
    }
    if (Date.now() - sync.lastSentAt >= 400) {
      send(target)
      return
    }
    sync.pendingTime = target
    sync.timer = window.setTimeout(() => {
      const pending = seekSyncRef.current.pendingTime
      seekSyncRef.current.timer = 0
      seekSyncRef.current.pendingTime = null
      if (pending !== null) send(pending)
    }, 400)
  }

  function seekTo(nextTime: number) {
    if (!isHost) return
    const limit = durationRef.current > 0 ? durationRef.current : Math.max(nextTime, 0)
    const target = Math.max(0, Math.min(limit, nextTime))
    const nextProgress = durationRef.current > 0 ? target / durationRef.current * 100 : 0
    progressRef.current = nextProgress
    setProgress(nextProgress)
    currentTimeRef.current = target
    setCurrentTime(target)
    applySeek(target)
    emitSeek(target)
  }

  function seekBy(delta: number) {
    if (!isHost) return
    seekTo(currentTimeRef.current + delta)
  }

  function updateProgress(value: number) {
    if (!isHost) return
    seekTo(durationRef.current > 0 ? durationRef.current * value / 100 : currentTimeRef.current)
  }

  const publishMediaPosition = useCallback((time: number, mediaDuration: number) => {
    if (!Number.isFinite(time) || time < 0) return
    currentTimeRef.current = time
    setCurrentTime(time)
    if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
      durationRef.current = mediaDuration
      setDuration(mediaDuration)
      const nextProgress = Math.max(0, Math.min(100, time / mediaDuration * 100))
      progressRef.current = nextProgress
      setProgress(nextProgress)
    }
    if (isHostRef.current) socketRef.current?.emit('player:update', { playing: playingRef.current, currentTime: time, duration: durationRef.current })
  }, [])

  function handleDirectVideoLoaded(event: React.SyntheticEvent<HTMLVideoElement>) {
    const element = event.currentTarget
    element.volume = volume / 100
    durationRef.current = element.duration
    setDuration(element.duration)
    publishMediaPosition(element.currentTime, element.duration)
    if (playingRef.current) {
      void element.play().catch(() => {
        if (playingRef.current) applySharedPlaying(false)
      })
    }
  }

  function applySharedPlaying(nextPlaying: boolean) {
    playingRef.current = nextPlaying
    setPlaying(nextPlaying)
    if (directVideoRef.current) {
      if (nextPlaying) void directVideoRef.current.play().then(() => setRoomError('')).catch(() => setRoomError('Нажми play ещё раз, чтобы разрешить воспроизведение.'))
      else directVideoRef.current.pause()
    }
    if (youtubeReadyRef.current) {
      if (nextPlaying) youtubePlayerRef.current?.playVideo()
      else youtubePlayerRef.current?.pauseVideo()
    }
    if (vkReadyRef.current) {
      if (nextPlaying) vkPlayerRef.current?.play()
      else vkPlayerRef.current?.pause()
    }
    sendRutubeCommand(nextPlaying ? 'player:play' : 'player:pause')
    if (isHostRef.current) socketRef.current?.emit('player:update', { playing: nextPlaying, currentTime: currentTimeRef.current, duration: durationRef.current })
  }

  function sendRutubeCommand(type: string, data: Record<string, number> = {}) {
    rutubeFrameRef.current?.contentWindow?.postMessage(JSON.stringify({ type, data }), 'https://rutube.ru')
  }

  function handleQueuePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    queueDragStart.current = event.clientY
    draggedQueueHandle.current = false
  }

  function handleQueuePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (queueDragStart.current === null) return
    const delta = event.clientY - queueDragStart.current
    queueDragStart.current = null
    if (Math.abs(delta) < 35) return
    draggedQueueHandle.current = true
    setQueueOpen(delta < 0)
  }

  function toggleQueueFromHandle() {
    if (draggedQueueHandle.current) {
      draggedQueueHandle.current = false
      return
    }
    setQueueOpen((open) => !open)
  }

  function toggleFullscreen() {
    const player = document.querySelector('.player')
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void player?.requestFullscreen?.()
  }

  const videoEmbedUrl = getVideoEmbedUrl(activeVideoUrl)
  const directVideo = isDirectVideoUrl(activeVideoUrl)
  const youtubeVideoId = getYouTubeVideoId(activeVideoUrl)
  const isRutubeVideo = activeVideoUrl.includes('rutube.ru')
  const isVkVideo = isVkVideoUrl(activeVideoUrl)
  const vkFailed = isVkVideo && vkFailedUrl === activeVideoUrl
  const hasManagedPlayback = directVideo || Boolean(youtubeVideoId) || isRutubeVideo || (isVkVideo && !vkFailed)
  const hasUnmanagedEmbed = Boolean(videoEmbedUrl) && !hasManagedPlayback
  const sortedQueue = [...videoQueue].sort((first, second) => queueMode === 'vote' ? second.votes.length - first.votes.length : 0)

  useEffect(() => {
    rutubeReadyRef.current = false
    seekSyncRef.current.pendingTime = null
    if (seekSyncRef.current.timer) {
      window.clearTimeout(seekSyncRef.current.timer)
      seekSyncRef.current.timer = 0
    }
  }, [activeVideoUrl])

  useEffect(() => {
    youtubeReadyRef.current = false
    if (!youtubeVideoId) {
      youtubePlayerRef.current?.destroy()
      youtubePlayerRef.current = null
      return
    }
    let cancelled = false
    loadYouTubeApi().then((youtube) => {
      if (cancelled || !document.getElementById(youtubeContainerId)) return
      youtubePlayerRef.current = new youtube.Player(youtubeContainerId, {
        videoId: youtubeVideoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 0, controls: 0, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: ({ target }) => {
            youtubePlayerRef.current = target
            youtubeReadyRef.current = true
            if (currentTimeRef.current > 0) target.seekTo(currentTimeRef.current, true)
            if (playingRef.current) target.playVideo()
            else target.pauseVideo()
          },
          onStateChange: ({ data }) => {
            if (!isHostRef.current) return
            if (data === youtube.PlayerState.PLAYING && !playingRef.current) applySharedPlaying(true)
            if (data === youtube.PlayerState.PAUSED && playingRef.current) applySharedPlaying(false)
          },
        },
      })
    }).catch(() => setRoomError('Не удалось загрузить управление YouTube. Проверь подключение и попробуй обновить комнату.'))
    return () => {
      cancelled = true
      youtubeReadyRef.current = false
      youtubePlayerRef.current?.destroy()
      youtubePlayerRef.current = null
    }
  }, [youtubeContainerId, youtubeVideoId])

  useEffect(() => {
    if (!youtubeVideoId || !isHost) return
    const timer = window.setInterval(() => {
      const player = youtubePlayerRef.current
      if (!youtubeReadyRef.current || !player || typeof player.getDuration !== 'function' || typeof player.getCurrentTime !== 'function') return
      const actualDuration = player.getDuration()
      const actualTime = player.getCurrentTime()
      if (actualDuration > 0 && Number.isFinite(actualTime)) publishMediaPosition(actualTime, actualDuration)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isHost, publishMediaPosition, youtubeVideoId])

  useEffect(() => {
    if (!directVideo || !isHost) return
    const timer = window.setInterval(() => {
      const player = directVideoRef.current
      if (player && player.readyState >= 1 && player.duration > 0) publishMediaPosition(player.currentTime, player.duration)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [directVideo, isHost, publishMediaPosition])

  useEffect(() => {
    const onRutubeMessage = (event: MessageEvent) => {
      const frame = rutubeFrameRef.current
      if (!frame || event.source !== frame.contentWindow || !event.origin.endsWith('rutube.ru')) return
      let messageData: { type?: string; data?: { time?: number; duration?: number; state?: string } }
      try {
        messageData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (messageData.type === 'player:ready') {
        rutubeReadyRef.current = true
        sendRutubeCommand('player:setCurrentTime', { time: currentTimeRef.current })
        sendRutubeCommand(playingRef.current ? 'player:play' : 'player:pause')
      } else if (messageData.type === 'player:durationChange' && typeof messageData.data?.duration === 'number') {
        durationRef.current = messageData.data.duration
        setDuration(messageData.data.duration)
      } else if (messageData.type === 'player:currentTime' && typeof messageData.data?.time === 'number') {
        publishMediaPosition(messageData.data.time, durationRef.current)
      } else if (messageData.type === 'player:changeState') {
        if (!isHostRef.current) return
        if (messageData.data?.state === 'playing' && !playingRef.current) applySharedPlaying(true)
        if (messageData.data?.state === 'paused' && playingRef.current) applySharedPlaying(false)
      }
    }
    window.addEventListener('message', onRutubeMessage)
    return () => window.removeEventListener('message', onRutubeMessage)
  }, [isHost, publishMediaPosition])

  useEffect(() => {
    vkReadyRef.current = false
    lastVkSyncRef.current = 0
    if (!isVkVideo) {
      vkPlayerRef.current?.destroy()
      vkPlayerRef.current = null
      return
    }
    let cancelled = false
    let fallbackTimer = 0
    const startFromSharedState = (player: VkPlayer) => {
      vkReadyRef.current = true
      try {
        if (currentTimeRef.current > 0) player.seek(currentTimeRef.current)
        if (playingRef.current) player.play()
        else player.pause()
      } catch {
        // The VK player rejects commands until its iframe reports ready.
      }
    }
    loadVkApi().then((api) => {
      const frame = vkFrameRef.current
      if (cancelled || !frame) return
      let player: VkPlayer
      try {
        player = api.VideoPlayer(frame)
      } catch {
        setVkFailedUrl(activeVideoUrl)
        return
      }
      vkPlayerRef.current = player
      player.on('inited', () => startFromSharedState(player))
      player.on('timeupdate', (state) => {
        if (!isHostRef.current || typeof state?.time !== 'number') return
        const now = Date.now()
        if (now - lastVkSyncRef.current < 900) return
        lastVkSyncRef.current = now
        publishMediaPosition(state.time, state.duration)
      })
      player.on('started', () => {
        if (isHostRef.current && !playingRef.current) applySharedPlaying(true)
      })
      player.on('resumed', () => {
        if (isHostRef.current && !playingRef.current) applySharedPlaying(true)
      })
      player.on('paused', () => {
        if (isHostRef.current && playingRef.current) applySharedPlaying(false)
      })
      player.on('ended', () => {
        if (isHostRef.current) applySharedPlaying(false)
      })
      fallbackTimer = window.setTimeout(() => {
        if (!cancelled && !vkReadyRef.current) startFromSharedState(player)
      }, 1500)
    }).catch(() => {
      if (!cancelled) setVkFailedUrl(activeVideoUrl)
    })
    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimer)
      vkReadyRef.current = false
      vkPlayerRef.current?.destroy()
      vkPlayerRef.current = null
    }
  }, [activeVideoUrl, isVkVideo, publishMediaPosition])

  useEffect(() => {
    if (!activeVideoUrl) return
    const directVideoElement = directVideoRef.current
    if (directVideoElement && directVideoElement.readyState >= 1) {
      if (Math.abs(directVideoElement.currentTime - currentTime) > 1.25) directVideoElement.currentTime = currentTime
      if (playing && directVideoElement.paused) void directVideoElement.play().then(() => setRoomError('')).catch(() => setRoomError('Нажми play ещё раз, чтобы разрешить воспроизведение.'))
      if (!playing && !directVideoElement.paused) directVideoElement.pause()
    }
    const youtubePlayer = youtubePlayerRef.current
    if (youtubePlayer && youtubeReadyRef.current && typeof youtubePlayer.getCurrentTime === 'function' && typeof youtubePlayer.getPlayerState === 'function') {
      if (Math.abs(youtubePlayer.getCurrentTime() - currentTime) > 1.5) youtubePlayer.seekTo(currentTime, true)
      const actualState = youtubePlayer.getPlayerState()
      if (playing && actualState !== 1) youtubePlayer.playVideo()
      if (!playing && actualState === 1) youtubePlayer.pauseVideo()
    }
    if (vkReadyRef.current && vkPlayerRef.current) {
      const player = vkPlayerRef.current
      try {
        const drift = Math.abs(player.getCurrentTime() - currentTime)
        if (Number.isFinite(drift) && drift > 1.5) player.seek(currentTime)
        const state = player.getState()
        if (playing && state !== 'playing') player.play()
        if (!playing && state === 'playing') player.pause()
      } catch {
        // Ignore commands until the VK player is ready.
      }
    }
    if (rutubeReadyRef.current) {
      sendRutubeCommand('player:setCurrentTime', { time: currentTime })
      sendRutubeCommand(playing ? 'player:play' : 'player:pause')
    }
  }, [activeVideoUrl, currentTime, playing])

  function openMemberCard(memberId: string, element: HTMLElement, fallback?: MemberCardProfile) {
    const rect = element.getBoundingClientRect()
    cardTriggerRef.current = element
    setOpenCard({ memberId, fallback, anchor: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } })
  }

  function closeMemberCard() {
    setOpenCard(null)
    cardTriggerRef.current?.focus()
  }

  function editOwnProfile() {
    closeMemberCard()
    onOpenProfile()
  }

  // A guest who already left keeps a card from the message they left behind.
  const cardMember = openCard ? memberProfiles[openCard.memberId] ?? members.find((member) => member.id === openCard.memberId) ?? openCard.fallback : null

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#home" aria-label="nyashki, на главную"><span className="brand-mark"><Clapperboard size={18} strokeWidth={2.5} /></span><span>nyashki<span className="brand-dot">.</span></span></a>
        <div className="topbar-divider" />
        <button className="room-switcher" type="button" onClick={() => setRoomAccessOpen(true)} aria-haspopup="dialog"><span className={`live-dot ${roomConnected ? '' : 'is-offline'}`} />Комната <span className="room-switcher-code">{roomId}</span><span className="room-host-label">{isHost ? 'ТЫ ВЕДУЩИЙ' : `ВЕДУЩИЙ ${hostName}`}</span><ChevronDown size={15} /></button>
        <div className="topbar-spacer" />
        <div className="topbar-watchers" aria-label={`${members.length} участников смотрят`}>{members.slice(0, 4).map((member) => <img key={member.id} src={getAvatarSource(member.avatar, 64)} alt={member.username} />)}{members.length > 4 && <span>+{members.length - 4}</span>}</div>
        <button className="invite-button" type="button" onClick={() => setRoomAccessOpen(true)} aria-haspopup="dialog"><Link2 size={15} />Пригласить</button>
        <button className="profile-button" type="button" aria-label={`Открыть профиль ${myName}`} onClick={onOpenProfile}><img src={getAvatarSource(profile.avatar, 64)} alt="" /><span className="profile-presence" /></button>
      </header>
      {roomError && <div className="room-alert" role="status">{roomError}</div>}

      <div className="page-content">
        <section className="watch-column" aria-label="Комната просмотра">
          <div className="room-heading"><div><h1>Вечер без планов<span className="heading-period">.</span></h1><p className="room-subtitle">Тихий вечер, хорошее кино и вы все здесь.</p></div><button className="icon-button more-room" type="button" aria-label="Настройки комнаты"><MoreHorizontal size={21} /></button></div>

          <div className="filmstrip" aria-label="Участники комнаты"><div className="filmstrip-label"><span className={`online-count ${roomConnected ? '' : 'is-offline'}`} /><strong>{members.length}</strong> в комнате</div><div className="filmstrip-people">{friends.map((friend) => <div className="mini-person" key={friend.id}><button className="avatar-button avatar-button-small" type="button" onClick={(event) => openMemberCard(friend.id, event.currentTarget)} aria-label={`Открыть профиль ${friend.name}`}><span className={`mini-avatar ${friend.color}`}><img src={getAvatarSource(friend.avatar, 96)} alt="" /></span></button><span className="mini-name">{friend.name}</span>{friend.isHost && <><Crown size={11} className="host-crown" /><span className="member-host-label">ведущий</span></>}</div>)}</div><span className="watching-label">{activeVideoUrl ? <><span className="equalizer"><i /><i /><i /></span> смотрите вместе</> : 'ждём видео'}</span></div>

          <section className={`player ${activeVideoUrl ? 'has-source' : 'is-empty'}`} aria-label="Видеоплеер">
            {activeVideoUrl ? youtubeVideoId ? <div id={youtubeContainerId} className="player-frame youtube-player-container" /> : directVideo ? <video className="player-video" ref={directVideoRef} src={activeVideoUrl} controls={false} playsInline key={activeVideoUrl} onLoadedMetadata={handleDirectVideoLoaded} onTimeUpdate={(event) => publishMediaPosition(event.currentTarget.currentTime, event.currentTarget.duration)} onPlay={() => { if (!playingRef.current) applySharedPlaying(true) }} onPause={() => { if (playingRef.current) applySharedPlaying(false) }} onEnded={() => applySharedPlaying(false)}>Браузер не поддерживает воспроизведение видео.</video> : videoEmbedUrl ? <iframe className="player-frame" ref={isRutubeVideo ? rutubeFrameRef : isVkVideo ? vkFrameRef : undefined} src={videoEmbedUrl} title={videoTitle} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : <div className="unsupported-video"><Clapperboard size={27} /><h2>Эту страницу нельзя встроить</h2><p>Платформа запрещает показ внутри сайта. Попробуй открыть видео на YouTube, VK Видео или Rutube либо вставь прямую ссылку на MP4/WebM.</p><a href={activeVideoUrl} target="_blank" rel="noreferrer">Открыть источник в новой вкладке <Link2 size={13} /></a></div> : null}
            {activeVideoUrl && <div className="player-topline"><span className="playing-badge"><span className="equalizer"><i /><i /><i /></span>{videoTitle}</span><button type="button" className="player-icon" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Свернуть видео' : 'На весь экран'}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button></div>}
{activeVideoUrl && hasManagedPlayback && isHost && <button className="shared-play-toggle" type="button" onClick={togglePlayback} aria-label={playing ? 'Поставить на паузу у всех' : 'Продолжить просмотр у всех'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>}
            {activeVideoUrl && hasManagedPlayback && <div className="player-controls live-player-controls" aria-label="Управление воспроизведением"><div className="timeline-wrap"><input className="timeline" type="range" min="0" max="100" step="0.1" value={progress} onChange={(event) => updateProgress(Number(event.target.value))} aria-label="Позиция видео" disabled={!isHost} style={{ '--progress': `${progress}%` } as React.CSSProperties} /><div className="timeline-labels"><span>{formatTimecode(currentTime)}</span><span>{formatTimecode(duration)}</span></div></div><div className="control-actions"><button className="control-button skip-button" type="button" onClick={() => seekBy(-10)} disabled={!isHost} aria-label="Перемотать на 10 секунд назад" title={isHost ? 'Назад на 10 секунд' : 'Управляет ведущий'}><RotateCcw size={15} /><span>10</span></button><button className="control-button" type="button" onClick={togglePlayback} disabled={!isHost} aria-label={playing ? 'Пауза у всех' : 'Воспроизвести у всех'} title={isHost ? undefined : 'Управляет ведущий'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button className="control-button skip-button" type="button" onClick={() => seekBy(10)} disabled={!isHost} aria-label="Перемотать на 10 секунд вперёд" title={isHost ? 'Вперёд на 10 секунд' : 'Управляет ведущий'}><RotateCw size={15} /><span>10</span></button><div className="volume-control"><Volume2 size={17} /><input type="range" min="0" max="100" value={volume} onChange={(event) => { const nextVolume = Number(event.target.value); setVolume(nextVolume); if (directVideoRef.current) directVideoRef.current.volume = nextVolume / 100; if (youtubeReadyRef.current) youtubePlayerRef.current?.setVolume(nextVolume); if (vkReadyRef.current) vkPlayerRef.current?.setVolume(nextVolume / 100); sendRutubeCommand('player:setVolume', { volume: nextVolume / 100 }) }} aria-label="Громкость" /></div><span className="sync-label">{isHost ? <span className="sync-check"><Check size={10} /></span> : <Lock size={10} />} {formatTimecode(currentTime)} / {formatTimecode(duration)}</span></div></div>}

            {!activeVideoUrl && <div className="player-empty">
              <div className="player-empty-glow" />
              <div className="player-empty-texture" />
              <div className="player-empty-frame" />
              <div className="player-empty-edge" />
              <span className="stage-label stage-label-left"><Crown size={12} />ВЕДУЩИЙ {hostName}</span>
              <span className="stage-label stage-label-right">{roomConnected ? 'ПРИВАТНАЯ КОМНАТА' : 'ПЕРЕПОДКЛЮЧЕНИЕ'}</span>
              <form className="stage-form" onSubmit={startSource}>
                <div className="stage-field">
                  <Link2 size={16} />
                  <input value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setSourceError('') }} placeholder="Вставь ссылку на видео" aria-label="Ссылка на видео" required />
                  <button className="stage-submit" type="submit" disabled={!roomConnected}>{isHost ? 'Смотреть вместе' : 'В очередь'}</button>
                </div>
                {sourceError && <p className="stage-error" role="alert">{sourceError}</p>}
              </form>
            </div>}
          </section>

          {activeVideoUrl && hasUnmanagedEmbed && <p className="player-note" role="status"><Lock size={12} />{isVkVideo ? 'VK не отдал управление этому видео — перематывай и ставь паузу кнопками внутри плеера.' : 'Этот источник не поддерживает общее управление: перемотка и пауза для всех недоступны.'}</p>}

          <section className={`video-queue ${queueOpen ? 'is-open' : ''}`} aria-label="Очередь видео">
            <button className="queue-handle" type="button" onPointerDown={handleQueuePointerDown} onPointerUp={handleQueuePointerUp} onPointerCancel={() => { queueDragStart.current = null }} onClick={toggleQueueFromHandle} aria-expanded={queueOpen} aria-label={queueOpen ? 'Свернуть очередь видео' : 'Развернуть очередь видео'}>
              <span className="queue-grip" />
              <span className="queue-handle-content"><span className="queue-handle-title"><ListVideo size={16} />Очередь видео<span className="queue-count">{videoQueue.length}</span></span><span className="queue-handle-hint">{queueOpen ? 'потяни вниз, чтобы свернуть' : 'потяни вверх, чтобы открыть'}</span><span className="queue-handle-arrow">{queueOpen ? <ArrowDown size={15} /> : <ArrowUp size={15} />}</span></span>
            </button>
            {queueOpen && <div className="queue-body">
              <div className="queue-toolbar"><div><strong>Что смотрим дальше?</strong><span>Предложи видео или выбери фаворита комнаты</span></div><div className="queue-modes" role="group" aria-label="Режим выбора видео"><button className={queueMode === 'vote' ? 'is-active' : ''} type="button" onClick={() => setQueueMode('vote')}><ThumbsUp size={13} />Голосование</button><button className={queueMode === 'host' ? 'is-active' : ''} type="button" onClick={() => setQueueMode('host')}><Crown size={13} />Выбор ведущего</button></div></div>
              <form className="queue-submit" onSubmit={addVideo}><input type="text" value={videoUrl} onChange={(event) => { setVideoUrl(event.target.value); setVideoError('') }} placeholder="Вставь ссылку на видео" aria-label="Ссылка на видео в очередь" required /><button className="queue-submit-button" type="submit"><Plus size={15} />Добавить</button>{videoError && <p className="video-form-error" role="alert">{videoError}</p>}{queueError && <p className="video-form-error" role="alert">{queueError}</p>}</form>
              {sortedQueue.length ? <div className="queue-list">{sortedQueue.map((video, index) => { const voted = video.voterIds?.includes(clientId) ?? false; const preview = getQueueVideoPreview(video.url); return <article className={`queue-item ${index === 0 && queueMode === 'vote' && video.votes.length > 0 ? 'is-leading' : ''}`} key={video.id}><span className="queue-rank">{queueMode === 'vote' ? `#${index + 1}` : <Clapperboard size={14} />}</span><div className={`queue-preview queue-preview-${preview.provider === 'VK Видео' ? 'vk' : preview.provider === 'Rutube' ? 'rutube' : preview.provider === 'YouTube' ? 'youtube' : 'generic'}`}>{preview.direct ? <video src={video.url} muted playsInline preload="metadata" onLoadedMetadata={(event) => { const element = event.currentTarget; if (element.duration > 0) element.currentTime = Math.min(1, element.duration / 20) }} aria-label={`Превью ${video.title}`} /> : preview.thumbnail ? <><div className="queue-preview-fallback"><Clapperboard size={15} /><span>{preview.provider}</span></div><img src={preview.thumbnail} alt={`Кадр из ${video.title}`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /></> : <div className="queue-preview-fallback"><Clapperboard size={15} /><span>{preview.provider}</span></div>}<span className="queue-preview-play"><Play size={11} fill="currentColor" /></span></div><div className="queue-video-copy"><strong>{video.title}</strong><span>добавил {video.addedBy} <i /> {new URL(video.url).hostname.replace(/^www\./, '')}</span></div>{queueMode === 'vote' && <button className={`queue-vote ${voted ? 'is-voted' : ''}`} type="button" onClick={() => voteForVideo(video.id)} aria-pressed={voted} aria-label={voted ? `Убрать голос, сейчас ${video.votes.length}` : `Проголосовать, сейчас ${video.votes.length}`}><ThumbsUp size={14} /><span>{video.votes.length}</span></button>}{isHost && <button className="queue-play" type="button" onClick={() => playQueuedVideo(video)} aria-label={`Запустить ${video.title}`}><Play size={14} fill="currentColor" /><span>{queueMode === 'host' ? 'Выбрать' : 'Запустить'}</span></button>}</article> })}</div> : <div className="queue-empty"><Clapperboard size={20} /><span>Пока предложений нет</span><small>Добавь ссылку выше. В режиме голосования победит видео с большим числом голосов.</small></div>}
              <div className="queue-footnote"><span><Crown size={12} />{isHost ? 'Ты ведущий, можешь запустить любой ролик' : 'Запускать выбранное видео может ведущий'}</span>{isHost && queueMode === 'vote' && sortedQueue[0]?.votes.length ? <button type="button" onClick={() => playQueuedVideo(sortedQueue[0])}><Play size={12} fill="currentColor" />Запустить лидера</button> : null}</div>
            </div>}
          </section>
        </section>

        <aside className="chat-panel" aria-label="Чат комнаты">
          <div className="chat-header"><div className="chat-tabs"><button className={`chat-tab ${chatTab === 'chat' ? 'is-active' : ''}`} type="button" onClick={() => { setChatTab('chat'); setPickerOpen(false) }}><MessageCircle size={15} />Чат<span className="message-count">{messages.length}</span></button><button className={`chat-tab ${chatTab === 'voice' ? 'is-active' : ''}`} type="button" onClick={() => { setChatTab('voice'); setPickerOpen(false) }}><Mic size={15} />Голос{voice.participants.length > 0 && <span className="message-count">{voice.participants.length}</span>}</button></div><span className="chat-headcount"><strong>{members.length}</strong> в комнате</span></div>
          {chatTab === 'chat' ? <>
            {messages.length > 0 && <div className="chat-day-divider"><span>СЕГОДНЯ</span></div>}
            <div className={`message-list ${messages.length === 0 ? 'is-empty' : ''}`} ref={messageListRef} onScroll={handleMessageListScroll} aria-live="polite">{messages.length === 0 ? <div className="chat-empty">
              <div className="chat-empty-roster">
                {members.slice(0, 5).map((member) => <div className="chat-empty-person" key={member.id}>
                  <button className="avatar-button chat-empty-avatar" type="button" onClick={(event) => openMemberCard(member.id, event.currentTarget)} aria-label={`Открыть профиль ${member.username}`}><img src={getAvatarSource(member.avatar, 120)} alt="" />{member.isHost && <span className="chat-empty-crown"><Crown size={11} /></span>}</button>
                  <span className="chat-empty-name">{member.username}</span>
                  <span className={`chat-empty-role ${member.isHost ? '' : 'is-guest'}`}>{member.isHost ? 'ведущий' : 'смотрит'}</span>
                </div>)}
                <button className="chat-empty-invite" type="button" onClick={() => setRoomAccessOpen(true)}>
                  <span className="chat-empty-invite-mark"><Plus size={19} /></span>
                  <span className="chat-empty-name">пригласить</span>
                  <span className="chat-empty-role is-guest">по ссылке</span>
                </button>
              </div>
            </div> : messages.map((item, index) => item.system ? <div className="system-message" key={item.id ?? `${item.time}-${index}`}><span className="system-line" /><span>{item.text}</span><span className="system-line" /></div> : <article className={`message ${item.mine ? 'mine' : ''}`} key={item.id ?? `${item.name}-${item.time}-${index}`}>{!item.mine && (item.userId ? <button className="avatar-button" type="button" onClick={(event) => openMemberCard(item.userId ?? '', event.currentTarget, { id: item.userId ?? '', username: item.name, avatar: item.avatar ?? '', isHost: false })} aria-label={`Открыть профиль ${item.name}`}><img className="message-avatar" src={getAvatarSource(item.avatar, 64)} alt="" /></button> : <img className="message-avatar" src={getAvatarSource(item.avatar, 64)} alt="" />)}<div className="message-body"><div className="message-meta"><strong>{item.mine ? myName : item.name}</strong><time>{item.time}</time></div>{item.media && <img className="message-media" src={item.media} alt={item.text} />}{!item.media && <p className={item.sticker ? 'sticker-message' : ''}>{item.text}</p>}</div></article>)}</div>
            <div className="composer-wrap">
              {pickerOpen && <section className="media-picker" aria-label="Выбор эмодзи и медиа"><div className="picker-tabs"><button className={pickerCategory === 'emoji' ? 'is-active' : ''} type="button" onClick={() => setPickerCategory('emoji')}><Smile size={13} />Эмодзи</button><button className={pickerCategory === 'gif' ? 'is-active' : ''} type="button" onClick={() => setPickerCategory('gif')}>GIF</button><button className={pickerCategory === 'sticker' ? 'is-active' : ''} type="button" onClick={() => setPickerCategory('sticker')}>Стикеры</button></div>
                {pickerCategory === 'emoji' && <><div className="emoji-groups">{(Object.keys(emojiGroups) as (keyof typeof emojiGroups)[]).map((group) => <button className={emojiGroup === group ? 'is-active' : ''} type="button" key={group} onClick={() => setEmojiGroup(group)}>{group}</button>)}</div><div className="emoji-grid">{emojiGroups[emojiGroup].map((emoji, index) => <button type="button" key={`${emoji}-${index}`} onClick={() => setMessage((value) => `${value}${emoji}`)} aria-label={`Добавить ${emoji}`}>{emoji}</button>)}</div></>}
                {pickerCategory === 'gif' && <form className="gif-form" onSubmit={sendGif}><p>Вставь ссылку на GIF</p><div><input type="url" value={gifUrl} onChange={(event) => setGifUrl(event.target.value)} placeholder="https://…" aria-label="Ссылка на GIF" required /><button type="submit" aria-label="Отправить GIF"><Send size={14} /></button></div><small>Подойдут прямые ссылки на GIF из Tenor, Giphy и других сайтов</small><button className="upload-media-button" type="button" onClick={() => mediaInputRef.current?.click()}><ImagePlus size={14} />Загрузить GIF с устройства</button></form>}
                {pickerCategory === 'sticker' && <><div className="sticker-grid">{stickerOptions.map((sticker, index) => <button type="button" key={`${sticker}-${index}`} onClick={() => sendSticker(sticker)} aria-label={`Отправить стикер ${sticker}`}>{sticker}</button>)}</div><button className="upload-media-button" type="button" onClick={() => mediaInputRef.current?.click()}><ImagePlus size={14} />Добавить свой стикер или GIF</button></>}
              </section>}
              <form className="chat-composer" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Напиши что-нибудь…" aria-label="Сообщение в чат" /><button className={`emoji-button ${pickerOpen ? 'is-open' : ''}`} type="button" aria-label="Открыть эмодзи, GIF и стикеры" aria-expanded={pickerOpen} onClick={() => setPickerOpen((value) => !value)}><Smile size={17} /></button><button className="send-button" type="submit" aria-label="Отправить сообщение" disabled={!message.trim()}><Send size={15} /></button></form>
              <input ref={mediaInputRef} className="hidden-media-input" type="file" accept="image/*" onChange={sendCustomMedia} aria-label="Загрузить изображение, GIF или стикер" />
            </div>
          </> : <VoicePanel members={members} clientId={clientId} voice={voice} />}
          <div className="chat-footer"><span><span className="chat-online-dot" /> чат комнаты</span><button type="button" onClick={() => setRoomAccessOpen(true)}><Link2 size={12} /> поделиться</button></div>
        </aside>
      </div>
      <footer className="app-footer"><span>nyashki<span className="brand-dot">.</span> <span className="footer-separator">/</span> вы рядом, даже если далеко</span><span>комната приватная <span className="privacy-dot" /></span></footer>
      {openCard && cardMember ? <MemberCard member={cardMember} isSelf={cardMember.id === clientId} anchor={openCard.anchor} onClose={closeMemberCard} onEditSelf={cardMember.id === clientId ? editOwnProfile : undefined} /> : null}
      {roomAccessOpen && <RoomAccessDialog roomId={roomId} onClose={() => setRoomAccessOpen(false)} />}
    </main>
  )
}

function App() {
  const [roomId] = useState<string | null>(readRoomFromUrl)
  const [profile, setProfile] = useState<Profile>(readProfile)
  const [preferredName] = useState(readPreferredName)
  const [profileOpen, setProfileOpen] = useState(false)
  const [themePreview, setThemePreview] = useState<string | null>(null)
  const theme = themePreview ?? profile.theme
  const displayName = resolveDisplayName(profile, preferredName)

  function saveProfile(next: Profile) {
    setProfile(next)
    persistProfile(next)
    setThemePreview(null)
    setProfileOpen(false)
  }

  function closeProfile() {
    setThemePreview(null)
    setProfileOpen(false)
  }

  return (
    <>
      {roomId
        ? <WatchRoom roomId={roomId} profile={profile} theme={theme} onOpenProfile={() => setProfileOpen(true)} />
        : <RoomLobby profile={profile} displayName={displayName} theme={theme} onOpenProfile={() => setProfileOpen(true)} />}
      {profileOpen ? <ProfileDialog profile={profile} displayName={displayName} onClose={closeProfile} onSave={saveProfile} onThemePreview={setThemePreview} /> : null}
    </>
  )
}

export default App
