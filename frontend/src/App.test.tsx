import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Duovie application shell', () => {
  it('renders the product name and foundation message', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Duovie' })).toBeInTheDocument()
    expect(screen.getByText('Private movie dates, together.')).toBeInTheDocument()
    expect(screen.getByText('Early development')).toBeInTheDocument()
  })
})
