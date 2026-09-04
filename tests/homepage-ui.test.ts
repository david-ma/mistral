/**
 * Unit tests for homepage (index) UI: Unihack Photo Hunt branding and layout.
 * Renders index.hbs with Handlebars and asserts on content (Uncodixfy: no hero fluff, normal structure).
 * Run from project root: bun test tests/homepage-ui.test.ts
 */

import { describe, test, expect } from 'bun:test'
import Handlebars from 'handlebars'
import path from 'path'
import fs from 'fs'

const PROJECT_ROOT = path.join(import.meta.dirname, '..')
const INDEX_PATH = path.join(PROJECT_ROOT, 'src', 'index.hbs')

function loadTemplate(): string {
  const fullPath = path.resolve(INDEX_PATH)
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Template not found: ${fullPath}`)
  }
  return fs.readFileSync(fullPath, 'utf8')
}

function render(data: { joinUrl?: string; unihackUrl?: string }): string {
  const template = loadTemplate()
  const compile = Handlebars.compile(template)
  return compile({
    joinUrl: data.joinUrl ?? '/event/unihack/join',
    unihackUrl: data.unihackUrl ?? 'https://www.unihack.net/',
    ...data,
  })
}

describe('index.hbs (Unihack Photo Hunt homepage)', () => {
  test('template file exists', () => {
    expect(fs.existsSync(path.resolve(INDEX_PATH))).toBe(true)
  })

  test('renders Unihack Photo Hunt title and tagline', () => {
    const html = render({})
    expect(html).toContain('Unihack Photo Hunt')
    expect(html).toContain('3×3 grid')
    expect(html).not.toContain('Bingo')
  })

  test('includes Start a new card and Continue your card CTAs', () => {
    const html = render({})
    expect(html).toContain('Start a new card')
    expect(html).toContain('Continue your card')
    expect(html).toContain('uph-start')
    expect(html).toContain('uph-continue')
  })

  test('injects joinUrl into script for client navigation', () => {
    const joinUrl = '/event/unihack/join'
    const html = render({ joinUrl })
    expect(html).toContain(joinUrl)
    expect(html).toContain("JOIN_URL = '" + joinUrl + "'")
  })

  test('includes Unihack link with unihackUrl', () => {
    const unihackUrl = 'https://www.unihack.net/'
    const html = render({ unihackUrl })
    expect(html).toContain('unihack.net')
    expect(html).toContain(unihackUrl)
  })

  test('has How it works and Play at Unihack sections (normal sections, no eyebrow)', () => {
    const html = render({})
    expect(html).toContain('How it works')
    expect(html).toContain('Play at Unihack')
    expect(html).not.toContain('<small>')
  })

  test('uses bingo-landing and bingo-hero structure (layout only; no gradient in template)', () => {
    const html = render({})
    expect(html).toContain('bingo-landing')
    expect(html).toContain('bingo-hero')
    expect(html).toContain('bingo-section')
  })
})
