import { useState } from 'react'
import type { FileDiff } from '../../shared/model'
import { formatBytes } from '../lib/format'

type Mode = 'side' | 'swipe' | 'onion'

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'side', label: '2-up' },
  { mode: 'swipe', label: 'Swipe' },
  { mode: 'onion', label: 'Onion skin' }
]

const size = (bytes: number | null) => (bytes === null ? '' : ` · ${formatBytes(bytes)}`)

/** Before and after of an image, compared side by side, with a swipe handle or as a fade. */
export function ImageDiff({ diff }: { diff: Extract<FileDiff, { kind: 'image' }> }) {
  const [mode, setMode] = useState<Mode>('side')
  const [amount, setAmount] = useState(50)
  const { oldImage, newImage } = diff

  if (!oldImage && !newImage) {
    return (
      <div className="diff-message">
        <p>The image is too large to preview.</p>
      </div>
    )
  }
  if (!oldImage || !newImage) {
    const src = newImage ?? oldImage ?? ''
    return (
      <div className="image-diff">
        <figure className="image-side" data-side={newImage ? 'new' : 'old'}>
          <figcaption>
            {newImage ? `Added${size(diff.newSize)}` : `Deleted${size(diff.oldSize)}`}
          </figcaption>
          <img src={src} alt={newImage ? 'Added image' : 'Deleted image'} />
        </figure>
      </div>
    )
  }

  return (
    <div className="image-compare">
      <div className="image-toolbar">
        <div className="segmented segmented-text" role="group" aria-label="Compare mode">
          {MODES.map((item) => (
            <button
              key={item.mode}
              type="button"
              aria-pressed={mode === item.mode}
              onClick={() => setMode(item.mode)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode !== 'side' ? (
          <input
            className="image-slider"
            type="range"
            min={0}
            max={100}
            value={amount}
            aria-label={mode === 'swipe' ? 'Swipe position' : 'Opacity of the old image'}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        ) : null}
      </div>
      {mode === 'side' ? (
        <div className="image-diff">
          <figure className="image-side" data-side="old">
            <figcaption>Before{size(diff.oldSize)}</figcaption>
            <img src={oldImage} alt="Before" />
          </figure>
          <figure className="image-side" data-side="new">
            <figcaption>After{size(diff.newSize)}</figcaption>
            <img src={newImage} alt="After" />
          </figure>
        </div>
      ) : (
        <div className="image-diff">
          <div className="image-stack">
            <img src={newImage} alt="After" />
            <img
              src={oldImage}
              alt="Before"
              style={
                mode === 'swipe'
                  ? { clipPath: `inset(0 ${100 - amount}% 0 0)` }
                  : { opacity: (100 - amount) / 100 }
              }
            />
            {mode === 'swipe' ? (
              <span className="image-handle" style={{ insetInlineStart: `${amount}%` }} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
