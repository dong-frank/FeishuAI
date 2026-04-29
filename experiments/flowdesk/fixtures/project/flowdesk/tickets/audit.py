from datetime import datetime, timezone

from .models import Ticket


def record_ticket_event(ticket: Ticket, action: str, actor: str) -> dict[str, str]:
    return {
        "ticket_id": str(ticket.id),
        "action": action,
        "actor": actor,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
