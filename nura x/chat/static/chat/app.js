// Nura X — browser client: text chat + dictation + hands-free voice conversation.
// Speech-to-text: Web Speech API (SpeechRecognition). Text-to-speech: speechSynthesis.

const $ = (id) => document.getElementById(id);
const chat = $("chat"), input = $("input"), form = $("composer"), sendBtn = $("sendBtn");
const micBtn = $("micBtn"), voiceBtn = $("voiceBtn"), speakToggle = $("speakToggle"), clearBtn = $("clearBtn");
const voicePanel = $("voicePanel"), orb = $("orb"), voiceStatus = $("voiceStatus"), interim = $("interim"), endVoice = $("endVoice");
const note = $("note");

let history = []; // [{role, content}]
let busy = false;
let speakReplies = true;
let voiceMode = false;
let abortCtrl = null;

// ---------------- Speech recognition ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasSTT = !!SR;
const hasTTS = "speechSynthesis" in window;

if (!hasSTT) {
  micBtn.hidden = true;
  voiceBtn.hidden = true;
  note.textContent = "Voice input isn't supported in this browser. Use Chrome or Edge for voice chat. Text chat works everywhere.";
}
if (!hasTTS) speakToggle.hidden = true;

function makeRecognizer({ continuous }) {
  const r = new SR();
  r.lang = "en-NG"; // Nigerian English; browsers fall back to en-* if unavailable
  r.interimResults = true;
  r.continuous = continuous;
  r.maxAlternatives = 1;
  return r;
}

// --- Dictation (mic button): fills the input box, then sends.
let dictation = null;
micBtn.addEventListener("click", () => {
  if (dictation) { dictation.stop(); return; }
  stopSpeaking();
  dictation = makeRecognizer({ continuous: false });
  let finalText = "";
  dictation.onresult = (e) => {
    let partial = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else partial += t;
    }
    input.value = (finalText + partial).trim();
  };
  dictation.onend = () => {
    micBtn.classList.remove("recording");
    dictation = null;
    if (finalText.trim()) send(finalText.trim());
  };
  dictation.onerror = (e) => showMicError(e.error);
  micBtn.classList.add("recording");
  dictation.start();
});

// --- Hands-free voice chat: listen → reply → speak → listen …
let listener = null;

function setOrb(state, label) {
  orb.className = "orb " + state;
  voiceStatus.textContent = label;
}

function startListening() {
  if (!voiceMode || busy) return;
  interim.textContent = "";
  setOrb("listening", "Listening…");
  listener = makeRecognizer({ continuous: false });
  let finalText = "";
  listener.onresult = (e) => {
    let partial = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else partial += t;
    }
    interim.textContent = (finalText + partial).trim();
  };
  listener.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { showMicError(e.error); stopVoiceMode(); }
  };
  listener.onend = () => {
    listener = null;
    if (!voiceMode) return;
    const text = finalText.trim();
    if (text) send(text);
    else setTimeout(startListening, 250); // silence — keep listening
  };
  try { listener.start(); } catch { /* already started */ }
}

function startVoiceMode() {
  voiceMode = true;
  voicePanel.hidden = false;
  form.hidden = true;
  speakReplies = true;
  speakToggle.setAttribute("aria-pressed", "true");
  startListening();
}
function stopVoiceMode() {
  voiceMode = false;
  voicePanel.hidden = true;
  form.hidden = false;
  if (listener) { listener.onend = null; listener.abort(); listener = null; }
  stopSpeaking();
}
voiceBtn.addEventListener("click", startVoiceMode);
endVoice.addEventListener("click", stopVoiceMode);
// Tap the orb to interrupt Nura X while she's speaking.
orb.addEventListener("click", () => { if (speechSynthesis.speaking) { stopSpeaking(); startListening(); } });

function showMicError(err) {
  note.textContent = err === "not-allowed" || err === "service-not-allowed"
    ? "Microphone access was blocked. Allow the microphone for this site and try again."
    : `Voice input error: ${err}`;
}

// ---------------- Text-to-speech ----------------
// Nura X's voice: a female Nigerian English voice.
// Best: "Microsoft Ezinne Online (Natural) - English (Nigeria)" — built into Microsoft Edge, free.
// Fallbacks: other female African-English neural voices, then any female English voice.
const VOICE_KEY = "nurax.voice";
const MALE = /\b(abeo|guy|david|mark|ryan|thomas|william|christopher|eric|roger|steffan|brian|andrew|luke|chilemba|daniel|james|george|male)\b/i;
const FEMALE = /\b(ezinne|leah|asilia|imani|aria|jenny|sonia|libby|maisie|natasha|emma|ava|michelle|zira|hazel|susan|samantha|karen|moira|tessa|female)\b/i;
let voice = null;

function englishVoices() {
  return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
}

function pickVoice() {
  const voices = englishVoices();
  let saved = null;
  try { saved = localStorage.getItem(VOICE_KEY); } catch {}
  if (saved) { const v = voices.find((x) => x.name === saved); if (v) return v; }
  const prefs = [
    (v) => /ezinne/i.test(v.name),                                         // Nigerian female (Edge)
    (v) => /en-NG/i.test(v.lang) && !MALE.test(v.name),                    // any other Nigerian non-male voice
    (v) => /en-(ZA|KE|TZ|GH)/i.test(v.lang) && FEMALE.test(v.name),        // other African-English female
    (v) => /(natural|neural|online)/i.test(v.name) && FEMALE.test(v.name), // natural-sounding female
    (v) => FEMALE.test(v.name),
    (v) => !MALE.test(v.name),
  ];
  for (const p of prefs) { const v = voices.find(p); if (v) return v; }
  return voices[0] || null;
}

