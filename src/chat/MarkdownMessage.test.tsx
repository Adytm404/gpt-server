import { render, screen } from '@testing-library/react'
import { MarkdownMessage } from './MarkdownMessage'

it('renders readable GFM output', () => {
  render(<MarkdownMessage>{`## Ringkasan\n\n- **Disk:** 67 GB tersedia\n- Service: \`sshd\`\n\n| Item | Status |\n| --- | --- |\n| Disk | Aman |`}</MarkdownMessage>)
  expect(screen.getByRole('heading', { name: 'Ringkasan' })).toBeInTheDocument()
  expect(screen.getByText('Disk:')).toBeInTheDocument()
  expect(screen.getByText('sshd')).toBeInTheDocument()
  expect(screen.getByRole('table')).toBeInTheDocument()
})

it('does not render raw HTML or unsafe links', () => {
  const { container } = render(<MarkdownMessage>{`<script>alert(1)</script>\n\n[unsafe](javascript:alert(1)) [safe](https://example.com)`}</MarkdownMessage>)
  expect(container.querySelector('script')).not.toBeInTheDocument()
  expect(screen.getByText('unsafe')).not.toHaveAttribute('href')
  expect(screen.queryByRole('link', { name: 'unsafe' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'safe' })).toHaveAttribute('href', 'https://example.com')
})

it('shows a cursor while streaming', () => {
  const { container } = render(<MarkdownMessage streaming>**Sedang** menjelaskan</MarkdownMessage>)
  expect(container.querySelector('.summary-cursor')).toBeInTheDocument()
})
