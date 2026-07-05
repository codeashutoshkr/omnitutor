import { useState, useRef, useCallback, useEffect } from 'react';

export function useOmniTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  const wsRef = useRef(null);
  const playbackAudioContextRef = useRef(null);
  const recordingAudioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioStreamRef = useRef(null);
  const workletLoadedRef = useRef(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const nextPlaybackTimeRef = useRef(0);
  const scheduledSourcesRef = useRef([]);  
  const agentSpeakingRef = useRef(false); 
  const userSpeakingRef = useRef(false);

  // Helper: High-performance Uint8Array to Base64 conversion
  const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // ─── Stop all agent audio immediately ─────────────────────────────────────
  const stopAgentAudio = useCallback(() => {
    scheduledSourcesRef.current.forEach(src => {
      try { src.stop(); } catch { /* already stopped or finished */ }
    });
    scheduledSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
    agentSpeakingRef.current = false;
    setAgentSpeaking(false);
  }, []);

  // ─── WebSocket connect ─────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current) return;

    // Connect to your backend proxy architecture
    wsRef.current = new WebSocket('ws://localhost:5000');

    wsRef.current.onopen = () => {
      console.log('Connected to backend proxy');
      
      // Separate Playback context locked to Gemini's native 24kHz output
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

    wsRef.current.onmessage = async (event) => {
      let text;
      if (typeof event.data === 'string') text = event.data;
      else if (event.data instanceof Blob) text = await event.data.text();
      else return;

      let response;
      try { response = JSON.parse(text); } catch { return; }

      // 1. Interrupted signal from Server VAD
      if (response.serverContent?.interrupted) {
        console.log('🛑 Gemini interrupted — stopping agent audio');
        stopAgentAudio();
        return;
      }

      // 2. Turn complete
      if (response.serverContent?.turnComplete) {
        console.log('✅ Gemini turn complete');
        agentSpeakingRef.current = false;
        setAgentSpeaking(false);
        return;
      }

      // 3. Playback incoming streaming audio blocks
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

  const stopMediaStreams = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
    
    if (recordingAudioContextRef.current) {
      recordingAudioContextRef.current.close().catch(() => {});
      recordingAudioContextRef.current = null;
    }
    
    workletLoadedRef.current = false;
    setIsMicActive(false);
    setIsScreenSharing(false);
    setUserSpeaking(false);
  };

  // ─── PCM 24kHz Audio Playback Output ──────────────────────────────────────
  const playAudioChunk = (base64Audio) => {
    const audioCtx = playbackAudioContextRef.current;
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    const binary = window.atob(base64Audio);
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

    scheduledSourcesRef.current.push(source);
    source.onended = () => {
      scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
    };

    const now = audioCtx.currentTime;
    if (nextPlaybackTimeRef.current < now) nextPlaybackTimeRef.current = now;
    const scheduleAt = Math.max(nextPlaybackTimeRef.current, now + 0.01); // Reduced scheduling pad
    source.start(scheduleAt);
    nextPlaybackTimeRef.current = scheduleAt + buffer.duration;
  };

  // ─── Microphone Streaming ──────────────────────────────────────────────────
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

      // CRITICAL FIX: Lock recording context strictly to 16000Hz to match the Gemini model input API requirement
      const recordingContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      recordingAudioContextRef.current = recordingContext;

      if (!workletLoadedRef.current) {
        await recordingContext.audioWorklet.addModule('/mic-processor.js');
        workletLoadedRef.current = true;
      }

      const source = recordingContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(recordingContext, 'mic-processor');

      const silentGain = recordingContext.createGain();
      silentGain.gain.value = 0;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(recordingContext.destination);

      workletNode.port.onmessage = (event) => {
        const input = event.data;
        const isSpeaking = input.some(v => Math.abs(v) > 0.04);

        // Client-Side Interruption (Barge-In)
        if (isSpeaking && !userSpeakingRef.current) {
          userSpeakingRef.current = true;
          setUserSpeaking(true);

          if (agentSpeakingRef.current) {
            console.log('🎤 User barged in — killing local playback tracks');
            stopAgentAudio();
            
            // Send client side cancellation request over the WebSocket if proxy supports it
            wsRef.current.send(JSON.stringify({ clientContent: { turnComplete: false, interrupted: true } }));
          }
        }

        if (!isSpeaking && userSpeakingRef.current) {
          userSpeakingRef.current = false;
          setUserSpeaking(false);
        }

        // Noise gate floor optimization
        const NOISE_FLOOR = 0.03;
        let rms = 0;
        for (let i = 0; i < input.length; i++) rms += input[i] * input[i];
        rms = Math.sqrt(rms / input.length);
        const gatedInput = rms > NOISE_FLOOR ? input : new Float32Array(input.length);

        // Fast Float32 to Int16 Conversion
        const pcm16 = new Int16Array(gatedInput.length);
        for (let i = 0; i < gatedInput.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, gatedInput[i])) * 32767;
        }

        // Fast allocation-free Base64 conversion
        const base64 = arrayBufferToBase64(pcm16.buffer);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }]
            }
          }));
        }
      };

      console.log('Microphone streaming successfully initialized at 16kHz.');
    } catch (err) {
      console.error('Failed to start mic:', err);
    }
  };

  // ─── Screen Sharing with Downscaled Dimensions ─────────────────────────────
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5 } } // Throttled native frame collection rate
      });

      stream.getVideoTracks()[0].onended = () => { stopMediaStreams(); };

      setIsScreenSharing(true);
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }

        // Poll frames down to a balanced 1 frame per second to protect token window
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
    
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      // OPTIMIZATION: Downscale image frame boundaries down to ~768px box to save network + engine processing latency
      const MAX_DIMENSION = 768;
      let targetWidth = video.videoWidth;
      let targetHeight = video.videoHeight;

      if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
        if (targetWidth > targetHeight) {
          targetHeight = Math.round((targetHeight * MAX_DIMENSION) / targetWidth);
          targetWidth = MAX_DIMENSION;
        } else {
          targetWidth = Math.round((targetWidth * MAX_DIMENSION) / targetHeight);
          targetHeight = MAX_DIMENSION;
        }
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
      
      // Extract compressed visual chunk string data
      const base64Img = canvas.toDataURL('image/jpeg', 0.2).split(',')[1];
      
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