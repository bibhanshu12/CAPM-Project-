using my.boms as db from '../db/schema';


service MaterialService {
    
    entity Materials as projection on db.Materials;
}