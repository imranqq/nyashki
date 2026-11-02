export type Profile = { username: string; bio: string; avatar: string; banner: string; theme: string }
export type ThemeOption = { id: string; name: string; color: string; ink: string }

export const themes: ThemeOption[] = [
  { id: 'lime', name: 'Лайм', color: '#d6ff62', ink: '#17190f' },
  { id: 'graphite', name: 'Чёрный', color: '#f1f1ed', ink: '#171717' },
  { id: 'coral', name: 'Коралл', color: '#ff907e', ink: '#24130f' },
  { id: 'sky', name: 'Небо', color: '#82c8ff', ink: '#101a24' },
  { id: 'teal', name: 'Тёмная бирюза', color: '#35b8aa', ink: '#10201e' },
]

// An empty username means the room names the guest "Пользователь 1", "Пользователь 2", and so on.
export const defaultProfile: Profile = {
  username: '',
  bio: 'люблю кино, ночные прогулки и людей рядом',
  avatar: 'https://i.pravatar.cc/160?img=11',
  banner: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1200&q=85',
  theme: 'lime',
}

export const autoNamePattern = /^Пользователь \d{1,3}$/
// Names that earlier builds used as a default; they are treated as "no name chosen".
const legacyDefaultNames = new Set(['sasha', 'guest'])
const profileKey = 'nyashki-profile'
const autoNameKey = 'nyashki-auto-name'

export function readProfile(): Profile {
  try {
    const stored = localStorage.getItem(profileKey)
    if (stored) {
      const saved = JSON.parse(stored) as Partial<Profile>
      const username = typeof saved.username === 'string' ? saved.username.trim() : ''
      return { ...defaultProfile, ...saved, username: legacyDefaultNames.has(username.toLowerCase()) ? '' : username }
    }
  } catch {
    // Ignore invalid saved data and use the starter profile.
  }
  return defaultProfile
}

// Banners are stored as data URLs, so a full storage quota must not lose the edit made this session.
export function persistProfile(profile: Profile): boolean {
  try {
    localStorage.setItem(profileKey, JSON.stringify(profile))
    return true
  } catch {
    return false
  }
}

export function readPreferredName(): string {
  try {
    return localStorage.getItem(autoNameKey) ?? ''
  } catch {
    return ''
  }
}

// Keeps the assigned number stable across reloads, so a guest stays "Пользователь 2".
export function rememberPreferredName(name: string) {
  try {
    localStorage.setItem(autoNameKey, name)
  } catch {
    // Storage can be unavailable; the room then hands out a number on every join.
  }
}

export function resolveDisplayName(profile: Profile, preferredName: string): string {
  return profile.username || preferredName || 'Пользователь'
}

export function themeAccent(themeId: string): ThemeOption {
  return themes.find((theme) => theme.id === themeId) ?? themes[0]
}
