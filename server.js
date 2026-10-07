import cds from '@sap/cds'
import { parseMultipart } from './srv/utils/multipart.js'

const MAX_BODY_BYTES = 20 * 1024 * 1024
const IMPORT_PATH_RE = /\/importCSV\/?$/

const respond = (res, status, body) => {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const interceptorError = (code, message, entity) => ({
  success: false,
  code,
  message,
  entity: String(entity ?? '').trim(),
  fileName: '',
  totalRows: 0,
  insertedRows: 0,
  failedRows: 1,
  errors: [{ row: 0, field: '', value: '', code, message }],
})

const csvInterceptor = (req, res, next) => {
  if (req.method !== 'POST' || !IMPORT_PATH_RE.test(req.path)) return next()
  const contentType = req.headers['content-type'] || ''
  if (!/^multipart\/form-data/i.test(contentType)) return next()

  const entityHint = String(req.query?.entity ?? '').replace(/^['"]+|['"]+$/g, '')
  let size = 0
  let capped = false
  const chunks = []

  const finish = () => {
    if (capped) {
      return respond(
        res,
        413,
        interceptorError(
          'FILE_TOO_LARGE',
          `The uploaded content exceeds the maximum size of ${MAX_BODY_BYTES} bytes.`,
          entityHint,
        ),
      )
    }
    const parsed = parseMultipart(Buffer.concat(chunks), contentType)
    if (parsed.error) {
      return respond(res, 200, interceptorError('MALFORMED_MULTIPART', parsed.error, entityHint))
    }
    req.csvUpload = { fields: parsed.fields, file: parsed.file }
    req.headers['content-type'] = 'application/json'
    req.headers['content-length'] = '0'
    if (typeof req.body !== 'object' || req.body === null) req.body = {}
    next()
  }

  req.on('data', chunk => {
    if (capped) return
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      capped = true
      chunks.length = 0
      return
    }
    chunks.push(chunk)
  })
  req.on('end', finish)
  req.on('error', () => {})
}

cds.on('bootstrap', app => app.use(csvInterceptor))

export default async function (options) {
  return cds.server(options)
}
