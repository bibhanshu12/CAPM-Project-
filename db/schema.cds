namespace com.company.boms;

using {
  managed,
  sap
} from '@sap/cds/common';

// ---------------------------------------------------------------------------
// Controlled vocabularies (code lists) for the BOMS domain.
//
// These are CDS "enum" types: each member maps to a stable code that is stored
// in the database, plus a human readable label. Using enums (instead of plain
// String) means CAP/HANA enforce a fixed set of values, so the ingestion layer
// of the RAG pipeline can rely on a predictable vocabulary.
//

/** Lifecycle state of an employee record. */
type EmploymentStatus : String(20) enum {
  Active    = 'Active';
  OnLeave   = 'OnLeave';
  Terminated = 'Terminated';
};

/** Lifecycle state of a project. */
type ProjectStatus : String(20) enum {
  Planned    = 'Planned';
  Active     = 'Active';
  OnHold     = 'OnHold';
  Completed  = 'Completed';
  Cancelled  = 'Cancelled';
}

/** What kind of work the service request represents. */
type RequestType : String(20) enum {
  Incident       = 'Incident';
  ServiceRequest = 'ServiceRequest';
  ChangeRequest  = 'ChangeRequest';
  AccessRequest  = 'AccessRequest';
}

/**
 * Severity of a service request.
 * Modelled as an ordinal integer (1 = most severe) so that priority can be
 * sorted and filtered numerically by a RAG retriever instead of by string.
 */
type Priority : Integer enum {
  Critical = 1;
  High     = 2;
  Medium   = 3;
  Low      = 4;
}

/** Lifecycle state of a service request. */
type RequestStatus : String(20) enum {
  New        = 'New';
  Assigned   = 'Assigned';
  InProgress = 'InProgress';
  Pending    = 'Pending';
  Resolved   = 'Resolved';
  Closed     = 'Closed';
  Cancelled  = 'Cancelled';
}

/** Outcome of an approval step. */
type ApprovalStatus : String(20) enum {
  Pending  = 'Pending';
  Approved = 'Approved';
  Rejected = 'Rejected';
}

/** Editorial state of a knowledge article. */
type ArticleStatus : String(20) enum {
  Draft     = 'Draft';
  Published = 'Published';
  Archived  = 'Archived';
}

// ---------------------------------------------------------------------------
// BOMS domain model
// ---------------------------------------------------------------------------
//
// Ten entities grouped into three areas:
//
//   Organisation : Departments, Employees, Projects, EmployeeProjects
//   Requests     : ServiceRequests, RequestApprovals, RequestComments,
//                  RequestHistories
//   Knowledge    : KnowledgeCategories, KnowledgeArticles
//
// Conventions used across the model:
//   * `UUID`   - surrogate primary key. CAP fills it automatically on insert,
//                so clients never have to generate one.
//   * `managed`- appends createdAt / createdBy / modifiedAt / modifiedBy.
//   * Fields ending in an association (department, manager, request, author,
//     ...) are managed associations, not free text, so a retrieval pipeline
//     can walk request -> requester -> department instead of matching on
//     denormalised text. Navigation follows the declaration, so the child
//     side of a link is reachable ($expand) and the parent side is reached
//     by filtering the child, e.g.
//       /ServiceRequests(<id>)?$expand=requestedBy
//       /RequestApprovals?$filter=request/requestId eq '<id>'
//   * CDS enum types are only descriptive - they generate the OData code
//     list but do NOT reject bad values on write. Every controlled field
//     therefore also carries @assert.enum, and priority carries
//     @assert.range, so a malformed payload fails with 400 instead of
//     silently poisoning the vocabulary a RAG retriever depends on.
//   * Required text fields are `not null @mandatory`. `not null` alone only
//     guards the database and surfaces as an opaque 500; @mandatory makes
//     the OData layer answer 400 "Provide the missing value." instead.
// ---------------------------------------------------------------------------


// ===========================================================================
// ORGANISATION
// ===========================================================================

/** An organisational unit that owns employees and service requests. */
@title: 'Department'
entity Departments : managed {
  key departmentId   : UUID;
      @title: 'Department Name'
      departmentName : String(100) not null @mandatory;
      description    : String(500);
      /** The employee heading this department. */
      manager        : Association to Employees;
}

