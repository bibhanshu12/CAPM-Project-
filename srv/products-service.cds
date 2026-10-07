using my.boms as db from '../db/schema';

service ProductService {
    entity Products as projection on db.Products;
}