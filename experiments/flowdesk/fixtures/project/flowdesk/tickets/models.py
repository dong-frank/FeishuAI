from dataclasses import dataclass


@dataclass(frozen=True)
class Ticket:
    id: int
    title: str
    status: str
    priority: str
    assignee: str | None = None
