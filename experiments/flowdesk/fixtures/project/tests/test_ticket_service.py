from flowdesk.tickets.models import Ticket
from flowdesk.tickets.service import list_tickets


def test_list_tickets_returns_stable_id_order():
    tickets = [
        Ticket(id=10, title="Old login issue", status="Open", priority="Medium"),
        Ticket(id=12, title="Fresh billing issue", status="Open", priority="High"),
    ]

    result = list_tickets(tickets)

    assert [ticket.id for ticket in result] == [10, 12]


def test_list_tickets_applies_status_filter():
    tickets = [
        Ticket(id=10, title="Old login issue", status="Open", priority="Medium"),
        Ticket(id=12, title="Fresh billing issue", status="Closed", priority="High"),
    ]

    result = list_tickets(tickets, status="Open")

    assert [ticket.id for ticket in result] == [10]
