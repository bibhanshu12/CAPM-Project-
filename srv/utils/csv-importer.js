import cds from '@sap/cds'

const ENTITY_MAP = {
  materials: 'my.boms.Materials',
  products: 'my.boms.Products',
  suppliers: 'my.boms.Suppliers',
  boms: 'my.boms.BOMs',
  bomitems: 'my.boms.BOMItems',
  suppliermaterials: 'my.boms.SupplierMaterials',
}

const COMPOSITES = {
  'my.boms.BOMItems': [['bom', 'material']],
  'my.boms.SupplierMaterials': [['supplier', 'material']],
}

const MAX_ERRORS = 500
const CHUNK = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MANAGED = ['@cds.on.insert', '@cds.on.update', '@Core.Computed']

const isAssoc = el => el.type === 'cds.Association'
const isComp = el => el.type === 'cds.Composition'
const isManaged = el => MANAGED.some(a => el[a] !== undefined)
const isRequired = el =>
  el.notNull === true && el.default == null && el['@cds.on.insert'] == null && el['@cds.on.update'] == null

const normalizeEntity = raw =>
  String(raw ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .toLowerCase()
    .replace(/^my\.boms\./, '')
    .replace(/[\s_-]+/g, '')

const naturalKey = def => {
  for (const [name, el] of Object.entries(def.elements)) {
    if (el['@unique'] && !isAssoc(el) && !isComp(el)) return name
  }
  return null
}

const fkFieldOf = el => el.keys?.[0]?.$generatedFieldName ?? null

const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

const validDate = s => {
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return false
  const days = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return d <= days[m - 1]
}

const coerce = (el, raw) => {
  const s = String(raw).trim()
  switch (el.type) {
    case 'cds.String':
    case 'cds.UUID':
    case 'cds.Code':
    case 'cds.Hash':
    case 'cds.LargeString':
      if (el.type === 'cds.UUID') {
        if (!UUID_RE.test(s)) return { error: `'${s}' is not a valid UUID.` }
        return { value: s }
      }
      if (el.length != null && s.length > el.length)
        return { error: `value is longer than the maximum length of ${el.length} characters.` }
      return { value: s }
    case 'cds.Integer':
    case 'cds.Integer64': {
      if (/^-?\d+$/.test(s)) {
        const n = Number(s)
        return { value: Number.isSafeInteger(n) ? n : s }
      }
      return { error: `'${s}' is not a valid integer.` }
    }
    case 'cds.Decimal':
    case 'cds.Double':
    case 'cds.Float':
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s))
        return { error: `'${s}' is not a valid number.` }
      return { value: s }
    case 'cds.Boolean': {
      const t = s.toLowerCase()
      if (t === 'true' || t === '1') return { value: true }
      if (t === 'false' || t === '0') return { value: false }
      return { error: `'${s}' is not a valid boolean (expected true/false or 1/0).` }
    }
    case 'cds.Date': {
      if (!DATE_RE.test(s) || !validDate(s)) return { error: `'${s}' is not a valid date (expected YYYY-MM-DD).` }
      return { value: s }
    }
    case 'cds.DateTime':
    case 'cds.Timestamp':
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || isNaN(Date.parse(s)))
        return { error: `'${s}' is not a valid timestamp.` }
      return { value: s }
    default:
      return { value: s }
  }
}

const chunksOf = arr => {
  const out = []
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK))
  return out
}

const emptyResult = (requested, fileName) => ({
  success: false,
  message: '',
  entity: requested,
  fileName,
  totalRows: 0,
  insertedRows: 0,
  failedRows: 0,
  errors: [],
})

const mkErr = (code, message, row, field, value) => ({
  row,
  field: field ?? '',
  value: value == null ? '' : String(value).slice(0, 100),
  code,
  message,
})

/**
 * Writes the prepared rows on the ambient request transaction.
 *
 * Never wrap this in cds.tx(): @cap-js/sqlite runs with pool.max = 1 (each
 * connection opens its own :memory: database), and the incoming HTTP request
 * already holds that single connection. A nested root transaction would wait
 * for a second connection forever, which hangs this request and starves every
 * other request waiting on the same pool. The ambient transaction commits
 * automatically when the request finishes, and CAP renders this INSERT as a
 * single `... SELECT ... FROM json_each(?)` statement, so it stays atomic.
 */
const runInsert = (fqn, entries) =>
  entries.length === 0 ? Promise.resolve() : cds.run(INSERT.into(fqn).entries(entries))

