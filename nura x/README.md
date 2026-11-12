# Nura X

A Django web app that lets people **chat with Nura X by text or talk to it by voice**. Nura X was built by **Prof. Rashidah Funke Olanrewaju** and trained on her official website, [frashidah.com](https://frashidah.com).

- 💬 **Text chat** with replies that stream in as they're written
- 🎤 **Dictation**: tap the mic, speak, and your message is sent
- 🎙️ **Voice chat**: a hands-free conversation (listen → reply out loud → listen again). Tap the orb to interrupt.
- 🔊 Replies are read aloud as they arrive (toggle with the speaker button)
- 🧠 Knows everything on frashidah.com and answers general questions too
- Always says it was built by, and belongs to, Prof. Rashidah Funke Olanrewaju

## Setup (one time)

Requires Python 3.10+. Get a **free** Google Gemini API key at https://aistudio.google.com/apikey (or a paid Claude key at https://console.anthropic.com).

```bash
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # then open .env and paste your key
python manage.py migrate
```

## Run

```bash
python manage.py runserver
```
Open **http://127.0.0.1:8000** in **Chrome or Edge** (voice input needs one of these browsers; text chat works in any browser). Allow microphone access when asked.

## Re-training on the website

The knowledge base lives in `knowledge/frashidah.md`, built by crawling every page of frashidah.com. When the website changes:

```bash
python manage.py train
```
Then restart the server. The whole site (~35K tokens) is given to Nura X on every turn and prompt-cached, so answers stay accurate and inexpensive.

## Project layout

| Part | File |
|---|---|
| Nura X's identity and rules (name, creator, tone) | `chat/nura.py` (`IDENTITY`) |
| Streaming chat API (`POST /api/chat`, Server-Sent Events) | `chat/views.py` |
| Website crawler ("training") | `chat/management/commands/train.py` |
| Page template | `chat/templates/chat/index.html` |
| Voice + chat front end (Web Speech API) | `chat/static/chat/app.js`, `style.css` |
| Settings (model, knowledge file, env vars) | `nurax/settings.py` |

## Choosing the AI (Gemini or Claude)

Set `NURA_PROVIDER` in `.env`:

- **`gemini`** (default, free tier). The models in `GEMINI_MODELS` are tried in order, so if one is busy Nura X moves to the next one automatically. Free-tier limits apply, and Google may use free-tier conversations to improve its models.
- **`claude`** (paid, highest quality). Uses `NURA_MODEL` (`claude-opus-5-5`) with prompt caching. If a request is declined by a safety check, it automatically retries on a fallback model.

Restart the server after changing `.env`.

## Going live

1. In `.env` (or the host's environment variables) set `DJANGO_DEBUG=0`, a long random `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS=yourdomain.com`, and `ANTHROPIC_API_KEY`.
2. Run `python manage.py collectstatic`, then serve with a production server, for example `gunicorn nurax.wsgi` behind nginx. Static files can be served by nginx or by adding `whitenoise`.
3. The site **must use HTTPS**, because browsers only allow microphone access on secure pages.
4. Streaming needs proxy buffering off. The app already sends `X-Accel-Buffering: no` for nginx.
