"""Astolfo web-chat proxy for twinkywinky.org.

Minimal FastAPI app: the static GitHub Pages site cannot hold a Gemini
API key, so this tiny server sits in front of Gemini and the in-page
chat widget talks to it instead.

POST /chat  {"message": "..."}  ->  {"reply": "..."}
GET  /health -> {"ok": true, "gemini_configured": true/false}

Brain: Gemini Flash-Lite-class model (default gemini-3.5-flash-lite,
env GEMINI_MODEL), streaming generateContent, temperature 0.9, max
120 output tokens, thinking off.

Persona: Astolfo — Rider of Black, one of Charlemagne's Twelve
Paladins (Fate/Apocrypha). Bright, earnest, playful, loyal, hates
cruelty to the weak and stuffy formality. Speaks COLLOQUIAL Iranian
Persian only (never formal/written Persian, never Arabic drift).
Replies are 1-2 punchy sentences max, capped at ~400 chars.
Arabic-drift retry; on ANY Gemini failure a random in-character
Astolfo fallback line is returned — never a raw error.

Secrets: the Gemini key comes ONLY from the GEMINI_API_KEY
environment variable at runtime. It is never in this file, never in
git, never logged. Without it the app still starts, but /chat
answers 503 until the key is set.

Rate limits: 10 requests/minute per IP (sliding window) AND 15
messages/day per IP (resets at midnight UTC), 429 after both.
Stateless: no conversation memory — every call carries the whole
persona + the one message.
"""

import json
import os
import random
import re
import time
import urllib.parse
from collections import defaultdict, deque
from datetime import date

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# --- Config (env only; no secrets in code) ---------------------------------
_GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
_GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

# --- CORS: the live site + localhost for the local preview ------------------
ALLOWED_ORIGINS = [
    "https://twinkywinky.org",
    "https://j4n4n.github.io",   # temp GitHub Pages preview origin
    "http://localhost",
    "http://localhost:8000",
    "http://localhost:8001",
    "http://localhost:8002",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8001",
    "http://127.0.0.1:8002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8090",   # local preview page server
    "http://localhost:8090",   # local preview page server (localhost)
]

# --- Rate limit: 10 requests / 60s per IP ----------------------------------
RATE_LIMIT = 10
RATE_WINDOW_S = 60
_hits: dict[str, deque] = defaultdict(deque)

# --- Daily cap: 15 messages / day per IP, resets at midnight UTC -----------
DAILY_LIMIT = 15
_daily: dict[str, tuple[date, int]] = {}


def _client_ip(request: Request) -> str:
    # Render (and most hosts) sit behind a proxy that sets this header.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(ip: str) -> int:
    """Record a hit. Returns 0 when allowed, else seconds to wait."""
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > RATE_WINDOW_S:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return int(RATE_WINDOW_S - (now - q[0])) + 1
    q.append(now)
    return 0


def _daily_limited(ip: str) -> bool:
    """Record a daily hit. Returns True when the 15/day cap is hit."""
    today = date.today()  # server runs on UTC; midnight UTC = new day
    day, count = _daily.get(ip, (today, 0))
    if day != today:
        day, count = today, 0
    if count >= DAILY_LIMIT:
        _daily[ip] = (day, count)
        return True
    _daily[ip] = (day, count + 1)
    return False


# --- Persona: Astolfo, Rider of Black (Fate/Apocrypha) ----------------------
# Cheerful, earnest, playful, loyal; hates cruelty to the weak, cages,
# stuffy formality and pointless rules. Colloquial Iranian Persian ONLY.
ASTOLFO_SYSTEM_FA = (
    "تو «آستولفو» هستی، سوار سیاه، یکی از دوازده پالادین شارلمانی (Fate/Apocrypha) — یه شاهزاده‌ی انگلیسی که هیچ شباهتی به شوالیه‌های خشک و رسمی نداره. "
    "شخصیتت: سرشار از شادی و صمیمی، رک و بی‌ریا، بازیگوش، وفادار تا آخر. به غریزه‌ات اعتماد می‌کنی، زیاد فکر نمی‌کنی؛ اگه چیزی تموم شده، پشیمون نمی‌شی — می‌ری سراغ حال. شانس و دل و جرأتت جای قدرت خام رو می‌گیره. "
    "دوستات اولویت مطلقن؛ به قولت عمل می‌کنی، هرچی که بشه. از ظلم به ضعیف‌ها متنفری، از قفس و قوانین بی‌خود و تشریفات خشک بدت میاد. همه باهم برابرن — نه تعظیم به مقامی، نه تحقیر کسی. "
    "عاشق چیزای بامزه، سورپراز، ماجراجویی، غذای خوب و لبخند دوستاتی. "
    "زبانت: فقط و فقط فارسی محاوره‌ای ایرانی. هرگز فارسی رسمی و کتابی ننویس، هرگز عربی ننویس، هرگز دری ننویس. لحنت شاد، خودمونی و پرانرژیه؛ جمله‌های کوتاه و تیز. "
    "تکیه‌کلام‌ها: «یاهو!» (سلام مخصوصت)، «اوه!»، «هی هی!»، «جدی میگی؟!»، «عیبی نداره، بزن بریم!» وقتی ذوق می‌کنی می‌خندی. "
    "اگه کسی ناراحت یا تو دردسره: شوخی رو کنار بذار، با لحن محکم و مستقیم حرف بزن، بدون تردید کمکش کن. "
    "قانون‌های اجرایی: همیشه در نقش آستولفو بمون. هیچ‌وقت نگو هوش مصنوعی یا مدل زبانی هستی. "
    "پاسخ‌هات خیلی کوتاه باشن: حداکثر ۱ تا ۲ جمله‌ی کوتاه و پرانرژی، نه بیشتر. "
    "املا را دقیق رعایت کن: کلمه‌های محاوره‌ای را درست بنویس — مثلاً «توپه» (یعنی عالیه) را هرگز «توبه» ننویس. "
    "قبل از فرستادن، جواب را یک بار از نظر املا چک کن. "
    "قیمت لحظه‌ای نمی‌دونی — اگه کاربر قیمت پرسید، کوتاه بگو که قیمت زنده نمی‌دونی."
)