/** A person who can raise, own, approve or author records. */
@title: 'Employee'
entity Employees : managed {
  key employeeId       : UUID;
      @title: 'Employee Name'
      employeeName      : String(100) not null @mandatory;
      email             : String(255) not null @mandatory;
      designation       : String(100);
      @sap.common.CodeList: {
        name : 'EmploymentStatus',
        sap.common.ValueListWithFixedValues
      }
      employmentStatus  : EmploymentStatus default 'Active'
        @assert.enum: [Active, OnLeave, Terminated];
      /** Owning department. */
      department        : Association to Departments;
      /** Reporting line, self reference to allow arbitrarily deep hierarchies. */
      manager           : Association to Employees;
}

/** A unit of work that employees are allocated to. */
@title: 'Project'
entity Projects : managed {
  key projectId    : UUID;
      projectName  : String(100) not null @mandatory;
      description   : String(500);
      @sap.common.CodeList: {
        name : 'ProjectStatus',
        sap.common.ValueListWithFixedValues
      }
      projectStatus : ProjectStatus default 'Planned'
        @assert.enum: [Planned, Active, OnHold, Completed, Cancelled];
      startDate     : Date;
      endDate       : Date;
}

/**
 * Allocation of an employee to a project. Pure join entity, so the primary
 * key is the pair of foreign keys and a row is unique per assignment.
 */
@title: 'Employee Project Assignment'
entity EmployeeProjects {
  key employee    : Association to Employees not null;
  key project     : Association to Projects not null;
      projectRole : String(100);
      assignedAt  : Timestamp default $now;
}


// ===========================================================================
// REQUESTS
// ===========================================================================

/** The central work item: an incident, service, change or access request. */
@title: 'Service Request'
entity ServiceRequests : managed {
  key requestId   : UUID;
      title        : String(200) not null @mandatory;
      description  : String(2000);
      @sap.common.CodeList: {
        name : 'RequestType',
        sap.common.ValueListWithFixedValues
      }
      requestType  : RequestType
        @assert.enum: [Incident, ServiceRequest, ChangeRequest, AccessRequest];
      /** 1 = Critical ... 4 = Low, so priority can be sorted numerically. */
      priority     : Priority
        @assert.range: [1, 4];
      @sap.common.CodeList: {
        name : 'RequestStatus',
        sap.common.ValueListWithFixedValues
      }
      status       : RequestStatus default 'New'
        @assert.enum: [New, Assigned, InProgress, Pending, Resolved, Closed, Cancelled];
      requestedBy  : Association to Employees;
      assignedTo   : Association to Employees;
      department   : Association to Departments;
      requestedAt  : Timestamp default $now;
      dueDate      : Timestamp;
}

/** One approval step in the workflow of a service request. */
@title: 'Request Approval'
entity RequestApprovals : managed {
  key approvalId     : UUID;
      request        : Association to ServiceRequests not null;
      approver       : Association to Employees;
      @sap.common.CodeList: {
        name : 'ApprovalStatus',
        sap.common.ValueListWithFixedValues
      }
      approvalStatus : ApprovalStatus default 'Pending'
        @assert.enum: [Pending, Approved, Rejected];
      comments       : String(1000);
      approvedAt     : Timestamp;
}

/** Free text discussion attached to a service request. */
@title: 'Request Comment'
entity RequestComments : managed {
  key commentId   : UUID;
      request     : Association to ServiceRequests not null;
      commentedBy : Association to Employees;
      commentText : String(2000) not null @mandatory;
}

/**
 * Append only audit trail of a service request. Every status transition writes
 * one row, which gives a retrieval pipeline a ready made timeline.
 */
@title: 'Request History'
entity RequestHistories : managed {
  key historyId   : UUID;
      request     : Association to ServiceRequests not null;
      action      : String(100);
      oldStatus   : String(20);
      newStatus   : String(20);
      performedBy : Association to Employees;
      comments    : String(1000);
}


// ===========================================================================
// KNOWLEDGE
// ===========================================================================

/** Topic grouping for knowledge articles. */
@title: 'Knowledge Category'
entity KnowledgeCategories : managed {
  key categoryId    : UUID;
      categoryName  : String(100) not null;
      description   : String(500);
}

/**
 * Long form "how to" / "what is" content. This is the entity a RAG pipeline
 * chunks and embeds, so `content` is intentionally unbounded (capped only by
 * HANA) and `title` plus `category` carry the retrieval metadata.
 */
@title: 'Knowledge Article'
entity KnowledgeArticles : managed {
  key articleId : UUID;
      title      : String(300) not null;
      content    : String;
      category   : Association to KnowledgeCategories;
      author     : Association to Employees;
      @sap.common.CodeList: {
        name : 'ArticleStatus',
        sap.common.ValueListWithFixedValues
      }
      status     : ArticleStatus default 'Draft'
        @assert.enum: [Draft, Published, Archived];
      publishedAt : Timestamp;
}
