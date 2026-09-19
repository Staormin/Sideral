import { writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const url = process.env.BENCHMARK_URL ?? 'http://localhost:4173/star/'
const output = process.env.BENCHMARK_OUTPUT
const cpuRate = Number(process.env.BENCHMARK_CPU_RATE ?? 4)
const frameCount = Number(process.env.BENCHMARK_FRAMES ?? 120)
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  headless: true,
})

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.setDefaultTimeout(30_000)
  page.on('console', (message) => {
    if (message.text().startsWith('[benchmark]')) process.stderr.write(`${message.text()}\n`)
  })
  let catalogueResponse = null
  page.on('response', (response) => {
    if (response.ok() && /\/data\/stars\.json(?:\.gz)?$/.test(new URL(response.url()).pathname))
      catalogueResponse = response
  })
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  await page.addInitScript(() => {
    // Instrument only application callbacks. The input driver and frame clock
    // use the original RAF, so their work cannot inflate callback CPU timings.
    const nativeRaf = window.requestAnimationFrame.bind(window)
    const measurement = {
      active: false,
      callbacks: [],
      longTasks: [],
      pointerId: null,
      nativeRaf,
    }
    window.__mapBenchmark = measurement
    window.requestAnimationFrame = (callback) =>
      nativeRaf((timestamp) => {
        const start = performance.now()
        try {
          callback(timestamp)
        } finally {
          if (measurement.active) {
            measurement.callbacks.push({
              name: callback.name || '(anonymous)',
              duration: performance.now() - start,
            })
          }
        }
      })
    new PerformanceObserver((list) => {
      if (measurement.active) {
        measurement.longTasks.push(...list.getEntries().map((entry) => entry.duration))
      }
    }).observe({ type: 'longtask' })
  })

  await page.goto(url)
  process.stderr.write('[benchmark] Page loaded\n')
  const search = page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
  await search.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => {
    const input = document.querySelector(
      'input[aria-label="Rechercher une étoile ou une constellation"]',
    )
    return input instanceof HTMLInputElement && !input.disabled
  })
  if (!catalogueResponse) throw new Error('No successful catalogue response was observed')
  const catalogueBody = await catalogueResponse.body()
  const catalogue = JSON.parse(
    (catalogueBody[0] === 0x1f && catalogueBody[1] === 0x8b
      ? gunzipSync(catalogueBody)
      : catalogueBody
    ).toString('utf8'),
  )
  if (
    !Array.isArray(catalogue.rows) ||
    catalogue.rows.length !== 119625 ||
    catalogue.metadata?.count !== catalogue.rows.length
  )
    throw new Error('The benchmark requires a catalogue of exactly 119625 stars')
  const catalogueCount = catalogue.rows.length
  process.stderr.write(`[benchmark] Catalogue loaded: ${catalogueCount} stars\n`)
  const canvas = page.locator('canvas').first()
  await canvas.focus()
  for (let index = 0; index < 10; index += 1) await canvas.press('-')
  process.stderr.write('[benchmark] Maximum zoom-out requested with 10 minus key presses\n')
  await page.evaluate(() => document.fonts.ready)

  const scenarios = []
  for (const interaction of ['pan', 'hover']) {
    if (interaction === 'pan') {
      const bounds = await canvas.boundingBox()
      if (!bounds) throw new Error('Map has no visible bounds')
      await canvas.evaluate((element) => {
        element.addEventListener(
          'pointerdown',
          (event) => {
            window.__mapBenchmark.pointerId = event.pointerId
          },
          { once: true },
        )
      })
      // A native press activates pointer capture before synchronous input sampling.
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
    }
    try {
      scenarios.push(
        await page.evaluate(
          async ({ interaction, frameCount, catalogueCount }) => {
            const measurement = window.__mapBenchmark
            const canvas = document.querySelector('canvas')
            const bounds = canvas.getBoundingClientRect()
            let panX = bounds.x + bounds.width / 2
            let panDirection = -1
            if (interaction === 'pan' && !canvas.hasPointerCapture(measurement.pointerId))
              throw new Error('Map did not capture the drag pointer')
            const driveInput = (index) => {
              if (interaction === 'pan') {
                const nextX = panX + panDirection * 12
                if (
                  nextX < bounds.x + bounds.width * 0.15 ||
                  nextX > bounds.x + bounds.width * 0.85
                )
                  panDirection *= -1
                panX += panDirection * 12
                canvas.dispatchEvent(
                  new PointerEvent('pointermove', {
                    pointerId: measurement.pointerId,
                    pointerType: 'mouse',
                    isPrimary: true,
                    button: -1,
                    buttons: 1,
                    clientX: panX,
                    clientY: bounds.y + bounds.height / 2,
                    bubbles: true,
                    cancelable: true,
                  }),
                )
              } else {
                canvas.dispatchEvent(
                  new PointerEvent('pointermove', {
                    pointerId: 1,
                    pointerType: 'mouse',
                    clientX: bounds.x + bounds.width * (0.15 + ((index % 90) / 90) * 0.7),
                    clientY: bounds.y + bounds.height * 0.5 + Math.sin(index / 12) * 90,
                    bubbles: true,
                  }),
                )
              }
            }
            const nextFrame = () => new Promise((resolve) => measurement.nativeRaf(resolve))
            // Warm raster caches and JIT at the measured zoom before collecting.
            for (let index = 0; index < 30; index += 1) {
              await nextFrame()
              driveInput(index)
            }
            console.info(`[benchmark] ${interaction}: warm-up complete`)
            await nextFrame()
            measurement.callbacks = []
            measurement.longTasks = []
            measurement.active = true
            const frameGaps = []
            const inputDurations = []
            let previous = await nextFrame()
            for (let index = 0; index < frameCount; index += 1) {
              const start = performance.now()
              driveInput(index)
              inputDurations.push(performance.now() - start)
              const timestamp = await nextFrame()
              frameGaps.push(timestamp - previous)
              previous = timestamp
              if ((index + 1) % 30 === 0)
                console.info(`[benchmark] ${interaction}: ${index + 1} frames`)
            }
            // Give buffered long-task notifications a turn to arrive.
            await new Promise((resolve) => setTimeout(resolve, 0))
            measurement.active = false
            const summarize = (values) => {
              const sorted = [...values].sort((a, b) => a - b)
              const percentile = (value) => sorted[Math.ceil(sorted.length * value) - 1] ?? 0
              const round = (value) => Math.round(value * 100) / 100
              return {
                samples: values.length,
                medianMs: round(percentile(0.5)),
                p95Ms: round(percentile(0.95)),
                maxMs: round(sorted.at(-1) ?? 0),
                over33ms: values.filter((duration) => duration > 33.34).length,
                over50ms: values.filter((duration) => duration > 50).length,
              }
            }
            const callbacks = new Map()
            for (const callback of measurement.callbacks) {
              if (!callbacks.has(callback.name)) callbacks.set(callback.name, [])
              callbacks.get(callback.name).push(callback.duration)
            }
            return {
              interaction,
              catalogueCount,
              frameGaps: summarize(frameGaps),
              inputHandlers: summarize(inputDurations),
              applicationRaf: summarize(measurement.callbacks.map((entry) => entry.duration)),
              callbacksByName: Object.fromEntries(
                [...callbacks].map(([name, durations]) => [name, summarize(durations)]),
              ),
              longTasks: summarize(measurement.longTasks),
            }
          },
          { interaction, frameCount, catalogueCount },
        ),
      )
    } finally {
      if (interaction === 'pan') await page.mouse.up()
    }
    process.stderr.write(`[benchmark] ${JSON.stringify(scenarios.at(-1))}\n`)
  }

  const result = {
    date: new Date().toISOString(),
    url,
    browser: await browser.version(),
    viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    cpuRate,
    framesPerScenario: frameCount,
    note: 'catalogueCount is verified from the catalogue response and is not a visible-star count. Pan uses a native mouse press/release with synthetic pointer moves of 12 px per frame, reversing within the canvas. Hover uses synthetic pointer moves. Inputs follow public DOM handlers. Headless frame gaps include rasterization and scheduling; RAF timings measure application callback CPU only.',
    scenarios,
  }
  const json = `${JSON.stringify(result, null, 2)}\n`
  if (output) await writeFile(output, json)
  process.stdout.write(json)
} finally {
  await browser.close()
}
