import { useState, useRef, useCallback, useEffect } from 'react';

export function useOmniTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioStreamRef = useRef(null);
  const workletLoadedRef = useRef(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const nextPlaybackTimeRef = useRef(0);
  const scheduledSourcesRef = useRef([]);  // track all scheduled audio sources
  const agentSpeakingRef = useRef(false); // sync ref for audio callbacks
  const userSpeakingRef = useRef(false);

  // ─── Stop all agent audio immediately ─────────────────────────────────────
  const stopAgentAudio = useCallback(() => {
    // Cancel every scheduled audio source
    scheduledSourcesRef.current.forEach(src => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    scheduledSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
    agentSpeakingRef.current = false;
    setAgentSpeaking(false);
  }, []);

  // ─── WebSocket connect ─────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current) return;

    wsRef.current = new WebSocket('ws://localhost:5000');

    wsRef.current.onopen = () => {
      console.log('Connected to backend proxy');
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000
        });
      }
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      setIsConnected(true);
    };

    wsRef.current.onmessage = async (event) => {
      let text;
      if (typeof event.data === 'string') text = event.data;
      else if (event.data instanceof Blob) text = await event.data.text();
      else return;

      let response;
      try { response = JSON.parse(text); } catch { return; }

      // ── 1. Interrupted signal: user spoke → cancel agent audio immediately
      if (response.serverContent?.interrupted) {
        console.log('🛑 Gemini interrupted — stopping agent audio');
        stopAgentAudio();
        return;
      }

      // ── 2. Turn complete: AI finished its response
      if (response.serverContent?.turnComplete) {
        console.log('✅ Gemini turn complete');
        agentSpeakingRef.current = false;
        setAgentSpeaking(false);
        return;
      }

      // ── 3. Audio parts: stream and schedule audio chunks
      if (response.serverContent?.modelTurn?.parts) {
        const parts = response.serverContent.modelTurn.parts;

        for (const part of parts) {
          if (part.inlineData?.data) {
            // Mark agent as speaking on first audio chunk
            if (!agentSpeakingRef.current) {
              agentSpeakingRef.current = true;
              setAgentSpeaking(true);
            }
            playAudioChunk(part.inlineData.data);
          }
        }
      }

    };

    wsRef.current.onclose = () => {
      console.log('Disconnected');
      setIsConnected(false);
      setAgentSpeaking(false);
      setUserSpeaking(false);
      wsRef.current = null;
    };

    wsRef.current.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }, [stopAgentAudio]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopAgentAudio();
    stopMediaStreams();
  }, [stopAgentAudio]);

  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  // ─── Stop screen / mic streams ─────────────────────────────────────────────
  const stopMediaStreams = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
    setIsMicActive(false);
    setIsScreenSharing(false);
    setUserSpeaking(false);
  };

  // ─── PCM audio playback (seamlessly scheduled) ────────────────────────────
  const playAudioChunk = (base64Audio) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000
      });
    }

    const audioCtx = audioContextRef.current;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });

    // Decode base64 → PCM16 → Float32
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

    const buffer = audioCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    // Track source so we can cancel it on interrupt
    scheduledSourcesRef.current.push(source);
    source.onended = () => {
      scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
    };

    // Seamless gapless scheduling
    const now = audioCtx.currentTime;
    if (nextPlaybackTimeRef.current < now) nextPlaybackTimeRef.current = now;
    const scheduleAt = Math.max(nextPlaybackTimeRef.current, now + 0.02);
    source.start(scheduleAt);
    nextPlaybackTimeRef.current = scheduleAt + buffer.duration;
  };

  // ─── Microphone ────────────────────────────────────────────────────────────
  const startMic = async () => {
    try {
      if (isMicActive) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('Connect agent first.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setIsMicActive(true);

      const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') await audioContext.resume();

      if (!workletLoadedRef.current) {
        await audioContext.audioWorklet.addModule('/mic-processor.js');
        workletLoadedRef.current = true;
      }

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'mic-processor');

      // Silent output (we don't want to hear ourselves)
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      workletNode.port.onmessage = (event) => {
        const input = event.data;

        // ── Barge-in detection: if user speaks while agent is talking, stop agent
        const isSpeaking = input.some(v => Math.abs(v) > 0.04);

        if (isSpeaking && !userSpeakingRef.current) {
          userSpeakingRef.current = true;
          setUserSpeaking(true);

          // If agent was speaking, stop it immediately (local barge-in)
          if (agentSpeakingRef.current) {
            console.log('🎤 User barged in — stopping agent audio locally');
            stopAgentAudio();
          }
        }

        if (!isSpeaking && userSpeakingRef.current) {
          userSpeakingRef.current = false;
          setUserSpeaking(false);
        }

        // ── Noise gate: compute RMS energy; if below floor send silence
        // This prevents ambient noise / breathing from triggering Gemini's VAD
        const NOISE_FLOOR = 0.03; // tune: lower = more sensitive, higher = stricter
        let rms = 0;
        for (let i = 0; i < input.length; i++) rms += input[i] * input[i];
        rms = Math.sqrt(rms / input.length);
        const gatedInput = rms > NOISE_FLOOR ? input : new Float32Array(input.length); // zeros if silent

        // ── Stream raw PCM to backend → Gemini (always, no silence gating)
        // Gemini's server-side VAD decides when the user has finished speaking.
        const pcm16 = new Int16Array(gatedInput.length);
        for (let i = 0; i < gatedInput.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, gatedInput[i])) * 32767;
        }

        const uint8 = new Uint8Array(pcm16.buffer);
        let binary = '';
        const chunkSize = 0x6000; // 24 KB
        for (let i = 0; i < uint8.length; i += chunkSize) {
          binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }]
            }
          }));
        }
      };

      console.log('Microphone streaming started (continuous — server VAD active)');
    } catch (err) {
      console.error('Failed to start mic:', err);
    }
  };

  // ─── Screen share ──────────────────────────────────────────────────────────
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10 } }
      });

      stream.getVideoTracks()[0].onended = () => { stopMediaStreams(); };

      setIsScreenSharing(true);
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }
        // Send a frame every second
        frameIntervalRef.current = setInterval(() => {
          captureAndSendFrame();
        }, 1000);
      }
    } catch (err) {
      console.error('Failed to share screen:', err);
    }
  };

  const captureAndSendFrame = () => {
    if (!videoRef.current || !canvasRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Img = canvas.toDataURL('image/jpeg', 0.15).split(',')[1];
      wsRef.current.send(JSON.stringify({
        realtimeInput: { mediaChunks: [{ mimeType: 'image/jpeg', data: base64Img }] }
      }));
    }
  };

  return {
    isConnected,
    isScreenSharing,
    isMicActive,
    agentSpeaking,
    userSpeaking,
    videoRef,
    connect,
    disconnect,
    startMic,
    startScreenShare
  };
}