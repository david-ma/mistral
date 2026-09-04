/**
 * Unit tests for Unihack Photo Hunt: buildPhotoHuntCells and related.
 * Run from project root: bun test tests/photohunt.test.ts
 */

import { describe, test, expect } from 'bun:test'
import { buildPhotoHuntCells } from '../config/config.js'

describe('buildPhotoHuntCells', () => {
  const prompts3 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
  const prompts25 = Array.from({ length: 30 }, (_, i) => `P${i}`)

  test('returns 9 cells for gridSize 3', () => {
    const cells = buildPhotoHuntCells(prompts3, 3)
    expect(cells).toHaveLength(9)
  })

  test('returns 25 cells for gridSize 5', () => {
    const cells = buildPhotoHuntCells(prompts25, 5)
    expect(cells).toHaveLength(25)
  })

  test('each cell has prompt, imageUrl null, description null, isFreeSpace false', () => {
    const cells = buildPhotoHuntCells(prompts3, 3)
    cells.forEach((cell) => {
      expect(cell).toHaveProperty('prompt')
      expect(typeof cell.prompt).toBe('string')
      expect(cell.imageUrl).toBeNull()
      expect(cell.description).toBeNull()
      expect(cell.isFreeSpace).toBe(false)
    })
  })

  test('cells are drawn from the given prompts (no duplicates when prompts >= total)', () => {
    const cells = buildPhotoHuntCells(prompts3, 3)
    const prompts = cells.map((c) => c.prompt)
    const unique = new Set(prompts)
    expect(unique.size).toBe(9)
    prompts.forEach((p) => expect(prompts3).toContain(p))
  })

  test('when prompts are fewer than total, returns that many cells (no padding)', () => {
    const few = ['X', 'Y', 'Z']
    const cells = buildPhotoHuntCells(few, 3)
    expect(cells).toHaveLength(3)
    cells.forEach((c) => expect(['X', 'Y', 'Z']).toContain(c.prompt))
  })
})
