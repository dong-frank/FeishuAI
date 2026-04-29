from flowdesk.tickets.filters import filter_tickets
from flowdesk.tickets.models import Ticket


def test_filters_tickets_by_status():
    tickets = [
        Ticket(id=1, title="Login issue", status="Open", priority="High"),
        Ticket(id=2, title="Billing question", status="Closed", priority="Low"),
    ]

    result = filter_tickets(tickets, status="Open")

    assert [ticket.id for ticket in result] == [1]
