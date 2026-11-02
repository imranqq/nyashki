import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { cropMaxChars, cropPreviewUrl, cropToDataUrl, describeImageError, clampOffset, type CropGeometry, type CropTarget, type LoadedImage } from '../lib/image'

type ImageCropperProps = {
  image: LoadedImage
  target: CropTarget
  onCancel: () => void
  onApply: (dataUrl: string) => void
}

const minZoom = 1
const maxZoom = 3
const zoomStep = 0.25
const keyboardStep = 0.04

const titles: Record<CropTarget, string> = { avatar: 'Аватар', banner: 'Баннер' }

export function ImageCropper({ image, target, onCancel, onApply }: ImageCropperProps) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)
  const [viewport, setViewport] = useState({ width: 308, height: 308 })
  const [geometry, setGeometry] = useState<CropGeometry>({ zoom: 1, offsetX: 0, offsetY: 0 })
  const [error, setError] = useState('')

  // The selection is the inner frame, so the photo shows a margin of what gets cut away.
  useEffect(() => {
    const frame = viewportRef.current
    if (!frame) return
    const measure = () => {
      const rect = frame.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setViewport({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [onCancel])

  const coverScale = Math.max(viewport.width / (image.width || 1), viewport.height / (image.height || 1))
  const scale = coverScale * geometry.zoom
  const displayWidth = image.width * scale
  const displayHeight = image.height * scale
  const overflowX = Math.max(0, displayWidth - viewport.width) / 2
  const overflowY = Math.max(0, displayHeight - viewport.height) / 2
  const imageStyle = {
    width: `${displayWidth}px`,
    height: `${displayHeight}px`,
    left: `${(viewport.width - displayWidth) / 2 + geometry.offsetX * overflowX}px`,
    top: `${(viewport.height - displayHeight) / 2 + geometry.offsetY * overflowY}px`,
  }

  const previewUrl = useMemo(
    () => cropPreviewUrl(image.element, viewport.width, viewport.height, geometry, target),
    // The preview follows every drag frame, so it is rebuilt from the geometry that is actually rendered.
    [geometry, image.element, target, viewport.height, viewport.width],
  )

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: geometry.offsetX,
      offsetY: geometry.offsetY,
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    setGeometry({
      zoom: geometry.zoom,
      offsetX: overflowX > 0 ? clampOffset(drag.offsetX + deltaX / overflowX) : 0,
      offsetY: overflowY > 0 ? clampOffset(drag.offsetY + deltaY / overflowY) : 0,
    })
  }

  function releasePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-keyboardStep, 0],
      ArrowRight: [keyboardStep, 0],
      ArrowUp: [0, -keyboardStep],
      ArrowDown: [0, keyboardStep],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    setGeometry((current) => ({
      zoom: current.zoom,
      offsetX: clampOffset(current.offsetX + move[0]),
      offsetY: clampOffset(current.offsetY + move[1]),
    }))
  }

  function changeZoom(nextZoom: number) {
    setGeometry((current) => ({ ...current, zoom: Math.min(maxZoom, Math.max(minZoom, nextZoom)) }))
  }

  function resetCrop() {
    setGeometry({ zoom: 1, offsetX: 0, offsetY: 0 })
    setError('')
  }

  function applyCrop() {
    try {
      onApply(cropToDataUrl(image.element, viewport.width, viewport.height, geometry, target))
    } catch (applyError) {
      setError(describeImageError(applyError))
    }
  }

  return (
    <div className="crop-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className={`crop-dialog ${target === 'banner' ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header className="crop-header">
          <div>
            <h2 id="crop-title">{titles[target]}</h2>
            <span className="crop-asset-size">{image.width} × {image.height} · не больше {Math.round(cropMaxChars(target) / 1000)} КБ</span>
          </div>
          <button className="crop-close" type="button" onClick={onCancel} aria-label="Закрыть"><X size={17} /></button>
        </header>

        <div
          className={`crop-workspace ${target === 'banner' ? 'is-wide' : ''}`}
          ref={workspaceRef}
          role="application"
          aria-label="Перетаскивай фото, стрелки двигают его"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onKeyDown={handleKeyDown}
        >
          <div className="crop-viewport" ref={viewportRef}>
            <img className="crop-image" src={image.url} alt="" draggable={false} style={imageStyle} />
            <span className="crop-edge" aria-hidden="true" />
            <span className="crop-hint">перетащи фото</span>
          </div>
        </div>

        <div className="crop-controls">
          <div className="crop-zoom">
            <button type="button" onClick={() => changeZoom(geometry.zoom - zoomStep)} aria-label="Уменьшить масштаб"><Minus size={14} /></button>
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={0.05}
              value={geometry.zoom}
              onChange={(event) => changeZoom(Number(event.target.value))}
              aria-label="Масштаб"
              aria-valuetext={`${Math.round(geometry.zoom * 100)} процентов`}
            />
            <button type="button" onClick={() => changeZoom(geometry.zoom + zoomStep)} aria-label="Увеличить масштаб"><Plus size={14} /></button>
            <button className="crop-reset" type="button" onClick={resetCrop}>Сбросить</button>
          </div>
          <img className={`crop-preview ${target === 'banner' ? 'is-wide' : ''}`} src={previewUrl} alt="Как будет выглядеть" />
        </div>

        {error ? <p className="crop-error" role="alert">{error}</p> : null}

        <div className="crop-actions">
          <button className="crop-cancel" type="button" onClick={onCancel}>Отмена</button>
          <button className="crop-apply" type="button" onClick={applyCrop}>Применить</button>
        </div>
      </section>
    </div>
  )
}
