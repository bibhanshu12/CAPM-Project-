import cds from '@sap/cds'
import { runImport } from './utils/csv-importer.js'

const fail = (code, message, entity, fileName) => ({
  success: false,
  message,
  entity: String(entity ?? '').trim(),
  fileName: fileName ?? '',
  totalRows: 0,
  insertedRows: 0,
  failedRows: 1,
  errors: [{ row: 0, field: '', value: '', code, message }],
})

export default class BOMService extends cds.ApplicationService {
  async init() {
    const r = await super.init()

    this.on('importCSV', async req => {
      const stash = req.http?.req?.csvUpload ?? cds.context?.http?.req?.csvUpload
      const entity = stash?.fields?.entity ?? req.query?.entity ?? req.data?.entity ?? ''
      const fileName = stash?.file?.fileName ?? ''

      try {
        if (!stash?.file)
          return fail(
            'NO_FILE',
            "No file was uploaded. Send a multipart/form-data request with a 'file' part and an 'entity' field.",
            entity,
            fileName,
          )

        const model = cds.context?.model ?? this.model ?? cds.model
        return await runImport({ model, entityRaw: entity, file: stash.file, fileName })
      } catch (e) {
        cds.log('boms-service').error(`importCSV failed: ${e.message}`)
        return fail('INTERNAL_ERROR', `Unexpected error: ${e.message}`, entity, fileName)
      }
    })

    return r
  }
}
