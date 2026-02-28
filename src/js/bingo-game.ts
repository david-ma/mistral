/**
 * Bingo card client: fetch game state from /api/bingo-game/:cardId and draw the grid with D3.
 * Expects a root element #bingo-card-root with data-card-id.
 */
import * as d3 from 'd3'

const MARGIN = { top: 20, right: 20, bottom: 20, left: 20 }
const CELL_PADDING = 8

interface BingoCell {
  prompt: string
  imageUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  isFreeSpace?: boolean
}

interface GameState {
  cardId: number
  eventName: string
  gridSize: number
  cells: BingoCell[]
}

function getCardId(): number | null {
  const root = document.getElementById('bingo-card-root')
  const raw = root?.getAttribute('data-card-id')
  if (raw == null) return null
  const id = parseInt(raw, 10)
  return Number.isFinite(id) ? id : null
}

function draw(
  container: d3.Selection<HTMLDivElement, unknown, null, undefined>,
  state: GameState,
): void {
  const width = Math.min(600, container.node()?.clientWidth ?? 600)
  const height = width
  const innerWidth = width - MARGIN.left - MARGIN.right
  const innerHeight = height - MARGIN.top - MARGIN.bottom
  const n = state.gridSize
  const cellW = innerWidth / n
  const cellH = innerHeight / n

  container.selectAll('*').remove()
  const wrapper = container
    .append('div')
    .attr('class', 'bingo-svg-wrapper')
    .style('aspect-ratio', '1')
    .style('width', '100%')
    .style('max-width', `${width}px`)
    .style('background', 'rgba(0,0,0,0.02)')
  const svg = wrapper
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%')

  const plot = svg
    .append('g')
    .attr('class', 'plot')
    .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

  const cell = plot
    .selectAll<SVGGElement, BingoCell>('g.cell')
    .data(state.cells)
    .join('g')
    .attr('class', (d) =>
      ['bingo-cell', d.isFreeSpace ? 'bingo-free-space' : '', d.imageUrl ? 'filled' : ''].filter(Boolean).join(' '),
    )
    .attr('transform', (_, i) => {
      const col = i % n
      const row = Math.floor(i / n)
      return `translate(${col * cellW},${row * cellH})`
    })
    .attr('data-cell-index', (_, i) => i)
    .attr('data-free-space', (d) => (d.isFreeSpace ? '1' : '0'))

  cell
    .append('rect')
    .attr('width', cellW - 2)
    .attr('height', cellH - 2)
    .attr('x', 1)
    .attr('y', 1)
    .attr('rx', 6)
    .attr('fill', (d) => (d.isFreeSpace ? '#e0e0e0' : d.imageUrl ? '#e8f5e9' : '#fafafa'))
    .attr('stroke', '#ccc')
    .attr('stroke-width', 2)

  cell
    .append('text')
    .attr('class', 'cell-prompt')
    .attr('x', cellW / 2)
    .attr('y', CELL_PADDING + 14)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'hanging')
    .style('font-size', '12px')
    .style('font-weight', '600')
    .style('pointer-events', 'none')
    .text((d) => d.prompt)

  cell
    .filter((d) => d.imageUrl || d.thumbnailUrl)
    .append('image')
    .attr('class', 'cell-image')
    .attr('href', (d) => (d.thumbnailUrl ?? d.imageUrl)!)
    .attr('x', CELL_PADDING)
    .attr('y', 28)
    .attr('width', cellW - CELL_PADDING * 2)
    .attr('height', cellH - 28 - CELL_PADDING - 24)
    .attr('preserveAspectRatio', 'xMidYMid meet')

  cell
    .filter((d) => d.imageUrl && d.description)
    .append('text')
    .attr('class', 'cell-desc')
    .attr('x', cellW / 2)
    .attr('y', cellH - CELL_PADDING - 12)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'auto')
    .style('font-size', '10px')
    .style('fill', '#666')
    .style('pointer-events', 'none')
    .each(function (d) {
      const text = d3.select(this)
      const str = (d.description ?? '').slice(0, 60)
      if (str.length < (d.description ?? '').length) text.text(str + '…')
      else text.text(str)
    })

  cell
    .filter((d) => !d.imageUrl && !d.isFreeSpace)
    .append('text')
    .attr('class', 'cell-hint')
    .attr('x', cellW / 2)
    .attr('y', cellH / 2 + 6)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .style('font-size', '10px')
    .style('fill', '#999')
    .text('Tap to add photo')
}

function showLoading(container: d3.Selection<HTMLDivElement, unknown, null, undefined>): void {
  container.selectAll('*').remove()
  const wrap = container.append('div').attr('class', 'bingo-loading')
  wrap.append('div').attr('class', 'bingo-loading__spinner')
  wrap.append('p').attr('class', 'bingo-loading__text').text('Loading your card…')
}

function showError(container: d3.Selection<HTMLDivElement, unknown, null, undefined>, message: string): void {
  container.selectAll('*').remove()
  container
    .append('p')
    .attr('class', 'text-muted')
    .style('padding', '1rem')
    .text(message)
}

function updateTitle(eventName: string): void {
  const el = document.getElementById('bingoTitle')
  if (el) el.textContent = eventName ? `Bingo: ${eventName}` : 'Bingo'
}

let currentCellIndex: number | null = null
let uploadChangeAttached = false

function attachUpload(
  root: d3.Selection<HTMLDivElement, unknown, null, undefined>,
  cardId: number,
): void {
  const fileInput = document.getElementById('bingoFileInput') as HTMLInputElement | null
  if (!fileInput) return

  root.selectAll<SVGGElement, BingoCell>('g.bingo-cell').each(function (d, i) {
    if (d.isFreeSpace) return
    const g = d3.select(this)
    g.on('click', () => {
      currentCellIndex = i
      fileInput.click()
    })
  })

  if (uploadChangeAttached) return
  uploadChangeAttached = true
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file || currentCellIndex == null) return
    const uploadFiles = (window as unknown as { uploadFilesToUploadThing?: (key: string, opts: { files: File[] }) => Promise<{ url: string }[]> }).uploadFilesToUploadThing
    if (!uploadFiles) {
      alert('Upload not available. Check that UploadThing is loaded.')
      currentCellIndex = null
      return
    }
    uploadFiles('smugmugImage', { files: [file] })
      .then((results) => {
        const fileResult = results?.[0]
        const url = fileResult?.ufsUrl ?? fileResult?.url
        if (!url) throw new Error('No URL returned from upload')
        return fetch('/api/bingo-cell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId, cellIndex: currentCellIndex, imageUrl: url }),
        }).then((r) => r.json())
      })
      .then((data) => {
        if (data?.error) throw new Error(data.error)
        run()
      })
      .catch((err) => {
        alert(err?.message ?? 'Upload failed')
      })
      .finally(() => {
        currentCellIndex = null
      })
  })
}

function run(): void {
  const cardId = getCardId()
  const root = d3.select<HTMLDivElement, unknown>('#bingo-card-root')
  if (root.empty()) return
  if (cardId == null) {
    showError(root, 'Missing card ID.')
    return
  }

  showLoading(root)
  fetch(`/api/bingo-game/${cardId}`)
    .then((r) => {
      if (!r.ok) return r.json().then((body) => Promise.reject(new Error(body?.error ?? r.statusText)))
      return r.json() as Promise<GameState>
    })
    .then((state) => {
      root.selectAll('*').remove()
      draw(root, state)
      updateTitle(state.eventName)
      attachUpload(root, state.cardId)
    })
    .catch((err) => {
      showError(root, err?.message ?? 'Failed to load card.')
    })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
}