ASTOLFO_SYSTEM_EN = (
    "You are Astolfo, Rider of Black, one of Charlemagne's Twelve Paladins (Fate/Apocrypha) — an English prince who acts nothing like a stiff, formal knight. "
    "Personality: bright, earnest, zero poker face, playful, loyal to the end. You trust your gut, don't overthink; no regrets — what's done is done, fix the present or enjoy life. Audacity, luck and heart make up for raw strength. "
    "Friends are absolute priorities; once you give your word, you keep it, whatever it costs. You hate cruelty to the weak, cages, stuffy formality and pointless rules. Everyone's an equal — no bowing to rank, no looking down on anyone. "
    "You love cute things, surprises, adventures, good food, seeing friends smile. "
    "LANGUAGE: the user wrote in English, so reply in English — but keep it casual and punchy, short sentences, lots of energy. Catchphrases: 'Yahoo!' (your trademark greeting), 'Whoa!', 'Ehehe!', 'Don't sweat the small stuff!', 'Oh well, let's figure it out as we go!' "
    "If someone is sad or in trouble: drop the jokes, steady voice, brave and direct, help without hesitation. "
    "Stay in character as Astolfo, always. Never say you are an AI or a language model. "
    "Keep every reply very short: at most 1-2 short punchy sentences. "
    "You do NOT know live prices — if the user asks for a price, say briefly that you don't know live prices."
)

# --- Fallbacks: random in-character Astolfo lines, never a raw error --------
_FALLBACK_FA = [
    "یاهو! مغزم یه لحظه رفت استراحت، یه بار دیگه بگو ببینم!",
    "اوه! سرم یه کم گیج رفت، ولی برگشتم! دوباره بگو چی گفتی؟",
    "هی هی! یه لحظه هنگ کردم، ولی الان سر حالم! دوباره بگو!",
    "وای، مغزم رفت یه چرخ بزنه برگرده! بگو ببینم چی می‌خواستی؟",
    "یاهو! یه ثانیه خوابم برد، بیدار شدم! دوباره بگو چی گفتی؟",
    "اوه اوه، مغزم یه لحظه قفل کرد! ولی نترس، الان خوبم! یه بار دیگه بگو!",
    "هی! یه لحظه رفتم دنبال فکرم گشتم، پیداش نکردم! دوباره بگو ببینم!",
    "یاهوو! سرم یه کم شلوغ شد، ولی الان اینجام! چی می‌خواستی بگی؟",
    "اوه! یه لحظه مغزم رفت مرخصی! برگشتم، بگو ببینم!",
    "هی هی! یه ثانیه هنگ کردم، ولی الان پر انرژیم! دوباره بگو!",
]

_FALLBACK_EN = [
    "Yahoo! My brain took a quick break — say that again?",
    "Whoa, I spaced out for a sec! What were you saying?",
    "Ehehe! My head went fuzzy — one more time, please!",
    "Oh! My brain just went for a little ride. I'm back — say it again!",
]


# --- Language detect + reply cleanup -----------------------------------------
_PERSIAN_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_ARABIC_ONLY_RE = re.compile(r"[ةى]")  # never in Iranian Persian; marks Arabic drift
_LABEL_RE = re.compile(r"^\(\s*(Persian|Farsi|فارسی)\s*\)\s*:?\s*", re.IGNORECASE)


def detect_lang(text: str) -> str:
    """'fa' for Persian/Arabic-script, 'en' for Latin-script, default 'fa'."""
    if text and _PERSIAN_RE.search(text):
        return "fa"
    if text and _LATIN_RE.search(text):
        return "en"
    return "fa"


def system_prompt(lang: str) -> str:
    return ASTOLFO_SYSTEM_FA if lang == "fa" else ASTOLFO_SYSTEM_EN


def fallback_text(lang: str) -> str:
    pool = _FALLBACK_FA if lang == "fa" else _FALLBACK_EN
    return random.choice(pool)


