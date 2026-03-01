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
  const filledCount = state.cells.filter((c) => c.imageUrl || c.thumbnailUrl).length
  console.log('[bingo] draw: grid', state.gridSize, '×', state.gridSize, ', cells', state.cells.length, ', photos loaded', filledCount)
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

const LOADING_SVG = '/images/loading.svg'

let currentCellIndex: number | null = null
let uploadChangeAttached = false

function showCellLoading(
  root: d3.Selection<HTMLDivElement, unknown, null, undefined>,
  cellIndex: number,
): void {
  const cell = root.select<SVGGElement>(`g.bingo-cell[data-cell-index="${cellIndex}"]`)
  if (cell.empty()) return
  cell.classed('image-loading', true)
  const rect = cell.select('rect').node()
  if (rect) {
    const bbox = rect.getBBox()
    const size = Math.min(32, bbox.width * 0.4, bbox.height * 0.4)
    const cx = bbox.width / 2
    const cy = 28 + (bbox.height - 28 - 24) / 2
    const g = cell
      .append('g')
      .attr('class', 'bingo-cell-loading-wrap')
      .attr('transform', `translate(${cx},${cy})`)
    g.append('image')
      .attr('class', 'bingo-cell-loading-image')
      .attr('href', LOADING_SVG)
      .attr('x', -size / 2)
      .attr('y', -size / 2)
      .attr('width', size)
      .attr('height', size)
  }
}

function clearCellLoading(
  root: d3.Selection<HTMLDivElement, unknown, null, undefined>,
  cellIndex: number,
): void {
  const cell = root.select<SVGGElement>(`g.bingo-cell[data-cell-index="${cellIndex}"]`)
  if (cell.empty()) return
  cell.classed('image-loading', false)
  cell.selectAll('.bingo-cell-loading-wrap').remove()
}

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
      console.log('[bingo] cell clicked, opening file picker', { cellIndex: i, prompt: d.prompt })
      fileInput.click()
    })
  })

  if (uploadChangeAttached) return
  uploadChangeAttached = true
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file || currentCellIndex == null) return
    console.log('[bingo] photo selected from user', { cellIndex: currentCellIndex, name: file.name, size: file.size, type: file.type })
    const uploadFiles = (window as unknown as { uploadFilesToUploadThing?: (key: string, opts: { files: File[] }) => Promise<{ url: string }[]> }).uploadFilesToUploadThing
    if (!uploadFiles) {
      console.error('[bingo] UploadThing not available')
      alert('Upload not available. Check that UploadThing is loaded.')
      currentCellIndex = null
      return
    }
    const cellIndex = currentCellIndex
    showCellLoading(root, cellIndex)
    console.log('[bingo] uploading photo to UploadThing...')
    uploadFiles('smugmugImage', { files: [file] })
      .then((results) => {
        const fileResult = results?.[0]
        const url = fileResult?.ufsUrl ?? fileResult?.url
        if (!url) throw new Error('No URL returned from upload')
        console.log('[bingo] photo uploaded to UploadThing, got URL', url.slice(0, 60) + (url.length > 60 ? '...' : ''))
        console.log('[bingo] sending to Thalia /api/bingo-cell (photo will be described by Mistral)...')
        return fetch('/api/bingo-cell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId, cellIndex, imageUrl: url }),
        }).then((r) => r.json())
      })
      .then((data) => {
        if (data?.error) throw new Error(data.error)
        console.log('[bingo] bingo-cell response ok, photo described; refreshing card state')
        run()
      })
      .catch((err) => {
        console.error('[bingo] upload or describe failed', err?.message ?? err)
        clearCellLoading(root, cellIndex)
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
    console.error('[bingo] missing card ID')
    showError(root, 'Missing card ID.')
    return
  }

  console.log('[bingo] loading card', cardId)
  showLoading(root)
  fetch(`/api/bingo-game/${cardId}`)
    .then((r) => {
      if (!r.ok) return r.json().then((body) => Promise.reject(new Error(body?.error ?? r.statusText)))
      return r.json() as Promise<GameState>
    })
    .then((state) => {
      console.log('[bingo] JSON payload received from Thalia', { cardId: state.cardId, eventName: state.eventName, gridSize: state.gridSize, cellsCount: state.cells?.length })
      root.selectAll('*').remove()
      draw(root, state)
      updateTitle(state.eventName)
      attachUpload(root, state.cardId)
      console.log('[bingo] card ready, click a cell to add a photo')
    })
    .catch((err) => {
      console.error('[bingo] failed to load card', err?.message ?? err)
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
