import { useState, useRef, useCallback, useEffect } from 'react';

const BACKEND_WS_URL = 'ws://localhost:5000';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

// ── Pure-JS VAD — used only for barge-in and UI feedback ──────────────────────
// We do NOT send turn signals: Gemini's built-in VAD handles turn detection.
// This VAD only stops agent audio when user starts talking (barge-in).
const VAD_SPEECH_THRESHOLD  = 0.01;  // RMS above this = speech
const VAD_SILENCE_THRESHOLD = 0.008; // RMS below this = silence
const VAD_SPEECH_MIN_FRAMES = 3;     // consecutive loud frames before confirming speech

export function useOmniTutor() {
  const [isConnected, setIsConnected]           = useState(false);
  const [isScreenSharing, setIsScreenSharing]   = useState(false);
  const [isMicActive, setIsMicActive]           = useState(false);
  const [agentSpeaking, setAgentSpeaking]       = useState(false);
  const [userSpeaking, setUserSpeaking]         = useState(false);
  const [isThinking, setIsThinking]             = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [audioLevel, setAudioLevel]             = useState(0);

  const wsRef                      = useRef(null);
  const playbackAudioContextRef    = useRef(null);
  const recordingAudioContextRef   = useRef(null);
  const audioStreamRef             = useRef(null);
  const mediaStreamRef             = useRef(null);
  const workletLoadedRef           = useRef(false);
  const videoRef                   = useRef(null);
  const canvasRef                  = useRef(null);
  const frameIntervalRef           = useRef(null);
  const nextPlaybackTimeRef        = useRef(0);
  const scheduledSourcesRef        = useRef([]);
  const agentSpeakingRef           = useRef(false);
  const reconnectAttemptsRef       = useRef(0);
  const reconnectTimerRef          = useRef(null);
  const thinkingTimeoutRef         = useRef(null);
  const userInitiatedDisconnectRef = useRef(false);
  const userSpeakingRef            = useRef(false);

  // VAD state
  const vadSpeechFrameCountRef = useRef(0);
  const vadSilentFrameCountRef = useRef(0);

  // ─── Helper: ArrayBuffer → Base64 ─────────────────────────────────────────
  const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // ─── Stop all scheduled agent audio ───────────────────────────────────────
  const stopAgentAudio = useCallback(() => {
    scheduledSourcesRef.current.forEach(src => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    scheduledSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
    agentSpeakingRef.current = false;
    setAgentSpeaking(false);
    setIsThinking(false);
    if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
  }, []);

  // ─── Stop all media streams ────────────────────────────────────────────────
  const stopMediaStreams = useCallback(() => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
    if (recordingAudioContextRef.current) {
      recordingAudioContextRef.current.close().catch(() => {});
      recordingAudioContextRef.current = null;
    }
    workletLoadedRef.current = false;
    vadSpeechFrameCountRef.current = 0;
    vadSilentFrameCountRef.current = 0;
    setIsMicActive(false);
    setIsScreenSharing(false);
    setUserSpeaking(false);
    setIsThinking(false);
    userSpeakingRef.current = false;
    setAudioLevel(0);
  }, []);

  // ─── PCM 24kHz Playback ────────────────────────────────────────────────────
  const playAudioChunk = useCallback((base64Audio) => {
    const audioCtx = playbackAudioContextRef.current;
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    try {
      const binary = window.atob(base64Audio);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const pcm16   = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

      const buffer = audioCtx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);

      scheduledSourcesRef.current.push(source);
      source.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
        if (scheduledSourcesRef.current.length === 0) {
          agentSpeakingRef.current = false;
          setAgentSpeaking(false);
          setIsThinking(false);
        }
      };

      const now = audioCtx.currentTime;
      if (nextPlaybackTimeRef.current < now) nextPlaybackTimeRef.current = now;
      const scheduleAt = Math.max(nextPlaybackTimeRef.current, now + 0.01);
      source.start(scheduleAt);
      nextPlaybackTimeRef.current = scheduleAt + buffer.duration;
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  }, []);

  // ─── WebSocket message handler ─────────────────────────────────────────────
  const handleWsMessage = useCallback(async (event) => {
    let text;
    if (typeof event.data === 'string')  text = event.data;
    else if (event.data instanceof Blob) text = await event.data.text();
    else return;

    let response;
    try { response = JSON.parse(text); } catch { return; }

    if (response.error) {
      console.error('❌ Error from backend/Gemini:', JSON.stringify(response));
      setIsThinking(false);
      if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
      return;
    }

    if (response.serverContent?.interrupted) {
      stopAgentAudio();
      setIsThinking(false);
      if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
      return;
    }

    if (response.serverContent?.turnComplete) {
      agentSpeakingRef.current = false;
      setAgentSpeaking(false);
      setIsThinking(false);
      if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
      return;
    }

    if (response.serverContent?.modelTurn?.parts) {
      // First part arrived — stop thinking, agent is now responding
      setIsThinking(false);
      if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);

      const parts = response.serverContent.modelTurn.parts;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (!agentSpeakingRef.current) {
            agentSpeakingRef.current = true;
            setAgentSpeaking(true);
          }
          playAudioChunk(part.inlineData.data);
        }
      }
    }
  }, [stopAgentAudio, playAudioChunk]);

  // ─── Auto-reconnect ────────────────────────────────────────────────────────
  const scheduleReconnect = useCallback(() => {
    if (userInitiatedDisconnectRef.current) return;
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('Max reconnect attempts reached.');
      return;
    }
    reconnectAttemptsRef.current += 1;
    setReconnectAttempt(reconnectAttemptsRef.current);
    console.log(`🔄 Reconnecting (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})…`);
    reconnectTimerRef.current = setTimeout(() => {
      if (!userInitiatedDisconnectRef.current) connectWs(); // eslint-disable-line
    }, RECONNECT_DELAY_MS);
  }, []); // eslint-disable-line

  // ─── WebSocket connect ─────────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    wsRef.current = new WebSocket(BACKEND_WS_URL);

    wsRef.current.onopen = () => {
      console.log('✅ Connected to backend proxy');
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);

      if (!playbackAudioContextRef.current) {
        playbackAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000
        });
      }
      if (playbackAudioContextRef.current?.state === 'suspended') {
        playbackAudioContextRef.current.resume();
      }
      setIsConnected(true);
    };

    wsRef.current.onmessage = handleWsMessage;

    wsRef.current.onclose = (event) => {
      console.log(`WebSocket closed (code=${event.code})`);
      setIsConnected(false);
      setAgentSpeaking(false);
      setUserSpeaking(false);
      wsRef.current = null;
      if (!userInitiatedDisconnectRef.current) scheduleReconnect();
    };

    wsRef.current.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }, [handleWsMessage, scheduleReconnect]);

  const connect = useCallback(() => {
    userInitiatedDisconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);
    connectWs();
  }, [connectWs]);

  const disconnect = useCallback(() => {
    userInitiatedDisconnectRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    stopAgentAudio();
    stopMediaStreams();
    setIsConnected(false);
    setReconnectAttempt(0);
    reconnectAttemptsRef.current = 0;
  }, [stopAgentAudio, stopMediaStreams]);

  useEffect(() => {
    return () => {
      userInitiatedDisconnectRef.current = true;
      disconnect();
    };
  }, [disconnect]);

  // ─── Microphone Streaming ──────────────────────────────────────────────────
  const startMic = useCallback(async () => {
    try {
      if (isMicActive) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('Connect agent first.');
        return;
      }

      // If agent is speaking, interrupt it
      stopAgentAudio();
      setIsThinking(false);
      if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl:  true,
          channelCount:     1,
          sampleRate:       16000,
        }
      });

      audioStreamRef.current = stream;
      setIsMicActive(true);

      const recordingContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
      recordingAudioContextRef.current = recordingContext;

      if (!workletLoadedRef.current) {
        await recordingContext.audioWorklet.addModule('/mic-processor.js');
        workletLoadedRef.current = true;
      }

      const source      = recordingContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(recordingContext, 'mic-processor');
      const silentGain  = recordingContext.createGain();
      silentGain.gain.value = 0;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(recordingContext.destination);

      workletNode.port.onmessage = (event) => {
        const input = event.data; // Float32Array (2048 samples @ 16kHz = 128ms)

        // ── Compute RMS ─────────────────────────────────────────────────────
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
        const rms = Math.sqrt(sumSq / input.length);
        setAudioLevel(prev => prev * 0.7 + rms * 0.3);

        // ── Barge-in VAD: detect speech to stop agent audio ─────────────────
        if (rms > VAD_SPEECH_THRESHOLD) {
          vadSpeechFrameCountRef.current++;
          vadSilentFrameCountRef.current = 0;
          if (vadSpeechFrameCountRef.current >= VAD_SPEECH_MIN_FRAMES && !userSpeakingRef.current) {
            userSpeakingRef.current = true;
            setUserSpeaking(true);
            if (agentSpeakingRef.current) {
              console.log('🎤 Barge-in — stopping agent');
              stopAgentAudio();
            }
          }
        } else if (rms < VAD_SILENCE_THRESHOLD) {
          vadSilentFrameCountRef.current++;
          vadSpeechFrameCountRef.current = 0;
          if (vadSilentFrameCountRef.current >= VAD_SPEECH_MIN_FRAMES && userSpeakingRef.current) {
            userSpeakingRef.current = false;
            setUserSpeaking(false);
          }
        }

        // ── Convert Float32 → PCM16 and send to Gemini ──────────────────────
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767,
            Math.round(Math.max(-1, Math.min(1, input[i])) * 32767)
          ));
        }
        const base64 = arrayBufferToBase64(pcm16.buffer);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }]
            }
          }));
        }
      };

      console.log('🎤 Mic ON — listening to user');
    } catch (err) {
      console.error('Failed to start mic:', err);
      setIsMicActive(false);
    }
  }, [isMicActive, stopAgentAudio]);

  // ─── Stop Microphone & Signal Turn Complete ────────────────────────────────
  const stopMic = useCallback(() => {
    // 1. Send silent PCM buffer frames to cleanly trigger Gemini's built-in VAD
    // Note: Do NOT send clientContent { turnComplete: true } here, as Gemini Bidi
    // rejects empty clientContent with 1007 "Request contains an invalid argument".
    // Sending trailing silence is the standard way Gemini VAD detects utterance completion.
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        const silenceChunk = new Int16Array(2048); // 128ms of clean 16kHz silence
        const silenceBase64 = arrayBufferToBase64(silenceChunk.buffer);
        for (let i = 0; i < 4; i++) {
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: silenceBase64 }]
            }
          }));
        }
        console.log('⏹ Mic stopped → Trailing silence sent, awaiting Gemini response');
      } catch (err) {
        console.error('Error sending trailing silence:', err);
      }
    }

    // 2. Shut down microphone hardware tracks immediately
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }

    // 3. Clean up recording audio context
    if (recordingAudioContextRef.current) {
      recordingAudioContextRef.current.close().catch(() => {});
      recordingAudioContextRef.current = null;
    }

    workletLoadedRef.current = false;
    vadSpeechFrameCountRef.current = 0;
    vadSilentFrameCountRef.current = 0;
    userSpeakingRef.current = false;
    setUserSpeaking(false);
    setAudioLevel(0);
    setIsMicActive(false);

    // 4. Enter thinking state — agent is now processing & analyzing
    setIsThinking(true);
    if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
    thinkingTimeoutRef.current = setTimeout(() => {
      setIsThinking(false);
    }, 15000);
  }, []);

  // ─── Screen Sharing ────────────────────────────────────────────────────────
  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 5 } }
      });

      stream.getVideoTracks()[0].onended = () => stopMediaStreams();
      setIsScreenSharing(true);
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        if (!canvasRef.current) canvasRef.current = document.createElement('canvas');

        frameIntervalRef.current = setInterval(() => {
          captureAndSendFrame();
        }, 1000);
      }
    } catch (err) {
      console.error('Failed to share screen:', err);
    }
  }, [stopMediaStreams]);

  const captureAndSendFrame = () => {
    if (!videoRef.current || !canvasRef.current ||
        !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (userSpeakingRef.current) return;

    const video  = videoRef.current;
    const canvas = canvasRef.current;

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const MAX_DIM = 768;
      let w = video.videoWidth;
      let h = video.videoHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; }
        else       { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }
      }
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      const base64Img = canvas.toDataURL('image/jpeg', 0.25).split(',')[1];
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
    isThinking,
    reconnectAttempt,
    audioLevel,
    videoRef,
    connect,
    disconnect,
    startMic,
    stopMic,
    startScreenShare,
  };
}
