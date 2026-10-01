using com.company.boms as db from '../db/schema';

/**
 * BOMS application service.
 *
 * Every domain entity is exposed at the service root, so the OData V4 URLs
 * follow `http://localhost:4004/odata/v4/boms/<EntitySetName>` and the full
 * service document is browsable at `/odata/v4/boms/$metadata`.
 *
 * Entities are writable so the generic OData handlers serve the full CRUD verb
 * set (POST / PATCH / DELETE) with no custom implementation. Add a new entity
 * here and in ../db/schema.cds and it becomes API-accessible, which keeps this
 * model easy to extend when further versions are integrated.
 */
service BomsService @(path: '/boms') {

  // Organisation
  entity Departments         as projection on db.Departments;
  entity Employees           as projection on db.Employees;
  entity Projects            as projection on db.Projects;
  entity EmployeeProjects    as projection on db.EmployeeProjects;

  // Requests
  entity ServiceRequests     as projection on db.ServiceRequests;
  entity RequestApprovals    as projection on db.RequestApprovals;
  entity RequestComments     as projection on db.RequestComments;
  entity RequestHistories    as projection on db.RequestHistories;

  // Knowledge
  entity KnowledgeCategories as projection on db.KnowledgeCategories;
  entity KnowledgeArticles   as projection on db.KnowledgeArticles;
}
