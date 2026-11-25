// Plugin frames refuse `navigator.clipboard`; `execCommand('copy')` still works inside a click
// or key press, which is where every copy in the panel starts.
export function copyText(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  return copied
}
