import { useState, useRef, useCallback, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// useOmniTutor — Core hook for OmniTutor AI voice+screen tutoring agent
//
// Turn detection mode: MANUAL (client-driven)
//   Server has automaticActivityDetection.disabled = true
//   Client sends:
//     { realtimeInput: { activityStart: {} } }  — when user starts speaking
//     { realtimeInput: { activityEnd: {} } }    — after 600ms silence
//   Gemini responds immediately on activityEnd, saving ~700ms vs old 1000ms
//   server-side silence wait.
//
// Key notes on correct Gemini Live API v1alpha manual mode:
//   • Audio chunks: { realtimeInput: { mediaChunks: [...] } }
//   • Start signal: { realtimeInput: { activityStart: {} } }   ← NOT clientContent
//   • End signal:   { realtimeInput: { activityEnd: {} } }     ← NOT clientContent
//   • clientContent is TEXT mode only — sending it in audio mode closes connection
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_WS_URL = 'ws://localhost:5000';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

// RMS below this = silence/noise → gated to zero before sending to Gemini
const NOISE_GATE_RMS = 0.015;

// Peak amplitude above this = user is speaking (barge-in detection)
const BARGE_IN_THRESHOLD = 0.08;

// Silence hold before declaring turn done.
// 600ms covers natural mid-sentence pauses (<500ms) while still feeling fast.
const SPEECH_HOLD_MS = 600;

export function useOmniTutor() {
  const [isConnected, setIsConnected]         = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicActive, setIsMicActive]         = useState(false);
  const [agentSpeaking, setAgentSpeaking]     = useState(false);
  const [userSpeaking, setUserSpeaking]       = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [audioLevel, setAudioLevel]           = useState(0);

  const wsRef                      = useRef(null);
  const playbackAudioContextRef    = useRef(null);
  const recordingAudioContextRef   = useRef(null);
  const mediaStreamRef             = useRef(null);
  const audioStreamRef             = useRef(null);
  const workletLoadedRef           = useRef(false);
  const videoRef                   = useRef(null);
  const canvasRef                  = useRef(null);
  const frameIntervalRef           = useRef(null);
  const nextPlaybackTimeRef        = useRef(0);
  const scheduledSourcesRef        = useRef([]);
  const agentSpeakingRef           = useRef(false);
  const userSpeakingRef            = useRef(false);
  const reconnectAttemptsRef       = useRef(0);
  const reconnectTimerRef          = useRef(null);
  const userInitiatedDisconnectRef = useRef(false);
  const speechHoldTimerRef         = useRef(null);
  // Guards against sending activityEnd if the user never actually spoke this turn
  const activityStartedRef         = useRef(false);

  // ─── Helper: ArrayBuffer → Base64 ───────────────────────────────────────
  const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  };

  // ─── Stop all scheduled agent audio ─────────────────────────────────────
  const stopAgentAudio = useCallback(() => {
    scheduledSourcesRef.current.forEach(src => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    scheduledSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
    agentSpeakingRef.current = false;
    setAgentSpeaking(false);
  }, []);

  // ─── Stop all media streams ──────────────────────────────────────────────
  const stopMediaStreams = useCallback(() => {
    if (frameIntervalRef.current)   clearInterval(frameIntervalRef.current);
    if (speechHoldTimerRef.current) clearTimeout(speechHoldTimerRef.current);
    if (mediaStreamRef.current)     mediaStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioStreamRef.current)     audioStreamRef.current.getTracks().forEach(t => t.stop());

    if (recordingAudioContextRef.current) {
      recordingAudioContextRef.current.close().catch(() => {});
      recordingAudioContextRef.current = null;
    }

    workletLoadedRef.current = false;
    activityStartedRef.current = false;
    setIsMicActive(false);
    setIsScreenSharing(false);
    setUserSpeaking(false);
    setAudioLevel(0);
  }, []);

  // ─── PCM 24kHz Playback ──────────────────────────────────────────────────
  const playAudioChunk = useCallback((base64Audio) => {
    const audioCtx = playbackAudioContextRef.current;
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

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
    };

    const now = audioCtx.currentTime;
    if (nextPlaybackTimeRef.current < now) nextPlaybackTimeRef.current = now;
    const scheduleAt = Math.max(nextPlaybackTimeRef.current, now + 0.01);
    source.start(scheduleAt);
    nextPlaybackTimeRef.current = scheduleAt + buffer.duration;
  }, []);

  // ─── Send activity signals to Gemini (correct manual-mode API) ──────────
  const sendActivityStart = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
    console.log('🎤 activityStart → Gemini');
  }, []);

  const sendActivityEnd = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!activityStartedRef.current) return; // Safety: only end what was started
    wsRef.current.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    activityStartedRef.current = false;
    console.log('⏹ activityEnd → Gemini (agent will now respond)');
  }, []);

  // ─── WebSocket message handler ───────────────────────────────────────────
  const handleWsMessage = useCallback(async (event) => {
    let text;
    if (typeof event.data === 'string')  text = event.data;
    else if (event.data instanceof Blob) text = await event.data.text();
    else return;

    let response;
    try { response = JSON.parse(text); } catch { return; }

    if (response.serverContent?.interrupted) {
      console.log('🛑 Gemini interrupted — stopping agent audio');
      stopAgentAudio();
      return;
    }

    if (response.serverContent?.turnComplete) {
      console.log('✅ Gemini turn complete');
      agentSpeakingRef.current = false;
      setAgentSpeaking(false);
      return;
    }

    if (response.serverContent?.modelTurn?.parts) {
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

  // ─── Auto-reconnect ──────────────────────────────────────────────────────
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
      if (!userInitiatedDisconnectRef.current) connectWs(); // eslint-disable-line no-use-before-define
    }, RECONNECT_DELAY_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── WebSocket connect ───────────────────────────────────────────────────
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
      console.log(`Disconnected (code=${event.code})`);
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

  // ─── Microphone Streaming ────────────────────────────────────────────────
  const startMic = useCallback(async () => {
    try {
      if (isMicActive) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('Connect agent first.');
        return;
      }

      // Browser-native noise suppression + echo cancellation
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression:  true,
          echoCancellation:  true,
          autoGainControl:   true,
          sampleRate:        16000,
          channelCount:      1,
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
        const input = event.data; // Float32Array, 2048 samples @ 16kHz

        // ── RMS Noise Gate ───────────────────────────────────────────────
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
        const rms = Math.sqrt(sumSq / input.length);
        setAudioLevel(prev => prev * 0.7 + rms * 0.3);

        // Below noise floor → silence (blocks fan/keyboard/AC hum)
        const gatedInput = rms > NOISE_GATE_RMS ? input : new Float32Array(input.length);

        // ── Barge-in & Speech Detection ──────────────────────────────────
        let peak = 0;
        for (let i = 0; i < input.length; i++) {
          const a = Math.abs(input[i]);
          if (a > peak) peak = a;
        }
        const isSpeaking = peak > BARGE_IN_THRESHOLD;

        if (isSpeaking && !userSpeakingRef.current) {
          // Cancel any pending end-of-turn timer
          if (speechHoldTimerRef.current) {
            clearTimeout(speechHoldTimerRef.current);
            speechHoldTimerRef.current = null;
          }

          userSpeakingRef.current = true;
          setUserSpeaking(true);

          // Send activityStart to Gemini — correct manual-mode signal
          if (!activityStartedRef.current) {
            activityStartedRef.current = true;
            sendActivityStart();
          }

          // Barge-in: user spoke while agent was talking → stop local playback
          if (agentSpeakingRef.current) {
            console.log('🎤 Barge-in — stopping agent playback');
            stopAgentAudio();
            // Note: server VAD is disabled, so we don't need to send any
            // interrupt signal. activityStart above is enough — Gemini knows
            // user is speaking and will discard its pending generation.
          }
        }

        if (!isSpeaking && userSpeakingRef.current) {
          // Debounce: wait SPEECH_HOLD_MS of silence before ending the turn
          if (!speechHoldTimerRef.current) {
            speechHoldTimerRef.current = setTimeout(() => {
              userSpeakingRef.current = false;
              setUserSpeaking(false);
              speechHoldTimerRef.current = null;

              // ⚡ CLIENT-SIDE TURN END — correct Gemini Live API signal
              // This tells Gemini "user finished speaking, please respond."
              // Uses { realtimeInput: { activityEnd: {} } } — the only valid
              // way to signal end-of-turn in audio manual mode.
              sendActivityEnd();
            }, SPEECH_HOLD_MS);
          }
        } else if (isSpeaking && speechHoldTimerRef.current) {
          clearTimeout(speechHoldTimerRef.current);
          speechHoldTimerRef.current = null;
        }

        // ── Send PCM audio to Gemini ─────────────────────────────────────
        const pcm16 = new Int16Array(gatedInput.length);
        for (let i = 0; i < gatedInput.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767,
            Math.round(Math.max(-1, Math.min(1, gatedInput[i])) * 32767)
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

      console.log('🎤 Mic streaming started: 16kHz, noise-suppressed, manual turn detection (activityStart/End).');
    } catch (err) {
      console.error('Failed to start mic:', err);
      setIsMicActive(false);
    }
  }, [isMicActive, stopAgentAudio, sendActivityStart, sendActivityEnd]);

  // ─── Screen Sharing ──────────────────────────────────────────────────────
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
  }, [stopMediaStreams]); // eslint-disable-line react-hooks/exhaustive-deps

  const captureAndSendFrame = () => {
    if (!videoRef.current || !canvasRef.current ||
        !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Skip frame send while user is actively speaking — frees bandwidth for audio
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
    reconnectAttempt,
    audioLevel,
    videoRef,
    connect,
    disconnect,
    startMic,
    startScreenShare,
  };
}