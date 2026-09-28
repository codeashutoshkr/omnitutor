require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

// Safely require cloud service in case it is missing in the environment
let cloudService;
try {
    cloudService = require('./cloud');
} catch (e) {
    console.warn("⚠️  cloud.js not found. Snapshot upload endpoints will fail gracefully.");
}

const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

// Keepalive ping interval — prevents idle sessions from being dropped
const KEEPALIVE_INTERVAL_MS = 20000;

// ─────────────────────────────────────────────────────────────────────────────
// Gemini setup payload
//
// LATENCY OPTIMIZATION:
//   automaticActivityDetection.disabled = true
//   → Server-side VAD is OFF. The frontend sends { clientContent: { turnComplete: true } }
//     after 600ms of detected silence. This replaces the old 1000ms server-side
//     silence wait, cutting turn-start latency by ~700ms.
//
// QUALITY IMPROVEMENT:
//   Condensed system prompt (~220 words vs old ~600 words) — same behaviors,
//   fewer tokens = marginally faster first-response time from the model.
// ─────────────────────────────────────────────────────────────────────────────
const GEMINI_SETUP_MESSAGE = {
    setup: {
        model: "models/gemini-2.5-flash-native-audio-latest",
        systemInstruction: {
            parts: [{
                text: `You are OmniTutor, a friendly expert tutor for students of all levels. You speak through live voice and can see the student's screen in real time.

TEACHING STYLE:
- Give a SHORT direct answer first (1-2 sentences), then offer to go deeper.
- Use clear analogies and real-world examples.
- Be warm and encouraging.

SCREEN AWARENESS:
- When you see their screen, comment on what they're working on.
- Spot errors naturally.

CONVERSATION:
- Keep responses concise unless asked for a full explanation.
- React naturally to interruptions — stop immediately if the student speaks.`
            }]
        },
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Aoede"
                    }
                }
            }
        }
        // NOTE: No realtimeInputConfig override — using Gemini's built-in VAD.
        // This is the most reliable mode. Gemini detects speech and silence
        // automatically and responds when the user finishes speaking.
    }
};

wss.on('connection', (clientWs) => {
    console.log('📱 Frontend client connected to proxy');

    let geminiWs;
    let keepaliveTimer;

    if (!GEMINI_API_KEY) {
        clientWs.send(JSON.stringify({ error: "GEMINI_API_KEY is not set in backend." }));
        clientWs.close();
        return;
    }

    const cleanup = () => {
        if (keepaliveTimer) clearInterval(keepaliveTimer);
    };

    try {
        geminiWs = new WebSocket(GEMINI_WS_URL);

        geminiWs.on('open', () => {
            console.log("✅ Connected to Gemini Live API");
            const setupMsg = JSON.stringify(GEMINI_SETUP_MESSAGE);
            console.log("📤 Sending setup to Gemini:", setupMsg.substring(0, 200) + "...");
            geminiWs.send(setupMsg);

            keepaliveTimer = setInterval(() => {
                if (geminiWs.readyState === WebSocket.OPEN) {
                    try { geminiWs.ping(); } catch (e) { console.warn('Keepalive ping failed:', e.message); }
                }
            }, KEEPALIVE_INTERVAL_MS);
        });

        geminiWs.on("message", (data) => {
            const text = data.toString();
            try {
                const msg = JSON.parse(text);

                if (msg.setupComplete) {
                    console.log("🎓 Gemini session ready — automatic VAD active");
                } else if (msg.error) {
                    // This is critical — log full error details
                    console.error("❌ GEMINI ERROR:", JSON.stringify(msg.error, null, 2));
                } else if (msg.serverContent) {
                    if (msg.serverContent.turnComplete) {
                        console.log("✅ Gemini finished speaking (turnComplete)");
                    } else if (msg.serverContent.interrupted) {
                        console.log("🛑 Gemini interrupted");
                    } else if (msg.serverContent.modelTurn?.parts) {
                        console.log("🔊 Gemini audio chunk received");
                    }
                }
            } catch (e) {
                // Binary or non-JSON — ignore
            }

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(text);
            }
        });

        geminiWs.on('close', (code, reason) => {
            const reasonText = reason ? reason.toString() : "No reason provided";
            console.log("=========================================");
            console.log(`❌ Gemini connection closed. Code: ${code}`);
            console.log("Reason:", reasonText);
            console.log("=========================================");
            cleanup();

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ error: "Gemini connection closed", code, details: reasonText }));
                clientWs.close();
            }
        });

        geminiWs.on('error', (err) => {
            console.error("❌ Gemini WS Error:", err.message);
            cleanup();
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ error: "Error communicating with Gemini.", details: err.message }));
            }
        });

        geminiWs.on('pong', () => { /* connection healthy */ });

    } catch (e) {
        console.error("Failed to connect to Gemini", e);
        cleanup();
    }

    // ── Relay all messages from frontend → Gemini ───────────────────────────
    clientWs.on('message', (message) => {
        try {
            const text = message.toString();
            const parsed = JSON.parse(text);

            // Log what frontend is sending (skip verbose audio chunks)
            if (!parsed.realtimeInput?.mediaChunks) {
                console.log("📤 Frontend → Gemini:", text.substring(0, 200));
            }

            if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(text);
            }
        } catch (e) {
            console.error("Error forwarding message to Gemini:", e.message);
        }
    });

    clientWs.on('close', () => {
        console.log('📱 Frontend client disconnected');
        cleanup();
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });

    clientWs.on('error', (err) => {
        console.error('Client WS error:', err.message);
        cleanup();
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: "OmniTutor proxy is running",
        geminiKeySet: !!GEMINI_API_KEY,
        activeConnections: wss.clients.size
    });
});

// Endpoint to upload a snapshot to GCS
app.post('/api/snapshot', async (req, res) => {
    const { imageBase64, sessionId } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "Missing imageBase64" });

    try {
        if (!cloudService) {
            return res.status(500).json({ error: "Cloud service not configured." });
        }
        const publicUrl = await cloudService.uploadSnapshot(imageBase64, sessionId);
        res.json({ success: true, url: publicUrl });
    } catch (err) {
        console.error("Snapshot upload failed", err);
        res.status(500).json({ error: "Upload failed. Check GCP credentials." });
    }
});

server.listen(port, () => {
    console.log(`🚀 OmniTutor backend proxy running on port ${port}`);
});