const isNigerian = (v) => !!v && (/en-NG/i.test(v.lang) || /ezinne/i.test(v.name));
const isNatural = (v) => !!v && /(natural|neural|online)/i.test(v.name);

const voiceSelect = $("voiceSelect");
function refreshVoices() {
  voice = pickVoice();
  const voices = englishVoices();
  voiceSelect.innerHTML = "";
  // Nigerian voices first, then female, then the rest.
  const rank = (v) => (isNigerian(v) && !MALE.test(v.name) ? 0 : isNigerian(v) ? 1 : FEMALE.test(v.name) ? 2 : 3);
  for (const v of [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = v.name;
    o.textContent = `${isNigerian(v) ? "🇳🇬 " : ""}${v.name.replace(/^Microsoft /, "").replace(/ - English.*$/, "")} (${v.lang})`;
    if (voice && v.name === voice.name) o.selected = true;
    voiceSelect.appendChild(o);
  }
  voiceSelect.hidden = voices.length === 0;
  if (voices.length && !voices.some(isNigerian)) {
    note.textContent = "Tip: for Nura X's Nigerian voice (Ezinne), open this page in Microsoft Edge.";
  }
}
if (hasTTS) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
  voiceSelect.addEventListener("change", () => {
    voice = englishVoices().find((v) => v.name === voiceSelect.value) || voice;
    try { localStorage.setItem(VOICE_KEY, voice.name); } catch {}
    stopSpeaking();
    speak("Hello, I'm Nura X. This is how I sound.");
  });
} else {
  voiceSelect.hidden = true;
}

let speakQueue = 0;
function speak(text) {
  if (!hasTTS || !speakReplies) return;
  const clean = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>]/g, "")
    .replace(/\bProf\./g, "Professor")
    .replace(/\bNSUK\b/g, "N S U K")
    .replace(/\bEDC\b/g, "E D C")
    .trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  // Natural (neural) voices sound best untouched; give basic voices a slightly warmer, higher pitch.
  u.rate = isNatural(voice) ? 1.0 : 0.98;
  u.pitch = isNatural(voice) ? 1.0 : 1.12;
  speakQueue++;
  if (voiceMode) setOrb("speaking", "Speaking…  (tap to interrupt)");
  u.onend = u.onerror = () => {
    speakQueue--;
    if (speakQueue <= 0 && !busy && voiceMode) startListening();
  };
  speechSynthesis.speak(u);
}
function stopSpeaking() {
  if (!hasTTS) return;
  speakQueue = 0;
  speechSynthesis.cancel();
}

speakToggle.addEventListener("click", () => {
  speakReplies = !speakReplies;
  speakToggle.setAttribute("aria-pressed", String(speakReplies));
  if (!speakReplies) stopSpeaking();
});

// ---------------- Chat ----------------
// Django CSRF token (cookie set by the index view's @ensure_csrf_cookie).
function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function addBubble(role, text = "") {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role === "user" ? "user" : "bot"}`;
  if (role !== "user") {
    const av = document.createElement("img");
    av.className = "avatar";
    av.src = document.body.dataset.avatar;
    av.alt = "";
    wrap.appendChild(av);
  }
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
  wrap.appendChild(b);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return b;
}

function linkify(el) {
  el.innerHTML = el.textContent
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s)]+[^\s).,])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

async function send(text) {
  if (busy || !text) return;
  busy = true;
  sendBtn.disabled = true;
  input.value = "";
  stopSpeaking();
  addBubble("user", text);
  history.push({ role: "user", content: text });

  const bubble = addBubble("assistant");
  bubble.classList.add("typing");
  if (voiceMode) { interim.textContent = text; setOrb("thinking", "Thinking…"); }

  let full = "";
  let pending = ""; // text not yet sent to TTS
  abortCtrl = new AbortController();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
      body: JSON.stringify({ messages: history }),
      signal: abortCtrl.signal,
    });
    if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop();
      for (const ev of events) {
        const line = ev.trim();
        if (!line.startsWith("data:")) continue;
        const data = JSON.parse(line.slice(5));
        if (data.type === "text") {
          full += data.text;
          pending += data.text;
          bubble.textContent = full;
          chat.scrollTop = chat.scrollHeight;
          // Speak complete sentences as they stream in, for low-latency voice.
          const m = pending.match(/^[\s\S]*[.!?](\s|$)/);
          if (m) { speak(m[0]); pending = pending.slice(m[0].length); }
        } else if (data.type === "error") {
          throw new Error(data.message);
        }
      }
    }
    if (pending.trim()) speak(pending);
    history.push({ role: "assistant", content: full });
    linkify(bubble);
  } catch (err) {
    if (err.name !== "AbortError") {
      bubble.classList.add("error");
      bubble.textContent = err.message || "Something went wrong.";
      history.pop(); // drop the unanswered user turn
    }
  } finally {
    bubble.classList.remove("typing");
    busy = false;
    sendBtn.disabled = false;
    abortCtrl = null;
    // In voice mode with nothing to say (or TTS off), go straight back to listening.
    if (voiceMode && speakQueue <= 0) startListening();
    if (!voiceMode) input.focus();
  }
}

form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value.trim()); });

clearBtn.addEventListener("click", () => {
  if (abortCtrl) abortCtrl.abort();
  stopSpeaking();
  history = [];
  chat.querySelectorAll(".msg:not(.intro)").forEach((n) => n.remove());
});
