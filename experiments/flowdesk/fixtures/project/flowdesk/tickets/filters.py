from .models import Ticket


def filter_tickets(tickets: list[Ticket], status: str | None = None) -> list[Ticket]:
    filtered = tickets

    if status is not None:
        filtered = [ticket for ticket in filtered if ticket.status == status]

    return filtered
