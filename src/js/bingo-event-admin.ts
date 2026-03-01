/**
 * Edit event admin: fetch /api/bingo-event/:eventId/admin-data and render
 * view-all-cards and view-all-prompts. Used by edit-event.hbs.
 */
import * as d3 from 'd3'

interface AdminCell {
  prompt?: string
  imageUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
}

interface AdminCard {
  id: number
  createdAt: string | null
  filledCount: number
  cells: AdminCell[]
  totalScore: number
  note: string
  approved: boolean
  owner?: { name: string; email: string } | null
}

interface AdminData {
  eventId: number
  eventName: string
  gridSize: number
  prompts: string[]
  promptScores?: number[]
  cards: AdminCard[]
  approvedCardIds?: number[]
}

function getEventId(): number | null {
  const el = document.getElementById('bingo-event-admin-root')
  const raw = el?.getAttribute('data-event-id')
  if (raw == null) return null
  const id = parseInt(raw, 10)
  return Number.isFinite(id) ? id : null
}

// Demo only: remove fake_data() and fake_name() when replacing with real scores/owners.
const FAKE_NAMES = [
  'Leonardo',
  'Michaelangelo',
  'Donatello',
  'Raphael',
  'John',
  'George',
  'Ringo',
  'Paul',
  'Alice',
  'Bob',
  'Charlie',
  'Diana',
]

function fake_name(): string {
  return FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)]
}

function fake_data(data: AdminData): AdminData {
  const promptScores = data.prompts.map(() => Math.floor(Math.random() * 10) + 1)
  const notes = ['high quality', 'flagged for inappropriate content', 'high quality', 'high quality']
  const cards = data.cards.map((card) => ({
    ...card,
    totalScore: Math.floor(Math.random() * 100) + 1,
    note: notes[Math.floor(Math.random() * notes.length)],
    owner: card.owner && (card.owner.name || card.owner.email) ? card.owner : { name: fake_name(), email: '' },
  }))
  return { ...data, promptScores, cards }
}

const PREVIEW_CELL_SIZE = 32

function drawCardPreview(
  parent: d3.Selection<HTMLDivElement, AdminCard, HTMLTableRowElement, AdminData>,
  card: AdminCard,
  gridSize: number
): void {
  const wrap = parent.append('div').attr('class', 'admin-card-preview')
  const n = gridSize
  const size = n * PREVIEW_CELL_SIZE
  wrap.style('width', `${size}px`).style('height', `${size}px`).style('display', 'grid')
    .style('grid-template-columns', `repeat(${n}, 1fr)`).style('grid-template-rows', `repeat(${n}, 1fr)`)
    .style('gap', '1px').style('background', '#475569').style('border-radius', '4px').style('overflow', 'hidden')
  wrap.selectAll('div').data(card.cells).join('div').attr('class', 'admin-card-preview__cell')
    .style('background', (d) => (d.prompt === 'Free space' ? 'rgba(148,163,184,0.3)' : d.imageUrl ? 'rgba(34,197,94,0.2)' : '#334155'))
    .style('min-width', 0).style('min-height', 0)
    .each(function (d) {
      const cell = d3.select(this)
      if (d.imageUrl || d.thumbnailUrl) {
        cell.append('img').attr('src', d.thumbnailUrl ?? d.imageUrl ?? '').attr('alt', '')
          .style('width', '100%').style('height', '100%').style('object-fit', 'cover').style('display', 'block')
      } else {
        cell.append('span').style('font-size', '8px').style('overflow', 'hidden').style('text-overflow', 'ellipsis').style('white-space', 'nowrap').style('display', 'block').style('padding', '2px')
          .text((d) => (d.prompt === 'Free space' ? '★' : (d.prompt ?? '').slice(0, 8)))
      }
    })
}