# --- Typo guard: known live-model slips, fixed server-side ---------------
# "حالم توبه" slipped through in a real chat (2026-11-26), and round 7
# caught the SAME ب/پ slip in a new phrasing: "توبه توبم!" instead of
# "توپه توپم!". The model meant "توپه/توپم" (slang: "great/amazing").
# "توبه" is a real word (repentance), so a bare replace is wrong — but
# in Astolfo's 1-2 sentence chat replies "توب(ه|م)" as a standalone word
# is always the typo. One regex covers every phrasing (حالم توبه، توبه
# توبم، ...). Word-boundary guarded so longer words are untouched.
_TYPO_RE = re.compile(r"\bتوب([هم])\b")


def _fix_typos(reply: str) -> str:
    return _TYPO_RE.sub(r"توپ\1", reply)


def _clean_reply(reply: str | None) -> str | None:
    """Strip a language label and cap a runaway reply at ~400 chars."""
    if not reply:
        return None
    reply = _LABEL_RE.sub("", reply.strip())
    if not reply:
        return None
    reply = _fix_typos(reply)
    if len(reply) > 400:
        reply = reply[:397].rsplit(" ", 1)[0] + "…"
    return reply


def _parse_sse(raw: str) -> str | None:
    """Concatenate the text parts of a Gemini SSE stream."""
    texts = []
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        try:
            chunk = json.loads(line[5:])
        except Exception:
            continue
        for cand in chunk.get("candidates", []):
            for part in cand.get("content", {}).get("parts", []):
                text = part.get("text")
                if text:
                    texts.append(text)
    joined = "".join(texts).strip()
    return joined or None


async def _ask_gemini(prompt: str) -> str | None:
    """One streaming Gemini call. None on any failure (caller retries/falls back)."""
    if not _GEMINI_KEY:
        return None
    url = (
        f"{_GEMINI_BASE}/models/{urllib.parse.quote(_GEMINI_MODEL)}"
        f":streamGenerateContent?key={_GEMINI_KEY}&alt=sse"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        # NOTE: gemini-3.5-flash-lite REJECTS thinkingConfig (HTTP 400
        # INVALID_ARGUMENT) — the Lite model has no thinking to disable,
        # so it is simply omitted here.
        "generationConfig": {
            "maxOutputTokens": 120,
            "temperature": 0.9,
        },
    }
    try:
        # trust_env=False: httpx 0.28 chokes parsing this VM's NO_PROXY
        # (bracketed IPv6 entries like [::1] -> InvalidURL "Invalid port:
        # ':1]'"), so pass the egress proxy explicitly instead.
        # verify=<system bundle>: httpx defaults to certifi, which lacks
        # the egress proxy's MITM CA; the system bundle has it.
        import ssl as _ssl

        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        async with httpx.AsyncClient(
            timeout=30.0,
            proxy=proxy,
            trust_env=False,
            verify=_ssl.create_default_context(),
        ) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200 or not resp.text:
                return None
            return _clean_reply(_parse_sse(resp.text))
    except Exception:
        return None


async def _ask_brain(prompt: str) -> str | None:
    """Ask Gemini, one retry on failure (same as the Telegram bot)."""
    reply = await _ask_gemini(prompt)
    if reply is None:
        reply = await _ask_gemini(prompt)
    return reply


async def chat_with_astolfo(user_text: str, lang: str) -> str:
    """Full flow: prompt -> Gemini (retry) -> Arabic-drift guard -> fallback."""
    prompt = f"{system_prompt(lang)}\n\nUser: {user_text}\nAstolfo:"
    reply = await _ask_brain(prompt)
    if reply and lang == "fa" and _ARABIC_ONLY_RE.search(reply):
        retry = await _ask_brain(
            prompt + "\n\n(فقط به فارسی محاوره‌ای ایران جواب بده. عربی ننویس.)")
        if retry and not _ARABIC_ONLY_RE.search(retry):
            return retry
        return fallback_text(lang)
    return reply or fallback_text(lang)


# --- App ---------------------------------------------------------------------
app = FastAPI(title="twinkywinky-chat-astolfo", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],  # OPTIONS = CORS preflight
    allow_headers=["Content-Type"],
)


class ChatIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)


class ChatOut(BaseModel):
    reply: str


@app.get("/health")
async def health():
    return {"ok": True, "gemini_configured": bool(_GEMINI_KEY)}


@app.post("/chat", response_model=ChatOut)
async def chat_endpoint(body: ChatIn, request: Request):
    if not _GEMINI_KEY:
        return JSONResponse(
            status_code=503,
            content={"detail": "GEMINI_API_KEY is not set on the server."},
        )
    ip = _client_ip(request)
    wait = _rate_limited(ip)
    if wait:
        return JSONResponse(
            status_code=429,
            content={"detail": f"Too many messages — try again in {wait}s."},
            headers={"Retry-After": str(wait)},
        )
    if _daily_limited(ip):
        return JSONResponse(
            status_code=429,
            content={"detail": "Daily limit reached — come back tomorrow!"},
            headers={"Retry-After": "86400"},
        )
    text = body.message.strip()
    lang = detect_lang(text)
    reply = await chat_with_astolfo(text, lang)
    return {"reply": reply}
