export type RecentRoom = { roomId: string; visitedAt: number }

const recentRoomsKey = 'nyashki-recent-rooms'
const legacyRoomKey = 'nyashki-room-id'
const maxRecentRooms = 8
const roomIdPattern = /[^a-zA-Z0-9_-]/g
const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export function sanitizeRoomId(value: string): string {
  return value.replace(roomIdPattern, '').slice(0, 64)
}

// The room only exists in the address bar; the lobby is shown when there is no code in it.
export function readRoomFromUrl(): string | null {
  const requested = new URL(window.location.href).searchParams.get('room')
  const cleaned = requested ? sanitizeRoomId(requested) : ''
  return cleaned || null
}

function normalizeRecent(value: unknown): RecentRoom[] {
  if (!Array.isArray(value)) return []
  const rooms: RecentRoom[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<RecentRoom>
    if (typeof candidate.roomId !== 'string') continue
    const roomId = sanitizeRoomId(candidate.roomId)
    const visitedAt = typeof candidate.visitedAt === 'number' && Number.isFinite(candidate.visitedAt) ? candidate.visitedAt : 0
    if (!roomId) continue
    if (rooms.some((room) => room.roomId === roomId)) continue
    rooms.push({ roomId, visitedAt })
  }
  return rooms.sort((first, second) => second.visitedAt - first.visitedAt).slice(0, maxRecentRooms)
}

function writeRecentRooms(rooms: RecentRoom[]) {
  try {
    localStorage.setItem(recentRoomsKey, JSON.stringify(rooms.slice(0, maxRecentRooms)))
  } catch {
    // A full quota must not break entry into a room.
  }
}

export function readRecentRooms(): RecentRoom[] {
  let stored: unknown = null
  try {
    const raw = localStorage.getItem(recentRoomsKey)
    stored = raw ? JSON.parse(raw) : null
  } catch {
    stored = null
  }
  const rooms = normalizeRecent(stored)
  if (rooms.length > 0) return rooms

  // Older builds kept a single room; it becomes the first history entry instead of auto-opening.
  try {
    const legacy = localStorage.getItem(legacyRoomKey)
    const roomId = legacy ? sanitizeRoomId(legacy) : ''
    if (roomId) {
      localStorage.removeItem(legacyRoomKey)
      const migrated = [{ roomId, visitedAt: Date.now() }]
      writeRecentRooms(migrated)
      return migrated
    }
  } catch {
    // Without storage the lobby simply starts without history.
  }
  return []
}

export function rememberRoom(roomId: string, visitedAt = Date.now()): RecentRoom[] {
  const cleaned = sanitizeRoomId(roomId)
  if (!cleaned) return readRecentRooms()
  const rooms = [{ roomId: cleaned, visitedAt }, ...readRecentRooms().filter((room) => room.roomId !== cleaned)].slice(0, maxRecentRooms)
  writeRecentRooms(rooms)
  return rooms
}

export function forgetRoom(roomId: string): RecentRoom[] {
  const rooms = readRecentRooms().filter((room) => room.roomId !== roomId)
  writeRecentRooms(rooms)
  return rooms
}

function randomRoomSuffix(): string {
  const bytes = new Uint8Array(2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createRoomId(existing: RecentRoom[] = readRecentRooms()): string {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const roomId = `vecher-${randomRoomSuffix()}`
    if (!existing.some((room) => room.roomId === roomId)) return roomId
  }
  return `vecher-${Date.now().toString(36).slice(-4)}`
}

export function roomUrl(roomId: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('room', roomId)
  return url.href
}

export function openRoom(roomId: string) {
  rememberRoom(roomId)
  window.location.assign(roomUrl(roomId))
}

export function leaveRoom() {
  const url = new URL(window.location.href)
  url.searchParams.delete('room')
  window.location.assign(url.href)
}

export function formatVisitedAt(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const visited = new Date(timestamp)
  const today = new Date(now)
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(today) - startOfDay(visited)) / 86_400_000)
  const time = `${String(visited.getHours()).padStart(2, '0')}:${String(visited.getMinutes()).padStart(2, '0')}`
  if (dayDiff <= 0) return `сегодня, ${time}`
  if (dayDiff === 1) return `вчера, ${time}`
  if (dayDiff < 7) return `${dayDiff} дн. назад`
  return `${visited.getDate()} ${monthNames[visited.getMonth()]}`
}
