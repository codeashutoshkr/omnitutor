import { useState, useRef, useCallback, useEffect } from 'react';

export function useOmniTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioStreamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const frameIntervalRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current) return;
    
    wsRef.current = new WebSocket('ws://localhost:5000');
    
    wsRef.current.onopen = () => {
      console.log('Connected to backend proxy');
      setIsConnected(true);
    };
    
    wsRef.current.onmessage = async (event) => {
        // Handle incoming messages from Gemini (e.g. audio chunks, text)
        const response = JSON.parse(event.data);
        if (response.serverContent?.modelTurn) {
            const parts = response.serverContent.modelTurn.parts;
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    // It's base64 audio
                    playAudioChunk(part.inlineData.data);
                }
            }
        }
    };
    
    wsRef.current.onclose = () => {
      console.log('Disconnected');
      setIsConnected(false);
      wsRef.current = null;
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
    }
    stopMediaStreams();
  }, []);
  
  const stopMediaStreams = () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
      setIsMicActive(false);
      setIsScreenSharing(false);
  };

  const playAudioChunk = async (base64Audio) => {
      if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      const audioCtx = audioContextRef.current;
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
      }
      
      try {
          // Note: Gemini Live API returns pcm_16le 24kHz.
          // This is a simplified fallback if it returns standard wav/mp3.
          // A proper PCM16 decoder is often required for raw PCM data.
          const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          source.start();
      } catch (e) {
          console.error("Audio playback error:", e);
      }
  };

 const startMic = async () => {
  try {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("Connect agent first.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioStreamRef.current = stream;
    setIsMicActive(true);

    audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    const audioContext = audioContextRef.current;

    const source = audioContext.createMediaStreamSource(stream);

    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);

      const pcm16 = new Int16Array(input.length);

      for (let i = 0; i < input.length; i++) {
        pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
      }

      const base64 = btoa(
        String.fromCharCode(...new Uint8Array(pcm16.buffer))
      );

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: "audio/pcm",
                  data: base64
                }
              ]
            }
          })
        );
      }
    };

    console.log("Microphone streaming started");

  } catch (err) {
    console.error("Failed to start mic:", err);
  }
};
  const startScreenShare = async () => {
      try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10 } } });
          setIsScreenSharing(true);
          mediaStreamRef.current = stream;
          if (videoRef.current) {
              videoRef.current.srcObject = stream;
              
              // Start frame extraction loop
              if (!canvasRef.current) {
                  canvasRef.current = document.createElement('canvas');
              }
              // Send a frame every 1 second
              frameIntervalRef.current = setInterval(() => {
                  captureAndSendFrame();
              }, 1000);
          }
      } catch (err) {
          console.error("Failed to share screen:", err);
      }
  };
  
  const captureAndSendFrame = () => {
      if (!videoRef.current || !canvasRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (video.videoWidth > 0 && video.videoHeight > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64Img = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
          // Send image frame in the schema Gemini Multimodal expects
          wsRef.current.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: base64Img }] }
          }));
      }
  };

  return {
    isConnected,
    isScreenSharing,
    isMicActive,
    videoRef,
    connect,
    disconnect,
    startMic,
    startScreenShare
  };
}
