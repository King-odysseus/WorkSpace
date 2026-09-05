import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectCostBudgetPanel } from './BoardViews.jsx'
import { mockApi, expectRequest } from '../test/setup-tests.js'

const project = { id: 4, name: 'Apollo', budget_amount: '1000.00', budget_currency: 'USD' }

const expense = (id, name, amount) => ({ id, name, amount, category: 'other', incurred_on: '2026-09-01', notes: '' })

const renderPanel = ({ expenses = [], projectOverrides = {}, canManage = true } = {}) => {
  const fetchMock = mockApi({
    '/api/workspaces/1/projects/4/expenses/': { expenses },
    '/api/workspaces/1/projects/4/': { project },
  })
  const onProjectUpdated = vi.fn()
  render(
    <ProjectCostBudgetPanel
      project={{ ...project, ...projectOverrides }}
      workspaceId={1}
      canManage={canManage}
      onProjectUpdated={onProjectUpdated}
    />,
  )
  return { fetchMock, onProjectUpdated }
}

// The summary renders as <strong>value</strong><span>label</span> pairs, so read
// the value by locating its label rather than matching loose text.
const summaryValue = label => screen.getByText(label).closest('div').querySelector('strong').textContent

// Intl renders USD as "$" or "US$" depending on the locale the runtime resolves,
// so assertions target the formatted number, not the currency symbol.

// Two forms in this panel label a field "Amount"; scope by the submit button.
const budgetForm = () => screen.getByRole('button', { name: /save budget/i }).closest('form')

describe('ProjectCostBudgetPanel summary', () => {
  it('totals the expenses and reports what is left of the budget', async () => {
    renderPanel({ expenses: [expense(1, 'Licences', '250.00'), expense(2, 'Travel', '150.50')] })

    await waitFor(() => expect(summaryValue('Spent')).toMatch(/400\.50$/))
    expect(summaryValue('Budget')).toMatch(/1,000\.00$/)
    expect(summaryValue('Remaining')).toMatch(/599\.50$/)
    expect(summaryValue('Used')).toBe('40%')
  })

  it('flags an overspend instead of showing a negative remainder as normal', async () => {
    renderPanel({ expenses: [expense(1, 'Overrun', '1250.00')] })

    await waitFor(() => expect(screen.getByText('Over budget')).toBeInTheDocument())
    expect(summaryValue('Over budget')).toMatch(/^-.*250\.00$/)
    expect(screen.getByText('Over budget').closest('div')).toHaveClass('is-danger')
  })

  it('shows placeholders rather than zeroes when no budget has been set', async () => {
    renderPanel({ expenses: [expense(1, 'Licences', '80.00')], projectOverrides: { budget_amount: null } })

    await waitFor(() => expect(summaryValue('Spent')).toMatch(/80\.00$/))
    expect(summaryValue('Budget')).toBe('Not set')
    expect(summaryValue('Remaining')).toBe('n/a')
    expect(summaryValue('Used')).toBe('n/a')
  })
})

describe('ProjectCostBudgetPanel currency', () => {
  it('offers only the four supported currencies', async () => {
    renderPanel()
    await screen.findByRole('button', { name: /save budget/i })
    const select = within(budgetForm()).getByLabelText(/currency/i)
    expect([...select.options].map(option => option.value)).toEqual(['USD', 'GBP', 'NGN', 'KES'])
  })

  it('formats the summary in the project currency', async () => {
    renderPanel({ expenses: [expense(1, 'Venue', '500.00')], projectOverrides: { budget_currency: 'NGN' } })
    await waitFor(() => expect(summaryValue('Spent')).toContain('500.00'))
    expect(summaryValue('Spent')).not.toMatch(/US\$|^\$/)
  })
})

describe('ProjectCostBudgetPanel permissions', () => {
  it('hides the budget form from members who cannot manage the project', async () => {
    renderPanel({ canManage: false })
    expect(await screen.findByText(/only managers can set the budget target/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save budget/i })).not.toBeInTheDocument()
  })
})

describe('ProjectCostBudgetPanel saving', () => {
  it('patches the project with the chosen amount and currency', async () => {
    const { fetchMock, onProjectUpdated } = renderPanel()

    await screen.findByRole('button', { name: /save budget/i })
    const amount = within(budgetForm()).getByLabelText(/amount/i)
    await userEvent.clear(amount)
    await userEvent.type(amount, '2500')
    await userEvent.selectOptions(within(budgetForm()).getByLabelText(/currency/i), 'GBP')
    // happy-dom does not implicitly submit a form when its submit button is
    // clicked, so dispatch the submit the component actually listens for.
    fireEvent.submit(budgetForm())

    await waitFor(() => expect(onProjectUpdated).toHaveBeenCalled())
    const [, init] = expectRequest(fetchMock, '/api/workspaces/1/projects/4/', 'PATCH')
    expect(JSON.parse(init.body)).toEqual({ budget_amount: '2500', budget_currency: 'GBP' })
  })
})
