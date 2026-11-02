import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Upload, X } from 'lucide-react'
import { ImageCropper } from './ImageCropper'
import { getAvatarSource } from '../lib/avatar'
import { AVATAR_MAX_CHARS, BANNER_MAX_CHARS, describeImageError, loadImageFile, releaseLoadedImage, type CropTarget, type LoadedImage } from '../lib/image'
import { defaultProfile, themeAccent, themes, type Profile } from '../lib/profile'

type ProfileDialogProps = {
  profile: Profile
  displayName: string
  onClose: () => void
  onSave: (profile: Profile) => void
  onThemePreview: (theme: string | null) => void
}

type MediaErrors = { avatar: string; banner: string }

const mediaLabels: Record<CropTarget, string> = { avatar: 'аватар', banner: 'баннер' }

export function ProfileDialog({ profile, displayName, onClose, onSave, onThemePreview }: ProfileDialogProps) {
  const [draft, setDraft] = useState<Profile>(profile)
  const [crop, setCrop] = useState<{ target: CropTarget; image: LoadedImage } | null>(null)
  const [mediaErrors, setMediaErrors] = useState<MediaErrors>({ avatar: '', banner: '' })
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const cropRef = useRef<LoadedImage | null>(null)

  useEffect(() => {
    onThemePreview(draft.theme)
  }, [draft.theme, onThemePreview])

  useEffect(() => {
    cropRef.current = crop?.image ?? null
  }, [crop])

  // The cropper handles Escape on its own while it is open.
  useEffect(() => {
    if (crop) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [crop, onClose])

  useEffect(() => () => releaseLoadedImage(cropRef.current), [])

  async function pickFile(target: CropTarget, file: File | undefined) {
    if (!file) return
    try {
      const image = await loadImageFile(file)
      releaseLoadedImage(cropRef.current)
      setCrop({ target, image })
      setMediaErrors((current) => ({ ...current, [target]: '' }))
    } catch (error) {
      setMediaErrors((current) => ({ ...current, [target]: describeImageError(error) }))
    }
  }

  function cancelCrop() {
    if (!crop) return
    releaseLoadedImage(crop.image)
    cropRef.current = null
    setCrop(null)
  }

  function applyCrop(dataUrl: string) {
    if (!crop) return
    setDraft((current) => ({ ...current, [crop.target]: dataUrl }))
    setMediaErrors((current) => ({ ...current, [crop.target]: '' }))
    releaseLoadedImage(crop.image)
    cropRef.current = null
    setCrop(null)
  }

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // An empty name is fine: the room then names the guest "Пользователь N".
    const username = draft.username.trim().replace(/^@/, '')
    const avatar = draft.avatar.trim()
    const banner = draft.banner.trim()
    if (avatar.startsWith('data:') && avatar.length > AVATAR_MAX_CHARS) {
      setMediaErrors((current) => ({ ...current, avatar: 'Слишком большое фото. Выбери картинку поменьше.' }))
      return
    }
    if (banner.startsWith('data:') && banner.length > BANNER_MAX_CHARS) {
      setMediaErrors((current) => ({ ...current, banner: 'Слишком большое фото. Выбери картинку поменьше.' }))
      return
    }
    onSave({ ...draft, username, avatar, banner })
  }

  const avatarSource = getAvatarSource(draft.avatar || defaultProfile.avatar, 160)
  const bannerSource = draft.banner || defaultProfile.banner
  const avatarFromGallery = draft.avatar.startsWith('data:')
  const bannerFromGallery = draft.banner.startsWith('data:')
  const accent = themeAccent(draft.theme)

  return (
    <div className="profile-modal-backdrop" style={{ '--lime': accent.color } as React.CSSProperties} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
        <div className="profile-modal-header">
          <div>
            <span className="profile-modal-kicker">ТВОЯ СТРАНИЦА</span>
            <h2 id="profile-modal-title">Профиль</h2>
          </div>
          <button className="profile-modal-close" type="button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
        </div>

        <form onSubmit={saveProfile}>
          <div className="profile-preview">
            <img className="profile-preview-banner" src={bannerSource} alt="Баннер профиля" />
            <div className="profile-preview-shade" />
            <div className="profile-preview-user">
              <img src={avatarSource} alt="Аватар профиля" />
              <div>
                <strong>{draft.username || displayName}</strong>
                <span>{draft.bio || 'Здесь пока тихо...'}</span>
              </div>
            </div>
            <div className="profile-preview-actions">
              <button type="button" onClick={() => avatarInputRef.current?.click()}><ImagePlus size={12} />Изменить аватар</button>
              <button type="button" onClick={() => bannerInputRef.current?.click()}><ImagePlus size={12} />Изменить баннер</button>
            </div>
            <span className="preview-label">ПРЕДПРОСМОТР</span>
          </div>
          <input ref={avatarInputRef} className="hidden-media-input" type="file" accept="image/*" aria-label="Выбрать аватар из галереи" onChange={(event) => { void pickFile('avatar', event.target.files?.[0]); event.target.value = '' }} />
          <input ref={bannerInputRef} className="hidden-media-input" type="file" accept="image/*" aria-label="Выбрать баннер из галереи" onChange={(event) => { void pickFile('banner', event.target.files?.[0]); event.target.value = '' }} />

          <fieldset className="theme-picker">
            <legend>ЦВЕТОВАЯ ТЕМА</legend>
            <div className="theme-options">
              {themes.map((theme) => (
                <button className={`theme-option ${draft.theme === theme.id ? 'is-selected' : ''}`} type="button" key={theme.id} onClick={() => setDraft((current) => ({ ...current, theme: theme.id }))} aria-pressed={draft.theme === theme.id} aria-label={`Тема ${theme.name}`}>
                  <span className="theme-swatch" style={{ '--swatch-color': theme.color, '--swatch-ink': theme.ink } as React.CSSProperties} />
                  <span>{theme.name}</span>
                  {draft.theme === theme.id && <Check size={13} />}
                </button>
              ))}
            </div>
            <small>Цвет акцентов на кнопках и элементах комнаты</small>
          </fieldset>

          <div className="profile-fields">
            <label className="profile-field">
              <span>Юзернейм</span>
              <div className="username-input">
                <span>@</span>
                <input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value.replace(/[^\p{L}\p{N}_. ]/gu, '') }))} maxLength={24} autoComplete="off" placeholder="оставь пустым — комната назовёт сама" aria-label="Юзернейм" />
              </div>
              <small>Буквы, цифры, пробел, точка и нижнее подчёркивание</small>
            </label>

            <label className="profile-field">
              <span>О себе</span>
              <textarea value={draft.bio} onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))} maxLength={120} placeholder="Пара слов о себе" rows={2} />
              <small className="character-count">{draft.bio.length}/120</small>
            </label>

            <label className="profile-field profile-media-field">
              <span>Аватар</span>
              <div className="profile-media-row">
                <input type="url" value={avatarFromGallery ? '' : draft.avatar} onChange={(event) => setDraft((current) => ({ ...current, avatar: event.target.value }))} placeholder={avatarFromGallery ? 'фото из галереи' : 'https://...'} aria-label="Ссылка на аватар" />
                <button className="profile-media-pick" type="button" onClick={() => avatarInputRef.current?.click()}><ImagePlus size={13} />Из галереи</button>
              </div>
              {mediaErrors.avatar ? <small className="profile-field-error" role="alert">{mediaErrors.avatar}</small> : null}
            </label>

            <label className="profile-field profile-media-field">
              <span>Баннер</span>
              <div className="profile-media-row">
                <input type="url" value={bannerFromGallery ? '' : draft.banner} onChange={(event) => setDraft((current) => ({ ...current, banner: event.target.value }))} placeholder={bannerFromGallery ? 'фото из галереи' : 'https://...'} aria-label="Ссылка на баннер" />
                <button className="profile-media-pick" type="button" onClick={() => bannerInputRef.current?.click()}><ImagePlus size={13} />Из галереи</button>
              </div>
              {mediaErrors.banner ? <small className="profile-field-error" role="alert">{mediaErrors.banner}</small> : null}
            </label>
          </div>

          <div className="profile-modal-actions">
            <button className="profile-cancel" type="button" onClick={onClose}>Отмена</button>
            <button className="profile-save" type="submit"><Upload size={15} />Сохранить профиль</button>
          </div>
        </form>
      </section>

      {crop ? <ImageCropper image={crop.image} target={crop.target} onCancel={cancelCrop} onApply={applyCrop} /> : null}
      <span className="sr-only" aria-live="polite">{crop ? `Выбор области: ${mediaLabels[crop.target]}` : ''}</span>
    </div>
  )
}
