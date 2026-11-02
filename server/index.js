import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'

// A host such as Render passes its own port and expects the process to listen on all interfaces.
const port = Number(process.env.PORT || process.env.ROOM_PORT || 3001)
const host = process.env.HOST || '0.0.0.0'
const serverDirectory = dirname(fileURLToPath(import.meta.url))
const dataDirectory = process.env.NYASHKI_DATA_DIR || join(serverDirectory, 'data')
const siteDirectory = join(serverDirectory, '..', 'dist')
const siteIndexFile = join(siteDirectory, 'index.html')
const builtSiteExists = existsSync(siteIndexFile)
const stateFile = join(dataDirectory, 'rooms.json')
const maxStateBytes = 4 * 1024 * 1024
const dayMs = 24 * 60 * 60 * 1000
// Rooms nobody visits are removed; empty rooms (no chat, queue or video) go sooner.
const roomTtlMs = readPositiveNumber(process.env.NYASHKI_ROOM_TTL_DAYS, 30) * dayMs
const emptyRoomTtlMs = readPositiveNumber(process.env.NYASHKI_EMPTY_ROOM_TTL_HOURS, 24) * 60 * 60 * 1000
const pruneIntervalMs = 60 * 60 * 1000
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}
const httpServer = createServer((request, response) => handleSiteRequest(request, response))
const io = new Server(httpServer, {
  maxHttpBufferSize: 4e6,
})
const rooms = new Map()

function sendStaticFile(response, filePath, size, cacheControl, sendBody) {
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': cacheControl,
  })
  if (!sendBody) {
    response.end()
    return
  }
  createReadStream(filePath).pipe(response)
}

// Only files inside dist are served, so a crafted path cannot walk up the project tree.
function findStaticFile(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const candidate = resolve(siteDirectory, `.${decoded}`)
  if (!candidate.startsWith(siteDirectory + sep)) return null
  try {
    const stats = statSync(candidate)
    return stats.isFile() ? { file: candidate, stats } : null
  } catch {
    return null
  }
}

// Locally Vite serves the site; on a host this single process answers with the built app.
function handleSiteRequest(request, response) {
  const urlPath = (request.url || '/').split('?')[0]
  if (urlPath.startsWith('/socket.io')) return
  if (!builtSiteExists || (request.method !== 'GET' && request.method !== 'HEAD')) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  const sendBody = request.method === 'HEAD' ? false : true
  const staticFile = findStaticFile(urlPath)
  if (staticFile) {
    const cacheControl = urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    sendStaticFile(response, staticFile.file, staticFile.stats.size, cacheControl, sendBody)
    return
  }
  // Unknown paths may still be a client route, so the app shell answers instead of a 404.
  sendStaticFile(response, siteIndexFile, statSync(siteIndexFile).size, 'no-cache', sendBody)
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      messages: [],
      queue: [],
      members: new Map(),
      voice: new Map(),
      hostId: null,
      playback: { url: '', title: '', playing: false, progress: 0, currentTime: 0, duration: 0 },
      updatedAt: Date.now(),
    })
  }
  return rooms.get(roomId)
}

function normalizeRoomId(value) {
  const roomId = typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : ''
  return roomId || 'movie-night'
}

const maxAvatarChars = 8192
const maxBannerChars = 60000
const maxBioChars = 120

// Photos arrive as data URLs, so only the allowed schemes and lengths reach the room.
function normalizeMedia(value, maxChars) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!/^https?:\/\//i.test(trimmed) && !/^data:image\//i.test(trimmed)) {
    // Older avatars kept a short pravatar index instead of a URL.
    return trimmed.length <= 24 ? trimmed : ''
  }
  return trimmed.length <= maxChars ? trimmed : ''
}