function drawCardsList(
  container: d3.Selection<HTMLDivElement, unknown, null, undefined>,
  cards: AdminCard[],
  data: AdminData
): void {
  container.selectAll('*').remove()
  if (cards.length === 0) {
    container.append('p').attr('class', 'text-muted').text('No cards yet. Players join from the event page.')
    return
  }
  const table = container.append('table').attr('class', 'table table-sm table-bordered').attr('id', 'admin-cards-table')
  const thead = table.append('thead').append('tr')
  thead.append('th').attr('scope', 'col').text('Preview')
  thead.append('th').attr('scope', 'col').text('Owner')
  thead.append('th').attr('scope', 'col').text('Total score')
  thead.append('th').attr('scope', 'col').text('Notes')
  thead.append('th').attr('scope', 'col').text('Public')
  const tbody = table.append('tbody')
  const rows = tbody.selectAll('tr').data(cards).join('tr')
  rows.append('td').attr('class', 'admin-cards-preview-cell').each(function (card) {
    drawCardPreview(d3.select(this), card, data.gridSize)
  })
  rows.append('td').each(function (d) {
    const td = d3.select(this)
    if (d.owner && (d.owner.name || d.owner.email)) {
      td.append('span').style('display', 'block').text(d.owner.name)
      if (d.owner.email) td.append('span').attr('class', 'small text-muted').style('display', 'block').text(d.owner.email)
    } else {
      td.append('span').attr('class', 'text-muted').text('—')
    }
  })
  rows.append('td').text((d) => String(d.totalScore))
  rows.append('td').text((d) => d.note)
  const toggleCell = rows.append('td').attr('class', 'admin-cards-approve-cell')
  toggleCell.each(function (card) {
    const td = d3.select(this)
    const btn = td.append('button').attr('type', 'button').attr('class', 'btn btn-sm admin-approve-toggle')
      .attr('data-card-id', String(card.id)).attr('aria-pressed', card.approved ? 'true' : 'false')
    btn.text(card.approved ? 'Approved' : 'Approve')
    if (card.approved) btn.classed('btn-success', true)
    else btn.classed('btn-outline-secondary', true)
    btn.on('click', function () {
      const nextApproved = !card.approved
      const currentIds = data.approvedCardIds ?? []
      const nextIds = nextApproved ? [...currentIds, card.id] : currentIds.filter((id) => id !== card.id)
      fetch(`/api/bingo-event/${data.eventId}/approve-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: nextIds }),
      })
        .then((r) => r.json())
        .then((body) => {
          if (body?.error) throw new Error(body.error)
          card.approved = nextApproved
          data.approvedCardIds = body.approvedCardIds ?? nextIds
          btn.attr('aria-pressed', nextApproved ? 'true' : 'false').text(nextApproved ? 'Approved' : 'Approve')
            .classed('btn-success', nextApproved).classed('btn-outline-secondary', !nextApproved)
        })
        .catch((err) => alert(err?.message ?? 'Failed to update'))
    })
  })
}


function drawPromptsTable(container: d3.Selection<HTMLDivElement, unknown, null, undefined>, data: AdminData): void {
  container.selectAll('*').remove()
  const { prompts, cards, gridSize } = data
  const totalCells = gridSize * gridSize

  // For each prompt, collect submissions from all cards (cells where cell.prompt === prompt and has imageUrl)
  type PromptRow = { index: number; prompt: string; score: number; submissions: { cardId: number; imageUrl: string; thumbnailUrl?: string | null; description?: string | null }[] }
  const promptScores = data.promptScores ?? prompts.map(() => Math.floor(Math.random() * 10) + 1)
  const promptRows: PromptRow[] = prompts.map((prompt, index) => {
    const submissions: { cardId: number; imageUrl: string; thumbnailUrl?: string | null; description?: string | null }[] = []
    cards.forEach((card) => {
      card.cells.forEach((cell) => {
        if (cell.prompt === prompt && cell.imageUrl) {
          submissions.push({ cardId: card.id, imageUrl: cell.imageUrl, thumbnailUrl: cell.thumbnailUrl ?? null, description: cell.description ?? null })
        }
      })
    })
    return { index: index + 1, prompt, score: promptScores[index] ?? 0, submissions }
  })

  const table = container.append('table').attr('class', 'table table-sm').attr('id', 'prompts-table')
  const thead = table.append('thead').append('tr')
  thead.append('th').attr('scope', 'col').text('#')
  thead.append('th').attr('scope', 'col').text('Prompt')
  thead.append('th').attr('scope', 'col').text('Photos')
  thead.append('th').attr('scope', 'col').text('Scores')
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
          block.append('a').attr('href', `/bingo/${sub.cardId}`).attr('target', '_blank').attr('rel', 'noopener').append('img').attr('src', sub.thumbnailUrl ?? sub.imageUrl).attr('alt', '').attr('class', 'rounded').style('max-width', '48px').style('max-height', '48px').style('object-fit', 'cover')
          if (sub.description) {
            block.append('div').attr('class', 'small text-muted').style('max-width', '200px').text(sub.description.slice(0, 80) + (sub.description.length > 80 ? '…' : ''))
          }
        })
      }
      tr.append('td').text(String(row.score))
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
      const demoData = fake_data(data)
      drawCardsList(cardsSection, demoData.cards, demoData)
      drawPromptsTable(promptsSection, demoData)
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
