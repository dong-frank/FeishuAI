# FlowDesk

FlowDesk is a lightweight SaaS ticketing backend used by the git-helper
experiment. The code is intentionally small but realistic enough to produce Git
diffs for commit-message, conflict, and review workflows.

The team has been running short Scrum cycles around ticket intake, triage, and
operator productivity.

Recent sprint history:

- Sprint 10 shipped ticket audit events for status changes.
- Sprint 11 added assignee filtering for support leads.
- Sprint 12 focuses on triage speed and review handoff.

Sprint 12 active story:

- `FD-124`: ticket lists should support filtering by priority.

Local module map:

- `flowdesk/tickets/models.py`: ticket domain types.
- `flowdesk/tickets/filters.py`: reusable list filters.
- `flowdesk/tickets/service.py`: list orchestration and ordering.
- `flowdesk/tickets/audit.py`: lightweight ticket event recording.
