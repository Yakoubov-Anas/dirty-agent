#!/usr/bin/env python3
"""Drive the Hermes desktop app's embedded Browser tool window.

Unlike `browser_navigate` (which drives the agent's own headless Chromium), this
tool acts on the SAME browser the user is watching in the desktop GUI's Browser
panel — sharing their cookies/login. It round-trips through the gateway's
blocking-prompt bridge (the same mechanism `clarify`/`read_terminal` use):
tui_gateway emits ``browser_control.request``, the renderer runs the action on the
<webview> and answers with ``browser_control.respond``.

Desktop-only, and only takes effect when the user has toggled "AI control" on in
the Browser panel — otherwise the desktop replies with a not-allowed result.
"""

import json
import os
from typing import Optional

from tools.registry import registry, tool_error

_VALID_ACTIONS = ("navigate", "read", "click", "type")


def browser_pane_tool(args: dict, task_id: Optional[str] = None) -> str:
    """Run one browser action on the desktop's embedded Browser webview."""
    action = (args.get("action") or "").strip().lower()

    if action not in _VALID_ACTIONS:
        return tool_error(f"action must be one of: {', '.join(_VALID_ACTIONS)}")

    if not task_id:
        return tool_error("browser_pane is only available in the Hermes desktop app.")

    params: dict = {}

    if action == "navigate":
        url = (args.get("url") or "").strip()
        if not url:
            return tool_error("navigate requires a 'url'.")
        params["url"] = url
    elif action in ("click", "type"):
        selector = (args.get("selector") or "").strip()
        if not selector:
            return tool_error(f"{action} requires a CSS 'selector'.")
        params["selector"] = selector
        if action == "type":
            params["text"] = args.get("text") or ""
            params["submit"] = bool(args.get("submit"))

    try:
        from tui_gateway import server
    except Exception as exc:  # pragma: no cover - desktop runtime only
        return tool_error(f"browser_pane is unavailable: {exc}")

    try:
        raw = server.browser_control_request(task_id, action, params, timeout=30)
    except Exception as exc:
        return tool_error(f"browser action failed: {exc}")

    if not raw:
        return tool_error(
            "No reply from the desktop Browser panel. Open the Browser tool "
            "window and enable AI control, then retry."
        )

    # Desktop answers with a JSON object; pass it through, else wrap the text.
    try:
        return json.dumps(json.loads(raw), ensure_ascii=False)
    except (TypeError, ValueError):
        return json.dumps({"result": str(raw)}, ensure_ascii=False)


def check_browser_pane_requirements() -> bool:
    """Desktop GUI only — HERMES_DESKTOP is set on the gateway the app spawns."""
    return (os.getenv("HERMES_DESKTOP") or "").strip().lower() in ("1", "true", "yes")


BROWSER_PANE_SCHEMA = {
    "name": "browser_pane",
    "description": (
        "Control the embedded Browser tool window in the Hermes desktop GUI — the "
        "same browser the user is viewing, sharing their logged-in session. Use "
        "this (not browser_navigate) when the user asks you to act in the browser "
        "they have open. Actions: 'navigate' (load a 'url'); 'read' (return the "
        "current page's url/title/visible text/html); 'click' (click the element "
        "matching a CSS 'selector'); 'type' (set 'text' on the input matching "
        "'selector', optional 'submit' to submit the form). Requires the user to "
        "have enabled AI control in the Browser panel; returns JSON with the "
        "outcome."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": list(_VALID_ACTIONS),
                "description": "The browser action to perform.",
            },
            "url": {
                "type": "string",
                "description": "For action='navigate': the URL (or bare host) to load.",
            },
            "selector": {
                "type": "string",
                "description": "For action='click'/'type': a CSS selector for the target element.",
            },
            "text": {
                "type": "string",
                "description": "For action='type': the text to enter into the element.",
            },
            "submit": {
                "type": "boolean",
                "description": "For action='type': submit the surrounding form after typing.",
            },
        },
        "required": ["action"],
    },
}


registry.register(
    name="browser_pane",
    toolset="browser-pane",
    schema=BROWSER_PANE_SCHEMA,
    handler=lambda args, **kw: browser_pane_tool(args, task_id=kw.get("task_id")),
    check_fn=check_browser_pane_requirements,
    emoji="🌐",
)
