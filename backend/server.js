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
- Give a SHORT direct answer first (1-2 sentences), then offer to go deeper: "Want me to explain further?"
- Adapt to any subject or question length — simple factual answers to complex multi-step explanations.
- Use clear analogies and real-world examples. Avoid jargon unless the student uses it first.
- Guide students to think through problems themselves rather than just handing them answers.
- Be warm and encouraging — learning is hard, praise effort and progress.
- If the student is confused, slow down and break the problem into smaller steps.

SCREEN AWARENESS:
- When you see their screen, proactively comment: "I can see you're working on [topic]..."
- Spot and mention errors naturally: "I noticed on line X there might be an issue with..."
- If no screen is shared, encourage them to share it for better help.

CONVERSATION:
- Keep responses concise unless the student explicitly asks for a full explanation.
- React naturally to interruptions — stop immediately if the student speaks.
- Match your pace to the student — faster for quick questions, slower for complex topics.`
            }]
        },
        generationConfig: {
            responseModalities: ["AUDIO"],
            temperature: 0.6,
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Aoede"
                    }
                }
            }
        },
        // ── Manual Turn Detection (client-driven) ──────────────────────────
        // Server-side VAD disabled. The frontend hook (useOmniTutor.js) sends:
        //   { realtimeInput: { activityStart: {} } } — when user starts speaking
        //   { realtimeInput: { activityEnd: {} } }   — after 600ms of silence
        // Gemini responds immediately on activityEnd — no 1000ms server wait.
        realtimeInputConfig: {
            automaticActivityDetection: {
                disabled: true
            }
        }
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
            geminiWs.send(JSON.stringify(GEMINI_SETUP_MESSAGE));

            // Keepalive ping every 20s — prevents idle WebSocket timeout
            keepaliveTimer = setInterval(() => {
                if (geminiWs.readyState === WebSocket.OPEN) {
                    try {
                        geminiWs.ping();
                    } catch (e) {
                        console.warn('Keepalive ping failed:', e.message);
                    }
                }
            }, KEEPALIVE_INTERVAL_MS);
        });

        let setupLogged = false;

        geminiWs.on("message", (data) => {
            if (!setupLogged) {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.setupComplete) {
                        console.log("🎓 Gemini OmniTutor session ready (manual turn detection active)");
                        setupLogged = true;
                    }
                } catch (e) {}
            }

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data.toString());
            }
        });

        geminiWs.on('close', (code, reason) => {
            const reasonText = reason ? reason.toString() : "No reason provided";
            console.log("=========================================");
            console.log(`Gemini connection closed. Code: ${code}`);
            console.log("Reason:", reasonText);
            console.log("=========================================");
            cleanup();

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    error: "Gemini connection closed",
                    code,
                    details: reasonText
                }));
                clientWs.close();
            }
        });

        geminiWs.on('error', (err) => {
            console.error("Gemini WS Error:", err.message);
            cleanup();

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    error: "Error communicating with Gemini.",
                    details: err.message
                }));
            }
        });

        geminiWs.on('pong', () => {
            // Pong received — connection healthy
        });

    } catch (e) {
        console.error("Failed to connect to Gemini", e);
        cleanup();
    }

    // ── Relay all messages from frontend → Gemini ─────────────────────────
    clientWs.on('message', (message) => {
        try {
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(message.toString());
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