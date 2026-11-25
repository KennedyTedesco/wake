import { Check, Minus } from 'lucide-react'

export type CheckState = 'on' | 'off' | 'mixed'

type Props = {
  state: CheckState
  label: string
  onChange: (next: boolean) => void
  disabled?: boolean
}

/** A tri-state checkbox; `mixed` means some lines of a file are included. */
export function Checkbox({ state, label, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
      aria-label={label}
      title={label}
      className="checkbox"
      data-state={state}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(state !== 'on')
      }}
    >
      {state === 'on' ? (
        <Check size={11} strokeWidth={3} />
      ) : state === 'mixed' ? (
        <Minus size={11} strokeWidth={3} />
      ) : null}
    </button>
  )
}
