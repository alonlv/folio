import express from 'express'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const app = express()
const run = promisify(execFile)
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const maxUpload = 60 * 1024 * 1024
const maxScan = 20 * 1024 * 1024
const maxScanPages = 12
const strengths = { light: '/printer', balanced: '/ebook', strong: '/screen' }
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
let occupied = 0

app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' blob: data:; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  })
  next()
})

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

function reserve(req, res, next) {
  if (req.get('sec-fetch-site') === 'cross-site') {
    res.status(403).json({ error: 'Open Folio directly to use this tool.' })
    return
  }
  if (occupied >= 2) {
    res.status(503).json({ error: 'The conversion tools are busy. Try again in a moment.' })
    return
  }
  occupied++
  let released = false
  const release = () => {
    if (!released) {
      occupied--
      released = true
    }
  }
  res.locals.releaseSlot = release
  res.on('close', () => {
    if (!res.locals.processing) release()
  })
  res.set('Cache-Control', 'no-store')
  next()
}

const upload = limit => express.raw({ type: () => true, limit, inflate: false })
const readUpload = upload(maxUpload)

class ConversionError extends Error {}

function processFile(extension, mime, signature, convert, {
  responseType = 'application/pdf',
  missingTool,
} = {}) {
  return async (req, res) => {
    res.locals.processing = true
    let folder
    try {
      if (req.get('content-type') !== mime || !Buffer.isBuffer(req.body) ||
          !req.body.subarray(0, signature.length).equals(signature)) {
        res.status(400).json({ error: 'Choose a valid ' + extension.toUpperCase() + ' file.' })
        return
      }
      folder = await mkdtemp(join(tmpdir(), 'folio-'))
      const input = join(folder, 'input.' + extension)
      const output = join(folder, 'output.pdf')
      await writeFile(input, req.body, { mode: 0o600 })
      const result = await convert(req, folder, input, output)
      const { size } = await stat(result)
      if (size === 0 || size > maxUpload * 2) {
        res.status(422).json({ error: 'The tool could not produce a PDF within the output size limit.' })
        return
      }
      await new Promise((resolve, reject) => {
        res.type(responseType).sendFile(result, error => error ? reject(error) : resolve())
      })
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        res.end()
        return
      }
      const missing = error.code === 'ENOENT' && error.syscall?.startsWith('spawn')
      const message = missing
        ? missingTool ?? 'This tool needs ' + (extension === 'pdf' ? 'Ghostscript' : 'LibreOffice Writer') + '. Both are included in the Docker image.'
        : error instanceof ConversionError ? error.message : 'This file could not be processed. It may be protected, damaged, or too complex.'
      res.status(missing ? 503 : 422).json({ error: message })
    } finally {
      try {
        if (folder) await rm(folder, { recursive: true, force: true })
      } finally {
        res.locals.processing = false
        res.locals.releaseSlot()
      }
    }
  }
}

app.post('/api/compress', reserve, readUpload, processFile(
  'pdf', 'application/pdf', Buffer.from('%PDF-'),
  async (req, folder, input, output) => {
    const preset = Object.hasOwn(strengths, req.query.level) ? strengths[req.query.level] : strengths.balanced
    await run('gs', [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pdfwrite',
      '-dAutoRotatePages=/None', '-dPDFSETTINGS=' + preset, '-sOutputFile=' + output, input,
    ], { cwd: folder, timeout: 50_000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' })
    return (await stat(output)).size < req.body.length ? output : input
  },
))

app.post('/api/word-to-pdf', reserve, readUpload, processFile(
  'docx', docxMime, Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  async (_req, folder, input) => {
    const profile = join(folder, 'profile')
    await mkdir(join(profile, 'user'), { recursive: true })
    await writeFile(join(profile, 'user', 'registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
  <item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`)
    await run('soffice', [
      '-env:UserInstallation=' + pathToFileURL(profile).href, '--headless',
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', folder, input,
    ], { cwd: folder, timeout: 50_000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' })
    return join(folder, 'input.pdf')
  },
))

app.post('/api/ocr', reserve, upload(maxScan), processFile(
  'pdf', 'application/pdf', Buffer.from('%PDF-'),
  async (req, folder, input) => {
    const language = req.query.language === 'he' ? 'heb' : req.query.language === 'en' ? 'eng' : 'heb+eng'
    const deadline = Date.now() + 65_000
    const scanCommand = async (program, args, maxTime) => {
      const timeout = Math.min(maxTime, deadline - Date.now())
      if (timeout <= 0) throw new ConversionError('OCR took too long. Try a smaller batch of pages.')
      try {
        return await run(program, args, {
          cwd: folder, timeout, maxBuffer: 512 * 1024, killSignal: 'SIGKILL',
          env: { ...process.env, LC_ALL: 'C', OMP_THREAD_LIMIT: '2' },
        })
      } catch (error) {
        if (error.killed) throw new ConversionError('OCR took too long. Try a smaller batch of pages.')
        throw error
      }
    }

    const info = await scanCommand('pdfinfo', [input], 8_000)
    const count = Number(/^Pages:\s+(\d+)/m.exec(info.stdout)?.[1])
    if (!count || count > maxScanPages) throw new ConversionError('OCR supports PDFs up to 12 pages and 20 MB.')
    const text = []
    const image = join(folder, 'page')
    for (let index = 1; index <= count; index++) {
      const number = String(index)
      await scanCommand('pdftoppm', [
        '-f', number, '-l', number, '-r', '230', '-scale-to', '2700',
        '-gray', '-png', '-singlefile', input, image,
      ], 12_000)
      const result = await scanCommand('tesseract', [image + '.png', 'stdout', '-l', language], 16_000)
      const lines = result.stdout.replace(/\f/g, '').trim()
      if (lines) text.push(lines)
      await rm(image + '.png', { force: true })
    }
    if (!text.length) throw new ConversionError('No text was recognized. Try a sharper scan or a different language.')
    const output = join(folder, 'output.txt')
    await writeFile(output, text.join('\n\n'), { mode: 0o600 })
    return output
  },
  {
    responseType: 'text/plain; charset=utf-8',
    missingTool: 'OCR needs Poppler and Tesseract with Hebrew and English data. They are included in Docker.',
  },
))

app.use('/api', (_req, res) => res.status(404).json({ error: 'Tool not found.' }))
app.use(express.static(dist, { index: 'index.html' }))
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  const tooLarge = error.type === 'entity.too.large'
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge
      ? error.limit === maxScan ? 'OCR supports PDFs up to 12 pages and 20 MB.' : 'This tool supports files up to 60 MB.'
      : 'The uploaded file could not be read.',
  })
})

const port = Number(process.env.PORT || 3080)
const host = process.env.HOST || '127.0.0.1'
app.listen(port, host, () => console.log(`Folio is listening on http://${host}:${port}`))
