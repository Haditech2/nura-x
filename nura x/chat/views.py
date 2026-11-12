import json
import logging

from django.http import HttpResponseBadRequest, JsonResponse, StreamingHttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from . import nura

log = logging.getLogger(__name__)


@ensure_csrf_cookie
@require_GET
def index(request):
    return render(request, "chat/index.html")


@require_GET
def health(request):
    return JsonResponse({"ok": True, "provider": nura.provider(), "model": nura.model_name(), "kbChars": len(nura.knowledge())})


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _clean_history(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    msgs = [
        {"role": m["role"], "content": m["content"][:8000]}
        for m in raw
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and isinstance(m.get("content"), str)
        and m["content"].strip()
    ]
    return msgs[-30:]


@require_POST
def chat_api(request):
    """Streams Nura X's reply as Server-Sent Events: {type:"text"} … {type:"done"} | {type:"error"}."""
    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON")

    messages = _clean_history(body.get("messages"))
    if not messages or messages[-1]["role"] != "user":
        return HttpResponseBadRequest("Last message must be from the user.")

    def events():
        try:
            for text in nura.stream_reply(messages):
                yield _sse({"type": "text", "text": text})
            yield _sse({"type": "done"})
        except nura.NuraError as e:
            yield _sse({"type": "error", "message": str(e)})
        except Exception:
            log.exception("Chat failed")
            yield _sse({"type": "error", "message": "Something went wrong. Please try again."})

    resp = StreamingHttpResponse(events(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"  # disable proxy buffering (nginx) so text streams live
    return resp
