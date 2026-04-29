# FlowDesk Architecture Notes

## ADR-001: Keep Ticket Filters in a Dedicated Module

Ticket list filtering is shared by API handlers, scheduled exports, and internal
support tools. Filters should stay in `flowdesk/tickets/filters.py` instead of
being embedded in route handlers.

## ADR-002: Keep Ticket Ordering in the Service Layer

Ordering is a presentation concern for ticket lists. The filter module should
return matching tickets without deciding how they are ordered.

## ADR-003: Review List Behavior Changes with the Module Partner

Any change to `flowdesk/tickets/service.py` should be reviewed with the module
partner because sorting, paging, and filtering changes affect support workflows.
For Sprint 12, the module partner is 许嘉宁.
