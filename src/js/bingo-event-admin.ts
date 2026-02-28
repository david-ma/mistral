/**
 * Edit event admin: fetch /api/bingo-event/:eventId/admin-data and render
 * view-all-cards and view-all-prompts. Used by edit-event.hbs.
 */
import * as d3 from 'd3'

interface AdminCell {
  prompt?: string
  imageUrl?: string | null
  description?: string | null
}

interface AdminCard {
  id: number
  createdAt: string | null
  filledCount: number
  cells: AdminCell[]
}

interface AdminData {
  eventId: number
  eventName: string
  gridSize: number
  prompts: string[]
  cards: AdminCard[]
}

function getEventId(): number | null {
  const el = document.getElementById('bingo-event-admin-root')
  const raw = el?.getAttribute('data-event-id')
  if (raw == null) return null
  const id = parseInt(raw, 10)
  return Number.isFinite(id) ? id : null
}

function drawCardsList(container: d3.Selection<HTMLDivElement, unknown, null, undefined>, cards: AdminCard[], totalCells: number): void {
  container.selectAll('*').remove()
  if (cards.length === 0) {
    container.append('p').attr('class', 'text-muted').text('No cards yet. Players join from the event page.')
    return
  }
  const ul = container.append('ul').attr('class', 'list-unstyled')
  ul.selectAll('li')
    .data(cards)
    .join('li')
    .append('a')
    .attr('href', (d) => `/bingo/${d.id}`)
    .attr('target', '_blank')
    .attr('rel', 'noopener')
    .text((d) => `Card #${d.id} — ${d.filledCount}/${totalCells} filled`)
}

function drawPromptsTable(container: d3.Selection<HTMLDivElement, unknown, null, undefined>, data: AdminData): void {
  container.selectAll('*').remove()
  const { prompts, cards, gridSize } = data
  const totalCells = gridSize * gridSize

  // For each prompt, collect submissions from all cards (cells where cell.prompt === prompt and has imageUrl)
  type PromptRow = { index: number; prompt: string; submissions: { cardId: number; imageUrl: string; description?: string | null }[] }
  const promptRows: PromptRow[] = prompts.map((prompt, index) => {
    const submissions: { cardId: number; imageUrl: string; description?: string | null }[] = []
    cards.forEach((card) => {
      card.cells.forEach((cell) => {
        if (cell.prompt === prompt && cell.imageUrl) {
          submissions.push({ cardId: card.id, imageUrl: cell.imageUrl, description: cell.description ?? null })
        }
      })
    })
    return { index: index + 1, prompt, submissions }
  })

  const table = container.append('table').attr('class', 'table table-sm').attr('id', 'prompts-table')
  const thead = table.append('thead').append('tr')
  thead.append('th').attr('scope', 'col').text('#')
  thead.append('th').attr('scope', 'col').text('Prompt')
  thead.append('th').attr('scope', 'col').text('Photos')
  thead.append('th').attr('scope', 'col').text('Match (TODO: use magic AI wand)')
  const tbody = table.append('tbody')

  tbody.selectAll('tr')
    .data(promptRows)
    .join('tr')
    .each(function (row) {
      const tr = d3.select(this)
      tr.append('td').text(row.index)
      tr.append('td').text(row.prompt)
      const photosCell = tr.append('td')
      if (row.submissions.length === 0) {
        photosCell.append('span').attr('class', 'text-muted').text('—')
      } else {
        row.submissions.forEach((sub) => {
          const block = photosCell.append('div').attr('class', 'mb-1')
          block.append('a').attr('href', `/bingo/${sub.cardId}`).attr('target', '_blank').attr('rel', 'noopener').append('img').attr('src', sub.imageUrl).attr('alt', '').attr('class', 'rounded').style('max-width', '48px').style('max-height', '48px').style('object-fit', 'cover')
          if (sub.description) {
            block.append('div').attr('class', 'small text-muted').style('max-width', '200px').text(sub.description.slice(0, 80) + (sub.description.length > 80 ? '…' : ''))
          }
        })
      }
      tr.append('td').attr('class', 'text-muted').text('—')
    })
}

function showError(container: d3.Selection<HTMLDivElement, unknown, null, undefined>, message: string): void {
  container.selectAll('*').remove()
  container.append('p').attr('class', 'text-danger').text(message)
}

function run(): void {
  const eventId = getEventId()
  const root = d3.select<HTMLDivElement, unknown>('#bingo-event-admin-root')
  const cardsSection = d3.select<HTMLDivElement, unknown>('#view-all-cards .admin-cards-list')
  const promptsSection = d3.select<HTMLDivElement, unknown>('#view-all-prompts .admin-prompts-table')
  if (root.empty() || cardsSection.empty() || promptsSection.empty()) return
  if (eventId == null) {
    showError(cardsSection, 'Missing event ID.')
    showError(promptsSection, 'Missing event ID.')
    return
  }

  cardsSection.text('Loading…')
  promptsSection.text('Loading…')
  fetch(`/api/bingo-event/${eventId}/admin-data`)
    .then((r) => {
      if (!r.ok) return r.json().then((body) => Promise.reject(new Error(body?.error ?? r.statusText)))
      return r.json() as Promise<AdminData>
    })
    .then((data) => {
      const totalCells = data.gridSize * data.gridSize
      drawCardsList(cardsSection, data.cards, totalCells)
      drawPromptsTable(promptsSection, data)
    })
    .catch((err) => {
      showError(cardsSection, err?.message ?? 'Failed to load admin data.')
      showError(promptsSection, err?.message ?? 'Failed to load admin data.')
    })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
}
