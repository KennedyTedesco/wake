import { X } from 'lucide-react'
import { dismissToast, useStore } from '../state/store'

export function Toasts() {
  const toasts = useStore((state) => state.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className="toast" data-tone={item.tone}>
          <span className="toast-text">{item.text}</span>
          {item.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(item.id)
                item.action?.run()
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => dismissToast(item.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
