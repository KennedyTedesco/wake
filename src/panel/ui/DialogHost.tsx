import { AlertTriangle, TerminalSquare } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { operation } from '../lib/bridge'
import { closeDialog, type Dialog, run, setTab, showFailure, sync, useStore } from '../state/store'

export function DialogHost() {
  const dialog = useStore((state) => state.dialog)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (dialog && !element.open) element.showModal()
    if (!dialog && element.open) element.close()
  }, [dialog])

  return (
    <dialog ref={ref} className="dialog" onClose={closeDialog} onCancel={closeDialog}>
      {dialog ? <DialogBody key={dialogKey(dialog)} dialog={dialog} /> : null}
    </dialog>
  )
}

function dialogKey(dialog: Dialog): string {
  return `${dialog.kind}:${dialog.title}`
}

function DialogBody({ dialog }: { dialog: Dialog }) {
  switch (dialog.kind) {
    case 'confirm':
      return <ConfirmBody dialog={dialog} />
    case 'prompt':
      return <PromptBody dialog={dialog} />
    case 'failure':
      return <FailureBody dialog={dialog} />
  }
}

function Frame({
  title,
  children,
  actions
}: {
  title: string
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <>
      <h2 className="dialog-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </>
  )
}

function ConfirmBody({ dialog }: { dialog: Extract<Dialog, { kind: 'confirm' }> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Frame
      title={dialog.title}
      actions={
        <>
          <button type="button" className="button" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            data-variant={dialog.destructive ? 'danger' : 'primary'}
            disabled={busy}
            // biome-ignore lint/a11y/noAutofocus: the confirm button is the dialog's one decision
            autoFocus
            onClick={async () => {
              setBusy(true)
              closeDialog()
              await dialog.onConfirm()
            }}
          >
            {dialog.confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-text">{dialog.body}</p>
    </Frame>
  )
}

function PromptBody({ dialog }: { dialog: Extract<Dialog, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(dialog.initial)
  const [busy, setBusy] = useState(false)
  const error = value.trim() ? (dialog.validate?.(value) ?? null) : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim() || error || busy) return
    setBusy(true)
    const done = await dialog.onSubmit(value.trim())
    setBusy(false)
    if (done) closeDialog()
  }

  return (
    <form onSubmit={submit}>
      <Frame
        title={dialog.title}
        actions={
          <>
            <button type="button" className="button" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="submit"
              className="button"
              data-variant="primary"
              disabled={!value.trim() || !!error || busy}
            >
              {dialog.confirmLabel}
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">{dialog.label}</span>
          <input
            className="input"
            value={value}
            placeholder={dialog.placeholder}
            spellCheck={false}
            // biome-ignore lint/a11y/noAutofocus: the field is the reason the dialog opened
            autoFocus
            aria-invalid={!!error}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {error ? (
          <p className="field-error">{error}</p>
        ) : (dialog.preview?.(value) ?? dialog.hint) ? (
          <p className="field-hint">{dialog.preview?.(value) ?? dialog.hint}</p>
        ) : null}
      </Frame>
    </form>
  )
}

function FailureBody({ dialog }: { dialog: Extract<Dialog, { kind: 'failure' }> }) {
  const { failure } = dialog
  const command = failure.command

  const openTerminal = async () => {
    if (!command) return
    closeDialog()
    const result = await operation('workspace.runInTerminal', { command })
    if (!result.ok) showFailure('Could not open a terminal', result)
  }

  return (
    <Frame
      title={dialog.title}
      actions={
        <>
          {failure.kind === 'auth' && command ? (
            <button type="button" className="button" data-variant="primary" onClick={openTerminal}>
              <TerminalSquare size={14} /> Run in terminal
            </button>
          ) : null}
          {failure.kind === 'rejected' ? (
            <button
              type="button"
              className="button"
              data-variant="primary"
              onClick={() => {
                closeDialog()
                void sync('pull')
              }}
            >
              Pull first
            </button>
          ) : null}
          {failure.kind === 'dirty' ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                closeDialog()
                void run('stash.push', {}, { title: 'Could not stash', success: 'Changes stashed' })
              }}
            >
              Stash my changes
            </button>
          ) : null}
          {failure.kind === 'conflicts' ? (
            <button
              type="button"
              className="button"
              data-variant="primary"
              onClick={() => {
                closeDialog()
                setTab('changes')
              }}
            >
              Resolve conflicts
            </button>
          ) : null}
          <button type="button" className="button" onClick={closeDialog}>
            Close
          </button>
        </>
      }
    >
      <div className="failure">
        <AlertTriangle size={18} className="failure-icon" />
        <div className="failure-text">
          <p className="dialog-text">{failure.message}</p>
          {failure.kind === 'auth' ? (
            <p className="field-hint">
              Git needs your credentials, and Orca never lets plugins prompt for them. Run the
              command in a terminal once to sign in, then try again here.
            </p>
          ) : null}
        </div>
      </div>
      {failure.detail ? (
        <details className="failure-detail">
          <summary>Git output</summary>
          <pre>{failure.detail}</pre>
        </details>
      ) : null}
    </Frame>
  )
}