function normalizeUser(user = {}) {
  return {
    id: typeof user.id === 'string' ? user.id.slice(0, 100) : randomUUID(),
    // An empty username means "let the room name this guest".
    username: typeof user.username === 'string' ? user.username.replace(/[^\p{L}\p{N}_. ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24) : '',
    avatar: normalizeMedia(user.avatar, maxAvatarChars),
    bio: typeof user.bio === 'string' ? user.bio.replace(/\s+/g, ' ').trim().slice(0, maxBioChars) : '',
    banner: normalizeMedia(user.banner, maxBannerChars),
  }
}

const autoNamePattern = /^Пользователь \d{1,3}$/u

function autoName(index) {
  return `Пользователь ${index}`
}

function isNameFree(room, name, userId) {
  for (const member of room.members.values()) {
    if (member.id !== userId && member.username === name) return false
  }
  return true
}

// Numbers are reused once a guest leaves, so a two-person room stays "1" and "2".
function nextAutoName(room, userId) {
  const taken = new Set([...room.members.values()].filter((member) => member.id !== userId).map((member) => member.username))
  let index = 1
  while (taken.has(autoName(index))) index += 1
  return autoName(index)
}

// Guests without a profile name keep the number they already had in this browser.
function resolveMemberName(room, user, requestedUser) {
  if (user.username) return user.username
  const preferred = typeof requestedUser?.preferredName === 'string' ? requestedUser.preferredName.trim() : ''
  if (autoNamePattern.test(preferred) && isNameFree(room, preferred, user.id)) return preferred
  return nextAutoName(room, user.id)
}

function publicMember(member, room) {
  return { id: member.id, username: member.username, avatar: member.avatar, isHost: member.id === room.hostId }
}

function createSnapshot(room) {
  return {
    messages: room.messages,
    queue: room.queue,
    playback: room.playback,
    members: [...room.members.values()].map((member) => publicMember(member, room)),
  }
}

function broadcastRoom(roomId, saveDelay = 600) {
  const room = rooms.get(roomId)
  if (!room) return
  room.updatedAt = Date.now()
  io.to(roomId).emit('room:state', createSnapshot(room))
  scheduleStateSave(saveDelay)
}

function broadcastVoice(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  io.to(roomId).emit('voice:members', [...room.voice.entries()].map(([id, state]) => ({ id, muted: state.muted })))
}

// Banners are large, so profiles travel only when someone edits them, not with every snapshot.
function createProfiles(room) {
  return [...room.members.values()].map((member) => ({
    id: member.id,
    username: member.username,
    avatar: member.avatar,
    bio: member.bio ?? '',
    banner: member.banner ?? '',
    isHost: member.id === room.hostId,
  }))
}

function broadcastProfiles(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  io.to(roomId).emit('room:profiles', createProfiles(room))
}

function appendSystemMessage(room, text) {
  room.messages.push({ id: randomUUID(), name: 'Комната', text, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), system: true })
  room.messages = room.messages.slice(-100)
}

function restorePlayback(playback = {}) {
  const duration = Number.isFinite(playback.duration) && playback.duration > 0 ? playback.duration : 0
  const currentTime = Number.isFinite(playback.currentTime) && playback.currentTime > 0 ? playback.currentTime : 0
  return {
    url: typeof playback.url === 'string' ? playback.url : '',
    title: typeof playback.title === 'string' ? playback.title : '',
    // A restart always pauses playback so nobody reconnects into a running film.
    playing: false,
    progress: duration > 0 ? Math.min(100, currentTime / duration * 100) : 0,
    currentTime,
    duration,
  }
}

