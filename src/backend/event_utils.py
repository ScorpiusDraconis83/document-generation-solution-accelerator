import os
import logging
from azure.monitor.events.extension import track_event

logger = logging.getLogger(__name__)
_telemetry_disabled_logged = False


def track_event_if_configured(event_name: str, event_data: dict):
    global _telemetry_disabled_logged
    connection_string = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not connection_string:
        if not _telemetry_disabled_logged:
            logger.warning("Application Insights connection string is not set; telemetry events are disabled.")
            _telemetry_disabled_logged = True
        return

    track_event(event_name, event_data)
