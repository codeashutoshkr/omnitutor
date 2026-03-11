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
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

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
                            text: "You are OmniTutor, a helpful AI tutor. You can see the user's screen or camera and hear them. Respond in short, conversational sentences and help them step-by-step."
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
                }
            };
            geminiWs.send(JSON.stringify(setupMessage));
        });

        geminiWs.on('message', (data) => {
    console.log("Gemini message:", data.toString());

    if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data.toString());
    }
});

geminiWs.on('close', (code, reason) => {
    console.log("Gemini connection closed.", code, reason.toString());

    if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
            error: "Gemini connection closed"
        }));
        clientWs.close();
    }
});

        // Relay messages from Gemini to frontend
        geminiWs.on('message', (data) => {
            // Forward raw data or parsed JSON to the frontend
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data.toString());
            }
        });

        geminiWs.on('close', () => {
            console.log("Gemini connection closed.");
            if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });

        geminiWs.on('error', (err) => {
            console.error("Gemini WS Error:", err);
            clientWs.send(JSON.stringify({ error: "Error communicating with Gemini." }));
        });

    } catch (e) {
        console.error("Failed to connect to Gemini", e);
    }

    // Relay messages from frontend to Gemini
    clientWs.on('message', (message) => {
        try {
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(message.toString());
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