export async function runImport({ model, entityRaw, file, fileName }) {
  const requested = String(entityRaw ?? '').trim()
  const result = emptyResult(requested, fileName)
  const shortName = n => n.split('.').pop()

  const key = normalizeEntity(entityRaw)
  if (!key) {
    result.message = `Missing 'entity' parameter. Supported values: ${Object.keys(ENTITY_MAP).join(', ')}.`
    result.failedRows = 1
    result.errors = [mkErr('UNKNOWN_ENTITY', result.message, 0, '', '')]
    return result
  }
  const fqn = ENTITY_MAP[key]
  if (!fqn) {
    result.message = `Unknown entity '${requested}'. Supported values: ${Object.keys(ENTITY_MAP).join(', ')}.`
    result.failedRows = 1
    result.errors = [mkErr('UNKNOWN_ENTITY', result.message, 0, '', '')]
    return result
  }
  const def = model.definitions[fqn]
  if (!def) {
    result.message = `Entity '${fqn}' was not found in the CDS model.`
    result.failedRows = 1
    result.errors = [mkErr('UNKNOWN_ENTITY', result.message, 0, '', '')]
    return result
  }
  result.entity = requested || shortName(fqn)

  const text = file.data.toString('utf8')
  const rows = cds.parse.csv(text)
  if (!Array.isArray(rows)) {
    result.message = 'The uploaded file could not be parsed as CSV.'
    result.failedRows = 1
    result.errors = [mkErr('MALFORMED_CSV', result.message, 0, '', '')]
    return result
  }
  if (rows.length === 0) {
    result.message = 'The uploaded file is empty or contains no CSV rows (expected a header row).'
    result.failedRows = 1
    result.errors = [mkErr('MALFORMED_CSV', result.message, 0, '', '')]
    return result
  }
  if (rows.length === 1) {
    result.success = true
    result.totalRows = 0
    result.message = 'Imported 0 row(s). The file contains only a header row.'
    return result
  }

  result.totalRows = rows.length - 1

  const header = rows[0].map(h => String(h ?? '').trim())
  const plan = new Array(header.length).fill(null)
  const headerErrors = []
  const addHeaderErr = (code, message, field) => headerErrors.push(mkErr(code, message, 1, field, ''))

  const assocs = Object.entries(def.elements).filter(([, el]) => isAssoc(el))
  const aliasToAssoc = new Map()
  for (const [an, ae] of assocs) {
    const nk = naturalKey(model.definitions[ae.target])
    if (!nk) throw new Error(`Association '${an}' target '${ae.target}' has no unique key to resolve against.`)
    aliasToAssoc.set(nk, aliasToAssoc.has(nk) ? null : an)
  }

  const covered = new Map()
  const seenHeader = new Set()

  for (let i = 0; i < header.length; i++) {
    const name = header[i]
    if (name === '') {
      addHeaderErr('UNEXPECTED_COLUMN', `Header column ${i + 1} has an empty name.`, `column ${i + 1}`)
      continue
    }
    if (seenHeader.has(name)) {
      addHeaderErr('DUPLICATE_COLUMN', `Column '${name}' appears more than once in the header row.`, name)
      continue
    }
    seenHeader.add(name)

    const el = def.elements[name]
    if (el) {
      if (isComp(el)) {
        addHeaderErr(
          'UNEXPECTED_COLUMN',
          `Column '${name}' maps to a composition and cannot be imported directly. Import its child entity instead.`,
          name,
        )
        continue
      }
      if (isAssoc(el)) {
        if (covered.has(name)) {
          addHeaderErr('DUPLICATE_COLUMN', dupMsg(name, covered.get(name), name), name)
          continue
        }
        covered.set(name, name)
        plan[i] = { kind: 'assoc', assoc: name, header: name, ae: el }
        continue
      }
      if (isManaged(el)) {
        plan[i] = { kind: 'managed', header: name }
        continue
      }
      const fkOf = el['@odata.foreignKey4']
      if (fkOf) {
        if (covered.has(fkOf)) {
          addHeaderErr('DUPLICATE_COLUMN', dupMsg(name, covered.get(fkOf), fkOf), name)
          continue
        }
        covered.set(fkOf, name)
        plan[i] = { kind: 'fk', assoc: fkOf, header: name, el, ae: def.elements[fkOf] }
        continue
      }
      plan[i] = { kind: 'scalar', header: name, el }
      continue
    }

    if (aliasToAssoc.has(name)) {
      const an = aliasToAssoc.get(name)
      if (!an) {
        addHeaderErr(
          'UNEXPECTED_COLUMN',
          `Column '${name}' is ambiguous — it matches the natural key of more than one association. Use the association name instead.`,
          name,
        )
        continue
      }
      if (covered.has(an)) {
        addHeaderErr('DUPLICATE_COLUMN', dupMsg(name, covered.get(an), an), name)
        continue
      }
      covered.set(an, name)
      plan[i] = { kind: 'assoc', assoc: an, header: name, ae: def.elements[an] }
      continue
    }

    addHeaderErr('UNEXPECTED_COLUMN', `Column '${name}' does not exist on ${shortName(fqn)}.`, name)
  }

  const scalarHeaders = new Set(plan.filter(p => p && p.kind === 'scalar').map(p => p.header))

  for (const [name, el] of Object.entries(def.elements)) {
    if (isComp(el) || isAssoc(el) || isManaged(el)) continue
    if (el['@odata.foreignKey4']) continue
    if (name === 'ID') continue
    if (isRequired(el) && !scalarHeaders.has(name))
      addHeaderErr('MISSING_COLUMN', `Required column '${name}' is missing from the header row.`, name)
  }
  for (const [an, ae] of assocs) {
    if (isRequired(ae) && !covered.has(an))
      addHeaderErr('MISSING_COLUMN', `Required column '${an}' is missing from the header row.`, an)
  }

  if (headerErrors.length) {
    result.failedRows = result.totalRows
    result.errors = headerErrors.slice(0, MAX_ERRORS)
    result.message = `Validation failed: ${headerErrors.length} error(s) found.`
    return result
  }

  const dataRows = []
  const seen = new Map()
  const fkCollect = new Map()
  const badRows = new Set()
  let errCount = 0
  const addErr = (code, message, row, field, value) => {
    errCount++
    badRows.add(row)
    if (result.errors.length < MAX_ERRORS) result.errors.push(mkErr(code, message, row, field, value))
  }
  const collect = (assoc, mode, value, use) => {
    let entry = fkCollect.get(assoc)
    if (!entry) fkCollect.set(assoc, (entry = { mode, values: new Map() }))
    let uses = entry.values.get(value)
    if (!uses) entry.values.set(value, (uses = []))
    uses.push(use)
  }

  for (let i = 1; i < rows.length; i++) {
    const rowNo = i + 1
    const cells = rows[i]
    if (cells.length !== header.length) {
      addErr(
        'MALFORMED_ROW',
        `Row ${rowNo} has ${cells.length} column(s); expected ${header.length}.`,
        rowNo,
        '',
        '',
      )
      continue
    }
    const values = {}
    const pendingUniques = []
    const pendingFks = []
    let rowOk = true

    for (let c = 0; c < plan.length; c++) {
      const p = plan[c]
      if (!p || p.kind === 'managed') continue
      const raw = cells[c]
      const empty = raw == null || (typeof raw === 'string' && raw.trim() === '')

      if (empty) {
        if (isRequired(p.el ?? p.ae)) {
          addErr('REQUIRED', `Column '${p.header}' is required but is empty in row ${rowNo}.`, rowNo, p.header, '')
          rowOk = false
        }
        continue
      }

      const display = String(raw).trim()

      if (p.kind === 'scalar') {
        const r = coerce(p.el, display)
        if (r.error) {
          addErr('INVALID_TYPE', `Column '${p.header}': ${r.error} (row ${rowNo}).`, rowNo, p.header, display)
          rowOk = false
          continue
        }
        values[p.header] = r.value
        if (p.el['@unique'] || p.header === 'ID') {
          const v = p.header === 'ID' ? String(r.value).toLowerCase() : String(r.value)
          const first = seen.get(p.header) ?? new Map()
          if (first.has(v)) {
            addErr(
              'DUPLICATE_VALUE',
              `Value '${String(r.value)}' for '${p.header}' is used more than once in this file (first used in row ${first.get(v)}).`,
              rowNo,
              p.header,
              v,
            )
            rowOk = false
          } else pendingUniques.push([p.header, v, rowNo])
        }
      } else if (p.kind === 'fk') {
        if (!UUID_RE.test(display)) {
          addErr('INVALID_TYPE', `Column '${p.header}': '${display}' is not a valid UUID.`, rowNo, p.header, display)
          rowOk = false
          continue
        }
        pendingFks.push({ assoc: p.assoc, mode: 'id', value: display.toLowerCase(), header: p.header })
      } else if (p.kind === 'assoc') {
        const targetDef = model.definitions[p.ae.target]
        const nk = naturalKey(targetDef)
        const r = coerce(targetDef.elements[nk], display)
        if (r.error) {
          addErr('INVALID_TYPE', `Column '${p.header}': ${r.error} (row ${rowNo}).`, rowNo, p.header, display)
          rowOk = false
          continue
        }
        pendingFks.push({ assoc: p.assoc, mode: 'key', value: String(r.value), header: p.header })
      }
    }

    if (rowOk) {
      for (const [h, v, rn] of pendingUniques) {
        const first = seen.get(h) ?? new Map()
        first.set(v, rn)
        seen.set(h, first)
      }
      for (const f of pendingFks) collect(f.assoc, f.mode, f.value, { row: rowNo, header: f.header })
      dataRows.push({ rowNo, values })
    }
  }

  const failResult = () => {
    result.failedRows = badRows.size
    result.message = `Validation failed: ${errCount} error(s) in ${badRows.size} row(s).`
    return result
  }
  if (errCount) return failResult()

  const rowAssocIds = new Map(dataRows.map(({ rowNo }) => [rowNo, new Map()]))

  for (const [an, entry] of fkCollect) {
    const ae = def.elements[an]
    const targetDef = model.definitions[ae.target]
    const targetShort = shortName(ae.target)
    const nk = entry.mode === 'key' ? naturalKey(targetDef) : 'ID'
    const found = new Map()

    for (const batch of chunksOf([...entry.values.keys()])) {
      const cols = entry.mode === 'key' ? ['ID', nk] : ['ID']
      const rowsFound = await cds.run(SELECT.from(targetDef).columns(cols).where({ [nk]: { in: batch } }))
      for (const r of rowsFound) {
        const k = String(entry.mode === 'key' ? r[nk] : r.ID)
        found.set(entry.mode === 'id' ? k.toLowerCase() : k, r.ID)
      }
    }

    for (const [val, uses] of entry.values) {
      const id = found.get(val)
      if (id == null) {
        for (const u of uses)
          addErr(
            'FK_NOT_FOUND',
            `Value '${val}' for '${u.header}' was not found in ${targetShort} (row ${u.row}).`,
            u.row,
            u.header,
            val,
          )
      } else {
        for (const u of uses) rowAssocIds.get(u.row)?.set(an, id)
      }
    }
  }
  if (errCount) return failResult()

  for (const [elName, first] of seen) {
    for (const batch of chunksOf([...first.keys()])) {
      const existing = await cds.run(SELECT.from(fqn).columns(elName).where({ [elName]: { in: batch } }))
      for (const r of existing) {
        const v = String(r[elName])
        addErr(
          'DUPLICATE_VALUE',
          `Value '${v}' for '${elName}' already exists in the database.`,
          first.get(v),
          elName,
          v,
        )
      }
    }
  }
  if (errCount) return failResult()

  const assocHeader = new Map(
    plan.filter(p => p && (p.kind === 'assoc' || p.kind === 'fk')).map(p => [p.assoc, p.header]),
  )

  for (const [part1, part2] of COMPOSITES[fqn] ?? []) {
    const seenC = new Map()
    for (const { rowNo, values } of dataRows) {
      const ids = rowAssocIds.get(rowNo)
      const a = ids.get(part1)
      const b = ids.get(part2)
      if (a == null || b == null) continue
      const ck = `${a}|${b}`
      if (seenC.has(ck)) {
        const val = [values[assocHeader.get(part1)], values[assocHeader.get(part2)]]
          .filter(x => x != null)
          .join(', ')
        addErr(
          'DUPLICATE_VALUE',
          `The combination of '${part1}' and '${part2}' is used more than once in this file (first used in row ${seenC.get(ck)}).`,
          rowNo,
          `${part1}+${part2}`,
          val,
        )
      } else seenC.set(ck, rowNo)
    }
  }
  if (errCount) return failResult()

  const entries = dataRows.map(({ rowNo, values }) => {
    const entry = { ...values }
    for (const [an, id] of rowAssocIds.get(rowNo) ?? []) {
      entry[fkFieldOf(def.elements[an]) ?? `${an}_ID`] = id
    }
    if (entry.ID == null) entry.ID = cds.utils.uuid()
    return entry
  })

  try {
    await runInsert(fqn, entries)
  } catch (e) {
    const msg = String(e.message ?? e).slice(0, 300)
    result.message = `Insert failed: ${msg}`
    result.failedRows = result.totalRows
    result.errors = [mkErr('INSERT_FAILED', msg, 0, '', '')]
    return result
  }

  result.success = true
  result.insertedRows = entries.length
  result.failedRows = 0
  result.message = `Imported ${entries.length} row(s) into ${shortName(fqn)}.`
  return result
}

function dupMsg(col, already, assoc) {
  return `Column '${col}' covers association '${assoc}' which is already covered by column '${already}'. Provide only one column for that association.`
}
