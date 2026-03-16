require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });


const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// The endpoint for the Gemini Live API
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

wss.on('connection', (clientWs) => {
    console.log('Frontend client connected to proxy');

    let geminiWs;

    if (!GEMINI_API_KEY) {
        clientWs.send(JSON.stringify({ error: "GEMINI_API_KEY is not set in backend." }));
        clientWs.close();
        return;
    }

    try {
        // Connect to Gemini
        geminiWs = new WebSocket(GEMINI_WS_URL);

        // Initial setup payload for Gemini (Live API typically expects a setup message first)
        geminiWs.on('open', () => {
            console.log("Connected to Gemini Live API");

            // Send initial setup message (optional but good for defining instructions)
            const setupMessage = {
                setup: {
                    model: "models/gemini-2.5-flash-native-audio-latest",
                    systemInstruction: {
                        parts: [{
                            text: "You are OmniTutor, a warm, natural AI tutor. You can see the user's screen and hear them. Speak in short, conversational sentences. Be concise but never cut off mid-thought. React naturally to interruptions — if the user speaks while you're talking, stop and listen immediately."
                        }]
                    },
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        temperature: 0.7,
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Aoede"
                                }
                            }
                        }
                    },
                    // 🔑 Server-side VAD: Gemini detects speech automatically and
                    // sends `interrupted` + `turnComplete` signals — no need for
                    // the client to send manual audioStreamEnd messages.
                    realtimeInputConfig: {
                        automaticActivityDetection: {
                            disabled: false,
                            // Lower sensitivity = less false triggers from env noise
                            startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
                            endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
                            prefixPaddingMs: 20,
                            silenceDurationMs: 800  // wait longer before assuming speech ended
                        }
                    }
                }
            };
            if (geminiWs.readyState === WebSocket.OPEN) {
                 geminiWs.send(JSON.stringify(setupMessage));
}
        });

    let setupLogged = false;

        geminiWs.on("message", (data) => {

          if (!setupLogged) {
            try {
            const msg = JSON.parse(data.toString());
            if (msg.setupComplete) {
                console.log("Gemini setup completed");
                setupLogged = true;
            }
        }   catch {}
    }

    if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data.toString());
    }

});

geminiWs.on('close', (code, reason) => {
    // Print the exact reason buffer as a string so we can see the Gemini error payload
    const reasonText = reason ? reason.toString() : "No reason";
    console.log("=========================================");
    console.log("Gemini connection closed.", code);
    console.log("REASON STRING:", reasonText);
    console.log("=========================================");

    if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
            error: "Gemini connection closed",
            details: reasonText
        }));
        clientWs.close();
    }
});

       geminiWs.on('error', (err) => {
         console.error("Gemini WS Error:", err);

       if (clientWs.readyState === WebSocket.OPEN) {
         clientWs.send(JSON.stringify({
         error: "Error communicating with Gemini."
        }));
    }
});

    } catch (e) {
        console.error("Failed to connect to Gemini", e);
    }

    // Relay messages from frontend to Gemini
    clientWs.on('message', (message) => {
        try {
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(message);
            }
        } catch (e) {
            console.error("Error forwarding message to Gemini:", e);
        }
    });

    clientWs.on('close', () => {
        console.log('Frontend client disconnected');
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });
});

const cloudService = require('./cloud');

app.get('/api/status', (req, res) => {
    res.json({ status: "OmniTutor proxy is running", geminiKeySet: !!GEMINI_API_KEY });
});

// Endpoint to upload a snapshot to GCS
app.post('/api/snapshot', async (req, res) => {
    const { imageBase64, sessionId } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "Missing imageBase64" });

    try {
        const publicUrl = await cloudService.uploadSnapshot(imageBase64, sessionId);
        res.json({ success: true, url: publicUrl });
    } catch (err) {
        console.error("Snapshot upload failed", err);
        // Fallback for when GCP credentials are not set
        res.status(500).json({ error: "Upload failed. Check GCP credentials." });
    }
});

server.listen(port, () => {
    console.log(`Backend proxy running on port ${port}`);
});
