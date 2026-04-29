# Ticket List API Contract

The ticket list service accepts optional query filters.

Supported status values:

- `Open`
- `Pending`
- `Closed`

Supported priority values:

- `High`
- `Medium`
- `Low`

Story `FD-124` requires the list service to accept a `priority` filter and apply
it together with the existing `status` filter.
