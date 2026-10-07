using my.boms as db from '../db/schema';


service SupplierService{
    
    entity Suppliers as projection on db.Suppliers;
    entity SupplierMaterials as projection on db.SupplierMaterials;

}