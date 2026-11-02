const roomCodePattern = /[^a-zA-Z0-9_-]/g

// Accepts a bare code or a whole share link and returns the room part of it.
export function resolveRoomCode(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  try {
    const fromUrl = new URL(raw).searchParams.get('room')
    if (fromUrl) return fromUrl.replace(roomCodePattern, '').slice(0, 64)
  } catch {
    // Not a link, so the value is treated as a code.
  }
  return raw.replace(roomCodePattern, '').slice(0, 64)
}

export function isLocalHost(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}
