using my.boms as db from '../db/schema';

service BOMService {

    entity BOMs as projection on db.BOMs;
    entity BOMItems as projection on db.BOMItems;
    entity Products as projection on db.Products;

    action importCSV() returns ImportResult;

}

type ImportError {
    row     : Integer;
    field   : String;
    value   : String;
    code    : String;
    message : String;
}

type ImportResult {
    success      : Boolean;
    message      : String;
    entity       : String;
    fileName     : String;
    totalRows    : Integer;
    insertedRows : Integer;
    failedRows   : Integer;
    errors       : many ImportError;
}