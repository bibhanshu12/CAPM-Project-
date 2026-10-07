const boundaryOf = contentType => {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '')
  if (!m) return null
  return (m[1] || m[2] || '').trim()
}

const paramOf = (disposition, key) => {
  const re = new RegExp(key + '=(?:"([^"]*)"|([^;\\s]+))', 'i')
  const m = re.exec(disposition || '')
  if (!m) return null
  return m[1] !== undefined ? m[1] : m[2]
}

export function parseMultipart(buffer, contentType) {
  const boundary = boundaryOf(contentType)
  if (!boundary) return { fields: {}, file: null, error: "Missing multipart boundary parameter in 'Content-Type' header." }
  if (!buffer.length) return { fields: {}, file: null, error: 'The request body is empty.' }

  const delimiter = Buffer.from('--' + boundary)

  let pos = buffer.indexOf(delimiter)
  if (pos < 0) return { fields: {}, file: null, error: 'Malformed multipart body: opening boundary not found.' }

  const fields = {}
  let file = null

  while (true) {
    pos += delimiter.length
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break
    if (buffer[pos] === 0x0d && buffer[pos + 1] === 0x0a) pos += 2
    else if (buffer[pos] === 0x0a) pos += 1
    else if (pos >= buffer.length) break

    let headEnd = buffer.indexOf('\r\n\r\n', pos)
    let headLen = 4
    if (headEnd < 0) {
      headEnd = buffer.indexOf('\n\n', pos)
      headLen = 2
    }
    if (headEnd < 0) return { fields: {}, file: null, error: 'Malformed multipart body: part headers are incomplete.' }

    const headers = buffer.subarray(pos, headEnd).toString('utf8')
    const disposition = /content-disposition:(.*)/i.exec(headers)?.[1] ?? ''
    const name = paramOf(disposition, 'name')
    const filename = paramOf(disposition, 'filename')
    const partType = (/content-type:(.*)/i.exec(headers)?.[1] ?? '').trim() || 'text/plain'

    const nextDelim = buffer.indexOf(delimiter, headEnd + headLen)
    if (nextDelim < 0) return { fields: {}, file: null, error: 'Malformed multipart body: closing boundary not found.' }

    let end = nextDelim
    if (buffer[end - 2] === 0x0d && buffer[end - 1] === 0x0a) end -= 2
    else if (buffer[end - 1] === 0x0a) end -= 1
    const data = buffer.subarray(headEnd + headLen, end < headEnd + headLen ? headEnd + headLen : end)

    if (filename != null || name === 'file') {
      if (!file) file = { fileName: filename ?? '', contentType: partType, data: Buffer.from(data) }
    } else if (name) {
      fields[name] = data.toString('utf8')
    }

    pos = nextDelim
    if (buffer.indexOf(delimiter, pos) < 0) break
  }

  return { fields, file, error: null }
}
