require('dotenv').config();
const WebSocket = require('ws');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`

const geminiWs = new WebSocket(GEMINI_WS_URL);

geminiWs.on('open', () => {
    console.log("Connected to Gemini Live API");
    
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
            // encourage faster response
                maxOutputTokens: 120,
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
    geminiWs.send(JSON.stringify(setupMessage));
});

geminiWs.on('message', (data) => {

  const message = data.toString();

  if (message.includes("setupComplete")) {
    console.log("Gemini ready");
  }

  if (message.includes("error")) {
    console.log("Gemini error:", message);
  }

  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(message);
  }

});

geminiWs.on('close', (code, reason) => {
     console.log("Gemini connection closed.", code, reason.toString());
     process.exit(1);
});

geminiWs.on('error', (err) => {
     console.error("Gemini WS Error:", err);
     process.exit(1);
});
