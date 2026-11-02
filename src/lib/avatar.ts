export function getAvatarSource(avatar: string | undefined, size: number): string {
  if (avatar?.startsWith('http://') || avatar?.startsWith('https://') || avatar?.startsWith('data:image/') || avatar?.startsWith('blob:')) return avatar
  return `https://i.pravatar.cc/${size}?img=${encodeURIComponent(avatar || '11')}`
}
