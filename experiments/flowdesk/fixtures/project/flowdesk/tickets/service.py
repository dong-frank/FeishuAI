from .filters import filter_tickets
from .models import Ticket


def list_tickets(tickets: list[Ticket], status: str | None = None) -> list[Ticket]:
    filtered = filter_tickets(tickets, status=status)
    return sorted(filtered, key=lambda ticket: ticket.id)
