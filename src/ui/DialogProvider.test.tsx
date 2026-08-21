import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DialogProvider, useDialog } from './DialogProvider'

function Harness() {
  const dialog = useDialog()
  return <div>
    <button onClick={async () => document.body.dataset.result = String(await dialog.confirm({ title: 'Continue?', description: 'Review this action.', confirmLabel: 'Continue', tone: 'default' }))}>Confirm</button>
    <button onClick={async () => document.body.dataset.result = String(await dialog.prompt({ title: 'Rename', description: 'Choose a name.', label: 'Name', initialValue: 'Original', confirmLabel: 'Save' }))}>Prompt</button>
  </div>
}

describe('DialogProvider', () => {
  afterEach(() => { delete document.body.dataset.result })

  it('resolves confirm true only from confirmation', async () => {
    render(<DialogProvider><Harness /></DialogProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('dialog', { name: 'Continue?' })).toHaveAttribute('aria-modal', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(document.body.dataset.result).toBe('true')
  })

  it('returns prompt text and focuses its input', async () => {
    render(<DialogProvider><Harness /></DialogProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }))
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveFocus()
    await userEvent.clear(input)
    await userEvent.type(input, 'New title')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(document.body.dataset.result).toBe('New title')
  })

  it('cancels with Escape', async () => {
    render(<DialogProvider><Harness /></DialogProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.dataset.result).toBe('false')
  })
})
