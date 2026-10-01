namespace my.bookshop;

using { cuid } from '@sap/cds/common';

entity Books : cuid {
    title  : String(100);
    author : String(100);
    price  : Decimal(10,2);
}