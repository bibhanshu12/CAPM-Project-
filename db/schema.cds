namespace my.boms;

using { cuid, managed } from '@sap/cds/common';

entity Materials : cuid, managed {
    materialCode : String(40) not null @unique;
    name         : String(100) not null;
    description  : String(500);
    materialType : String(30);
    baseUnit     : String(10) not null;
    unitPrice    : Decimal(15,2);
    currency     : String(3);
    isActive     : Boolean default true;
}

entity Products : cuid, managed {
    productCode : String(40) not null @unique;
    name        : String(100) not null;
    description : String(500);
    baseUnit    : String(10) not null;
    isActive    : Boolean default true;
}

// Bill of Materials header
entity BOMs : cuid, managed {
    bomNumber   : String(40) not null @unique;
    description : String(255);
    version     : String(10) default '1';
    status      : String(20) default 'DRAFT';
    validFrom   : Date;
    validTo     : Date;

    product     : Association to Products not null;
    items       : Composition of many BOMItems
                      on items.bom = $self;
}

// Components belonging to a BOM
entity BOMItems : cuid, managed {
    itemNumber  : Integer not null;
    quantity    : Decimal(15,3) not null;
    unit        : String(10) not null;
    scrapRate   : Decimal(5,2) default 0;

    bom         : Association to BOMs not null;
    material    : Association to Materials not null;
}

// Suppliers
entity Suppliers : cuid, managed {
    supplierCode : String(40) not null @unique;
    name         : String(150) not null;
    email        : String(150);
    phone        : String(30);
    address      : String(300);
    isActive     : Boolean default true;
}

// Supplier-material relationship
entity SupplierMaterials : cuid, managed {
    supplier     : Association to Suppliers not null;
    material     : Association to Materials not null;
    supplierPartNumber : String(60);
    leadTimeDays : Integer;
    unitPrice    : Decimal(15,2);
    currency     : String(3);
}
