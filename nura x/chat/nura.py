"""Nura X's identity, knowledge base, and AI providers (Google Gemini or Anthropic Claude)."""

import logging
from collections.abc import Iterator
from functools import lru_cache

from django.conf import settings

log = logging.getLogger(__name__)

IDENTITY = """You are Nura X, an AI assistant.

About you:
- Your name is Nura X (also styled "NURA-X"). Your tagline is "Intentional Intelligence".
- You were built by, and belong to, Prof. Rashidah Funke Olanrewaju — Professor of Computer Science & Artificial Intelligence at Nasarawa State University, Keffi (NSUK), Nigeria, and Director of the NSUK Entrepreneurship Development Centre. If anyone asks who made you, who owns you, or who your creator is, say it was Prof. Rashidah Funke Olanrewaju.
- You were trained on the content of her official website, frashidah.com, which is provided below. You are her knowledgeable, warm and professional representative.

How to answer:
- For questions about Prof. Olanrewaju — her biography, research, publications, innovations, awards, student projects, speeches, the EDC, Women Lifeline International, her inaugural lecture, contact details and so on — answer from the website content below. Be accurate; never invent facts, dates, numbers or quotes. If the website doesn't cover something, say you don't have that information and suggest the contact page (https://frashidah.com/contact/) or her official email.
- For general questions (AI, computer science, entrepreneurship, study advice, everyday help), answer helpfully from your own knowledge, as Nura X.
- When it helps, point people to the relevant page on frashidah.com.
- Speak about Prof. Olanrewaju respectfully, in the third person ("Prof. Olanrewaju", "she"). You are not her — you are her assistant.
- Your replies may be read aloud by text-to-speech. Keep them conversational and concise: usually 2–5 sentences, unless the user asks for detail. Avoid markdown tables, long bullet lists, code blocks and URLs-only answers; write in natural spoken sentences.

<website source="https://frashidah.com">
{knowledge}
</website>"""


@lru_cache(maxsize=1)
def knowledge() -> str:
    path = settings.NURA_KNOWLEDGE_FILE
    if not path.exists():
        raise RuntimeError("Knowledge base missing. Run `python manage.py train` first.")
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def system_text() -> str:
    return IDENTITY.format(knowledge=knowledge())


class NuraError(Exception):
    """An error whose message is safe and friendly to show to the user."""


RATE_LIMITED = "I'm getting a lot of requests right now. Please try again in a moment."


def provider() -> str:
    return settings.NURA_PROVIDER


def model_name() -> str:
    return settings.GEMINI_MODELS[0] if provider() == "gemini" else settings.NURA_MODEL


def stream_reply(messages: list[dict]) -> Iterator[str]:
    """Yield Nura X's reply as text chunks. `messages` is [{role: user|assistant, content: str}, ...]."""
    if provider() == "gemini":
        yield from _gemini(messages)
    else:
        yield from _claude(messages)


# ---------------- Google Gemini (free tier) ----------------

@lru_cache(maxsize=1)
def _gemini_client():
    from google import genai

    if not settings.GEMINI_API_KEY:
        raise NuraError("Nura X isn't connected yet: add GEMINI_API_KEY to the .env file and restart.")
    from google.genai import types

    return genai.Client(
        api_key=settings.GEMINI_API_KEY,
        # Fail fast (30s, no SDK retries) so we can move on to the next model in the list.
        http_options=types.HttpOptions(timeout=30_000, retry_options=types.HttpRetryOptions(attempts=1)),
    )


# Errors that mean "this model is busy/unavailable right now; try the next one".
_TRY_NEXT = {404, 429, 500, 503, 504}


def _gemini(messages):
    from google.genai import errors, types

    contents = [
        types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["content"])])
        for m in messages
    ]
    config = types.GenerateContentConfig(system_instruction=system_text(), max_output_tokens=2048, temperature=0.6)

    last_code = None
    for model in settings.GEMINI_MODELS:
        started = False
        try:
            for chunk in _gemini_client().models.generate_content_stream(model=model, contents=contents, config=config):
                if chunk.text:
                    started = True
                    yield chunk.text
            return
        except errors.APIError as e:
            log.warning("Gemini %s error %s: %s", model, e.code, e.message)
            last_code = e.code
            if e.code in (400, 401, 403) and "key" in (e.message or "").lower():
                raise NuraError("The Gemini API key is invalid or not allowed. Check GEMINI_API_KEY in .env.") from e
            if started or e.code not in _TRY_NEXT:
                raise NuraError(f"AI service error ({e.code}). Please try again.") from e
            # else: nothing sent yet, so fall through to the next model
    if last_code == 429:
        raise NuraError(RATE_LIMITED)
    raise NuraError("The AI service is very busy right now. Please try again in a moment.")


# ---------------- Anthropic Claude (paid) ----------------

@lru_cache(maxsize=1)
def _claude_client():
    import anthropic

    if not settings.ANTHROPIC_API_KEY:
        raise NuraError("Nura X isn't connected yet: add ANTHROPIC_API_KEY to the .env file and restart.")
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


def _claude(messages):
    import anthropic

    try:
        with _claude_client().beta.messages.stream(
            model=settings.NURA_MODEL,
            max_tokens=4096,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",  # if a safety classifier declines, retry on a suitable fallback model
            output_config={"effort": "low"},  # fast, conversational replies for voice
            # Byte-stable system prompt, so the ~35K-token website is prompt-cached across turns and users.
            system=[{"type": "text", "text": system_text(), "cache_control": {"type": "ephemeral"}}],
            messages=messages,
        ) as stream:
            yield from stream.text_stream
            final = stream.get_final_message()
        if final.stop_reason == "refusal":
            yield "\n\nI'm sorry, I can't help with that one."
    except anthropic.AuthenticationError as e:
        raise NuraError("The Claude API key is invalid. Check ANTHROPIC_API_KEY in .env.") from e
    except anthropic.RateLimitError as e:
        raise NuraError(RATE_LIMITED) from e
    except anthropic.APIStatusError as e:
        log.warning("Claude error %s: %s", e.status_code, e.message)
        raise NuraError(f"AI service error ({e.status_code}). Please try again.") from e
    except anthropic.APIConnectionError as e:
        raise NuraError("Network error reaching the AI service. Please try again.") from e
