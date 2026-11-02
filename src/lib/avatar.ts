export function getAvatarSource(avatar: string | undefined, size: number): string {
  if (avatar?.startsWith('http://') || avatar?.startsWith('https://')) return avatar
  return `https://i.pravatar.cc/${size}?img=${encodeURIComponent(avatar || '11')}`
}
