# OmniTutor 🎓

> A real-time AI tutoring agent powered by **Gemini 2.5 Flash Native Audio** — talk naturally with an AI that can see your screen, hear you, and respond like a human, with full interruption support.

![License](https://img.shields.io/badge/license-ISC-blue) ![Node](https://img.shields.io/badge/node-%3E%3D18-green) ![React](https://img.shields.io/badge/react-19-61DAFB)

---

## ✨ Features

- 🎙️ **Natural conversation** — No push-to-talk. Just speak. Gemini's server-side VAD (Voice Activity Detection) handles turn detection automatically.
- 🛑 **Barge-in / interruption** — Talk over the AI mid-response and it stops immediately, just like a real conversation.
- 🖥️ **Screen share** — Share your screen and the tutor can see what you're looking at in real time.
- 🔇 **Smart noise gate** — Ambient noise, keyboard clicks, and breathing are filtered out before reaching the AI.
- ☁️ **Snapshot to Cloud** — Save screen frames to Google Cloud Storage and log sessions to Firestore.
- 🌑 **Dark UI** — Animated agent orb that reacts to speaking states (listening / user speaking / agent speaking).

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│              Browser (React)                 │
│  ┌────────────────┐   ┌────────────────────┐│
│  │  Audio Worklet  │──▶│  useOmniTutor.js  ││
│  │ (mic-processor) │   │ (VAD, noise gate,  ││
│  └────────────────┘   │  barge-in logic)   ││
│                        └────────┬───────────┘│
└─────────────────────────────────┼────────────┘
                                  │ WebSocket
                    ┌─────────────▼────────────┐
                    │    Node.js Proxy Server   │
                    │       (server.js)         │
                    └─────────────┬────────────┘
                                  │ WebSocket
                    ┌─────────────▼────────────┐
                    │   Gemini Live API         │
                    │ gemini-2.5-flash-native   │
                    │       -audio-latest       │
                    └─────────────┬────────────┘
                                  │
                    ┌─────────────▼────────────┐
                    │  Google Cloud (optional)  │
                    │  GCS (snapshots)          │
                    │  Firestore (session logs) │
                    └──────────────────────────┘
```

**Why a proxy server?** The Gemini API key must never be exposed to the browser. The Node.js backend keeps it secret and relays the WebSocket traffic.

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| Gemini API Key | [Get one here](https://aistudio.google.com/app/apikey) |

### 1. Clone the repo

```bash
git clone https://github.com/your-username/omnitutor.git
cd omnitutor
```

### 2. Set up the backend

```bash
cd backend
npm install
```

Create a `.env` file:

```env
GEMINI_API_KEY=your_gemini_api_key_here

# Optional — only needed for snapshot/cloud features
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GCS_BUCKET_NAME=your-bucket-name
```

Start the server:

```bash
npm start
# Backend proxy running on port 5000
```

### 3. Set up the frontend

```bash
cd ../frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## 🎮 Usage

1. Open **http://localhost:5173**
2. Click **Connect Agent** to establish a WebSocket connection to Gemini
3. Click **Microphone** to start streaming audio
4. Just talk — the AI responds naturally
5. **Interrupt at any time** — speak while the AI is talking and it stops immediately
6. Optionally click **Share Screen** to let OmniTutor see your screen

---

## ⚙️ Configuration

### Noise Gate (Frontend)

In `frontend/src/hooks/useOmniTutor.js`:
```js
const NOISE_FLOOR = 0.03; // increase to filter more noise, decrease for sensitivity
```

### Gemini VAD (Backend)

In `backend/server.js` inside `realtimeInputConfig`:
```js
startOfSpeechSensitivity: "START_SENSITIVITY_LOW",  // LOW / MEDIUM / HIGH
endOfSpeechSensitivity:   "END_SENSITIVITY_LOW",
silenceDurationMs: 800      // ms of silence before response is triggered
```

### Voice

Change the agent voice in `backend/server.js`:
```js
voiceName: "Aoede"  // Options: Puck, Charon, Kore, Fenrir, Aoede, etc.
```

---

## 📁 Project Structure

```
omnitutor/
├── backend/
│   ├── server.js        # WebSocket proxy → Gemini Live API
│   ├── cloud.js         # GCS upload + Firestore logging
│   ├── Dockerfile
│   └── .env             # GEMINI_API_KEY (not committed)
│
└── frontend/
    ├── src/
    │   ├── App.jsx              # Main UI + animated agent orb
    │   └── hooks/
    │       └── useOmniTutor.js  # Core hook: audio, VAD, barge-in, streaming
    ├── public/
    │   └── mic-processor.js     # AudioWorklet: mic capture + 24kHz→16kHz downsample
    └── index.html
```

---

## ☁️ Cloud Features (Optional)

OmniTutor supports saving screen snapshots to **Google Cloud Storage** and logging sessions to **Firestore**.

To enable:

1. Create a GCP project and enable GCS + Firestore
2. Create a service account with `Storage Object Admin` and `Cloud Datastore User` roles
3. Download the JSON key and set `GOOGLE_APPLICATION_CREDENTIALS` in your `.env`
4. Create a GCS bucket and set `GCS_BUCKET_NAME` in your `.env`

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| AI | Gemini 2.5 Flash Native Audio (Live API) |
| Backend | Node.js, Express, `ws` |
| Frontend | React 19, Vite 7 |
| Audio | Web Audio API, AudioWorklet |
| Cloud (opt.) | Google Cloud Storage, Firestore |
| UI Icons | Lucide React |

---

## 📄 License

ISC © 2025 OmniTutor