function restoreTimestamp(...values) {
  for (const value of values) {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return Date.now()
}

function restoreRoomState() {
  let raw
  try {
    raw = readFileSync(stateFile, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not read ${stateFile}: ${error.message}`)
    return
  }
  try {
    const saved = JSON.parse(raw)
    for (const [roomId, savedRoom] of Object.entries(saved.rooms ?? {})) {
      rooms.set(roomId, {
        messages: Array.isArray(savedRoom.messages) ? savedRoom.messages.slice(-100) : [],
        queue: Array.isArray(savedRoom.queue) ? savedRoom.queue : [],
        members: new Map(),
        voice: new Map(),
        hostId: null,
        playback: restorePlayback(savedRoom.playback),
        updatedAt: restoreTimestamp(savedRoom.updatedAt, saved.savedAt),
      })
    }
    if (rooms.size > 0) console.log(`Restored ${rooms.size} room(s) from ${stateFile}`)
  } catch (error) {
    console.warn(`Room state in ${stateFile} is unreadable, starting empty: ${error.message}`)
  }
}

function buildStatePayload() {
  const state = { version: 1, savedAt: new Date().toISOString(), rooms: {} }
  for (const [roomId, room] of rooms) {
    state.rooms[roomId] = {
      messages: room.messages.map((message) => ({ ...message })),
      queue: room.queue,
      playback: room.playback,
      updatedAt: new Date(room.updatedAt).toISOString(),
    }
  }

  let payload = JSON.stringify(state)
  if (Buffer.byteLength(payload) <= maxStateBytes) return payload

  // Base64 attachments can grow the file far past a sane size; drop the oldest ones first.
  const messagesWithMedia = Object.values(state.rooms).flatMap((savedRoom) => savedRoom.messages).filter((message) => typeof message.media === 'string')
  for (const message of messagesWithMedia) {
    delete message.media
    payload = JSON.stringify(state)
    if (Buffer.byteLength(payload) <= maxStateBytes) break
  }
  return payload
}

function writeState() {
  try {
    mkdirSync(dataDirectory, { recursive: true })
    const temporaryFile = `${stateFile}.tmp`
    writeFileSync(temporaryFile, buildStatePayload())
    renameSync(temporaryFile, stateFile)
  } catch (error) {
    console.warn(`Could not save room state: ${error.message}`)
  }
}

let stateWriteTimer = null
let stateWriteDueAt = 0

// Writes are coalesced: the first change schedules a save, later changes never postpone it.
function scheduleStateSave(delay = 600) {
  const dueAt = Date.now() + delay
  if (stateWriteTimer) {
    if (stateWriteDueAt <= dueAt) return
    clearTimeout(stateWriteTimer)
  }
  stateWriteDueAt = dueAt
  stateWriteTimer = setTimeout(() => {
    stateWriteTimer = null
    writeState()
  }, delay)
}

function flushState() {
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer)
    stateWriteTimer = null
  }
  writeState()
}

function isRoomEmpty(room) {
  return room.messages.length === 0 && room.queue.length === 0 && !room.playback.url
}

// Rooms with people inside are never collected, even if they look stale.
function pruneStaleRooms(reason = 'periodic') {
  const now = Date.now()
  let removed = 0
  for (const [roomId, room] of rooms) {
    if (room.members.size > 0) continue
    const limit = isRoomEmpty(room) ? emptyRoomTtlMs : roomTtlMs
    if (now - room.updatedAt < limit) continue
    rooms.delete(roomId)
    removed += 1
  }
  if (removed > 0) {
    console.log(`Pruned ${removed} stale room(s) on ${reason}, ${rooms.size} room(s) left`)
    scheduleStateSave(0)
  }
  return removed
}

restoreRoomState()
pruneStaleRooms('startup')
const pruneTimer = setInterval(() => pruneStaleRooms('schedule'), pruneIntervalMs)
if (typeof pruneTimer.unref === 'function') pruneTimer.unref()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    flushState()
    process.exit(0)
  })
}

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId: requestedRoomId, user: incomingUser } = {}) => {
    const roomId = normalizeRoomId(requestedRoomId)
    const user = normalizeUser(incomingUser)
    if (!user.id) return

    if (socket.data.roomId) socket.leave(socket.data.roomId)
    const room = getRoom(roomId)
    room.members.delete(user.id)
    room.members.set(user.id, { ...user, username: resolveMemberName(room, user, incomingUser), socketId: socket.id })
    room.hostId = user.id
    socket.data.roomId = roomId
    socket.data.userId = user.id
    socket.join(roomId)
    socket.emit('room:state', createSnapshot(room))
    broadcastRoom(roomId)
    broadcastProfiles(roomId)
  })

  socket.on('user:update', (incomingUser = {}) => {
    const roomId = socket.data.roomId
    const userId = socket.data.userId
    const room = roomId && rooms.get(roomId)
    if (!room || !userId) return
    const current = room.members.get(userId)
    const updated = normalizeUser({ ...incomingUser, id: userId })
    const username = updated.username || current?.username || nextAutoName(room, userId)
    room.members.set(userId, { ...updated, username, isHost: userId === room.hostId, socketId: current?.socketId ?? socket.id })
    broadcastRoom(roomId)
    broadcastProfiles(roomId)
  })

  socket.on('chat:send', (payload = {}) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const user = room?.members.get(socket.data.userId)
    if (!room || !user) return
    const text = typeof payload.text === 'string' ? payload.text.slice(0, 2000) : ''
    const media = typeof payload.media === 'string' && payload.media.length <= 3e6 ? payload.media : undefined
    if (!text.trim() || (media && !/^https?:\/\//i.test(media) && !/^data:image\//i.test(media))) return
    room.messages.push({ id: randomUUID(), userId: user.id, name: user.username, avatar: user.avatar, text, media, sticker: Boolean(payload.sticker), time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) })
    room.messages = room.messages.slice(-100)
    broadcastRoom(roomId)
  })

  socket.on('queue:add', (payload = {}) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const user = room?.members.get(socket.data.userId)
    if (!room || !user || typeof payload.url !== 'string' || typeof payload.title !== 'string') return
    try {
      const url = new URL(payload.url)
      if (!['http:', 'https:'].includes(url.protocol)) return
      room.queue.push({ id: randomUUID(), title: payload.title.slice(0, 120), url: url.href, addedBy: user.username, votes: [], voterIds: [] })
      appendSystemMessage(room, `${user.username} добавил видео в очередь: ${payload.title.slice(0, 120)}`)
      broadcastRoom(roomId)
    } catch {
      return
    }
  })

  socket.on('queue:vote', (videoId) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const userId = socket.data.userId
    const video = room?.queue.find((item) => item.id === videoId)
    if (!room || !video || !userId) return
    const existingVoteIndex = video.voterIds.indexOf(userId)
    if (existingVoteIndex >= 0) {
      video.voterIds.splice(existingVoteIndex, 1)
      video.votes.splice(existingVoteIndex, 1)
    } else {
      video.voterIds.push(userId)
      video.votes.push(room.members.get(userId)?.username ?? 'Пользователь')
    }
    broadcastRoom(roomId)
  })

  socket.on('queue:play', (videoId) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const user = room?.members.get(socket.data.userId)
    if (!room || !user) return
    if (user.id !== room.hostId) {
      socket.emit('room:error', 'Только ведущий комнаты может запускать видео из очереди.')
      return
    }
    const index = room.queue.findIndex((item) => item.id === videoId)
    if (index < 0) return
    const [video] = room.queue.splice(index, 1)
    room.playback = { url: video.url, title: video.title, playing: true, progress: 0, currentTime: 0, duration: 0 }
    appendSystemMessage(room, `Ведущий запустил видео: ${video.title}`)
    broadcastRoom(roomId)
  })

  socket.on('player:start', (payload = {}) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const user = room?.members.get(socket.data.userId)
    if (!room || !user) return
    if (user.id !== room.hostId) {
      socket.emit('room:error', 'Видео включает только ведущий комнаты. Свою ссылку можно предложить в очередь.')
      return
    }
    if (typeof payload.url !== 'string') return
    let url
    try {
      url = new URL(payload.url)
    } catch {
      socket.emit('room:error', 'Не удалось разобрать ссылку на видео.')
      return
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      socket.emit('room:error', 'Подойдёт только ссылка http или https.')
      return
    }
    const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim().slice(0, 140) : url.hostname
    room.playback = { url: url.href, title, playing: true, progress: 0, currentTime: 0, duration: 0 }
    room.queue = room.queue.filter((item) => item.url !== url.href)
    appendSystemMessage(room, `Ведущий включил видео: ${title}`)
    broadcastRoom(roomId)
  })

  socket.on('player:update', (payload = {}) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const user = room?.members.get(socket.data.userId)
    if (!room || !user) return
    if (user.id !== room.hostId) return
    if (typeof payload.playing === 'boolean') room.playback.playing = payload.playing
    if (typeof payload.progress === 'number' && Number.isFinite(payload.progress)) room.playback.progress = Math.max(0, Math.min(100, payload.progress))
    if (typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)) room.playback.currentTime = Math.max(0, payload.currentTime)
    if (typeof payload.duration === 'number' && Number.isFinite(payload.duration)) room.playback.duration = Math.max(0, payload.duration)
    if (room.playback.duration > 0) room.playback.progress = Math.max(0, Math.min(100, room.playback.currentTime / room.playback.duration * 100))
    broadcastRoom(roomId, 5000)
  })

  socket.on('voice:join', (payload = {}) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const user = room?.members.get(socket.data.userId)
    if (!room || !user) return
    room.voice.set(user.id, { muted: Boolean(payload.muted) })
    broadcastVoice(roomId)
  })

  socket.on('voice:mute', (payload = {}) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const state = room?.voice.get(socket.data.userId)
    if (!room || !state) return
    state.muted = Boolean(payload.muted)
    broadcastVoice(roomId)
  })

  socket.on('voice:leave', () => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    if (!room) return
    room.voice.delete(socket.data.userId)
    broadcastVoice(roomId)
  })

  // WebRTC handshake only; audio never passes through the server.
  socket.on('voice:signal', (payload = {}) => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    const senderId = socket.data.userId
    if (!room || !senderId || !room.voice.has(senderId)) return
    if (!['offer', 'answer', 'ice'].includes(payload.kind)) return
    const target = room.members.get(payload.to)
    if (!target?.socketId || !room.voice.has(target.id)) return
    io.to(target.socketId).emit('voice:signal', { from: senderId, kind: payload.kind, payload: payload.payload })
  })

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId
    const room = roomId && rooms.get(roomId)
    if (!room) return
    const leftVoice = room.voice.delete(socket.data.userId)
    const member = room.members.get(socket.data.userId)
    if (member?.socketId === socket.id) room.members.delete(socket.data.userId)
    if (room.hostId === socket.data.userId && !room.members.has(room.hostId)) room.hostId = [...room.members.keys()].at(-1) ?? null
    if (leftVoice) broadcastVoice(roomId)
    if (member) broadcastProfiles(roomId)
    broadcastRoom(roomId)
  })
})

httpServer.listen(port, host, () => {
  console.log(`Nyashki server listening on http://${host}:${port}`)
  if (builtSiteExists) console.log(`Serving the built site from ${siteDirectory}`)
  else console.log('No dist build found, so this process serves realtime events only. Run npm run build first to serve the site from one port.')
})