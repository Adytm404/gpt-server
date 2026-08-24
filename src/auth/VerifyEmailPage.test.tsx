import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import VerifyEmailPage from './VerifyEmailPage'
import { adminApi } from '../api/admin'

describe('VerifyEmailPage', () => {
  it('renders error when no token provided', () => {
    render(
      <MemoryRouter initialEntries={['/verify-email']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Activation failed')).toBeInTheDocument()
    expect(screen.getByText('No verification token provided in the URL.')).toBeInTheDocument()
  })

  it('renders success when verification succeeds', async () => {
    vi.spyOn(adminApi, 'verifyEmail').mockResolvedValue({ success: true, message: 'Verified' })
    render(
      <MemoryRouter initialEntries={['/verify-email?token=valid-token']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Verifying email...')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Email Verified!')).toBeInTheDocument()
    })
  })

  it('renders failure and resend form when token is invalid', async () => {
    vi.spyOn(adminApi, 'verifyEmail').mockRejectedValue(new Error('Invalid token'))
    render(
      <MemoryRouter initialEntries={['/verify-email?token=invalid-token']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText('Activation failed')).toBeInTheDocument()
      expect(screen.getByText('Invalid token')).toBeInTheDocument()
    })
    expect(screen.getByText('Registered email address')).toBeInTheDocument()
  })
})
