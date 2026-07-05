require('dotenv').config();
const WebSocket = require('ws');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Connect to the BidiGenerateContent endpoint
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

// 1. Create the local Proxy Server that the React Canvas app will connect to
const wss = new WebSocket.Server({ port: 5000 }, () => {
    console.log("🚀 WebSocket Proxy Server running on ws://localhost:5000");
});

wss.on('connection', (clientWs) => {
    console.log("✅ React Frontend connected to Proxy.");

    // 2. Open a dedicated connection to Gemini for this client
    const geminiWs = new WebSocket(GEMINI_WS_URL);

    geminiWs.on('open', () => {
        console.log("🔗 Connected to Gemini Live API");
        
        const setupMessage = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-latest", 
                systemInstruction: {
                    parts: [{
                        text: "You are Omnitutor, a helpful AI tutor. You can see the user's screen and hear them. Respond in short, conversational sentences and help them step-by-step."
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
                }
            }
        };
        
        // Send initial configuration to Gemini
        geminiWs.send(JSON.stringify(setupMessage));
    });

    // 3. Route messages from Gemini -> React Frontend
    geminiWs.on('message', (data) => {
        const message = data.toString();
        
        if (message.includes("setupComplete")) {
            console.log("🎯 Gemini setup complete, ready for audio/vision input.");
        }

        // Pass the raw stringified JSON directly back to the Canvas UI
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(message);
        }
    });

    geminiWs.on('close', (code, reason) => {
        console.log("Gemini connection closed.", code, reason.toString());
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
        }
    });

    geminiWs.on('error', (err) => {
        console.error("Gemini WS Error:", err);
    });

    // 4. Route messages from React Frontend -> Gemini
    clientWs.on('message', (data) => {
        // The frontend sends perfectly formatted `realtimeInput` JSON objects
        // We just need to pipe them straight into Gemini
        if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(data.toString());
        }
    });

    clientWs.on('close', () => {
        console.log("❌ React Frontend disconnected.");
        if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });
});