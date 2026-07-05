import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Video, Mic, MonitorUp, Wifi, WifiOff, CloudUpload, MicOff } from 'lucide-react';

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
        // 1. Lowered barge-in sensitivity to 0.01 so it detects normal human speech volume
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

        // 2. CRITICAL FIX: Removed the mathematical Noise Gate. 
        // It was aggressively zeroing out the audio array, meaning Gemini received pure silence!
        // We now convert and send the raw input directly to Gemini.
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
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

function App() {
  const {
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
  } = useOmniTutor();

  const [uploadStatus, setUploadStatus] = useState('');

  const handleSnapshot = async () => {
    // Ensure the video is actually playing and has data before taking a snapshot
    if (!isScreenSharing || !videoRef.current || videoRef.current.readyState < 2) return;
    
    setUploadStatus('Saving...');
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const base64Img = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

      const response = await fetch('http://localhost:5000/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Img, sessionId: 'demo-session-1' })
      });

      if (response.ok) {
        setUploadStatus('Saved to Cloud!');
        setTimeout(() => setUploadStatus(''), 3000);
      } else {
        setUploadStatus('Failed. Check credentials.');
      }
    } catch (e) {
      console.error(e);
      setUploadStatus('Upload Error');
    }
  };

  /* ── Derive agent orb state ─────────────────────────────────────────────── */
  const orbState = !isConnected
    ? 'offline'
    : userSpeaking
      ? 'user-speaking'
      : agentSpeaking
        ? 'agent-speaking'
        : 'listening';

  const statusLabel = {
    offline:        'Agent Offline',
    listening:      'Listening…',
    'user-speaking':'Hearing you…',
    'agent-speaking':'OmniTutor is speaking…',
  }[orbState];

  const statusSub = {
    offline:        'Connect to start a tutoring session',
    listening:      'Ready — just start talking naturally',
    'user-speaking':'Keep talking, you can interrupt anytime',
    'agent-speaking':'Speak to interrupt at any time',
  }[orbState];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col font-sans selection:bg-indigo-500/30">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <span className="font-bold tracking-tight text-white text-sm">OT</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">OmniTutor</h1>
          </div>

          <div className="flex items-center gap-4">
            {isConnected ? (
              <span className="flex items-center gap-2 text-sm font-medium text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                <Wifi className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-2 text-sm font-medium text-slate-400 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
                <WifiOff className="w-4 h-4" /> Disconnected
              </span>
            )}

            <button
              onClick={isConnected ? disconnect : connect}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                isConnected
                  ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20'
                  : 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-md shadow-indigo-500/20'
              }`}
            >
              {isConnected ? 'Disconnect' : 'Connect Agent'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 flex flex-col md:flex-row gap-6">

        {/* Left – Vision input */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-4 flex flex-col flex-1 shadow-xl relative overflow-hidden group">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all duration-700" />

            <div className="relative z-10 flex justify-between items-center mb-4">
              <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Video className="w-4 h-4 text-indigo-400" />
                Vision Input
              </h2>
              {isScreenSharing && (
                <button
                  onClick={handleSnapshot}
                  className="flex items-center gap-1.5 px-3 py-1 bg-slate-700 hover:bg-slate-600 text-xs text-white rounded-md transition-all shadow-md"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  {uploadStatus || 'Save Snapshot'}
                </button>
              )}
            </div>

            <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden border border-white/5 relative flex items-center justify-center">
              {/* CRITICAL FIX: 'muted' added below to bypass browser autoplay blocking */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted 
                className={`w-full h-full object-contain ${!isScreenSharing ? 'hidden' : ''}`}
              />
              {!isScreenSharing && (
                <div className="text-center text-slate-500 flex flex-col items-center">
                  <MonitorUp className="w-12 h-12 mb-3 text-slate-600" />
                  <p className="font-medium text-sm">No video source active</p>
                  <p className="text-xs mt-1 text-slate-600">Share your screen to let OmniTutor see.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right – Controls & agent orb */}
        <div className="w-full md:w-80 flex flex-col gap-4">

          {/* Device controls */}
          <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 shadow-xl">
            <h2 className="text-sm font-medium text-slate-300 mb-4 pb-4 border-b border-white/5">Device Controls</h2>

            <div className="space-y-3">
              {/* Microphone */}
              <button
                onClick={startMic}
                disabled={isMicActive}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                  isMicActive
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 cursor-default'
                    : 'bg-slate-900/50 border-white/5 hover:border-white/10 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isMicActive ? 'bg-indigo-500/20' : 'bg-slate-800'}`}>
                    {isMicActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  </div>
                  <span className="text-sm font-medium">Microphone</span>
                </div>

                {/* Live audio bar visualizer when speaking */}
                <div className="flex h-5 items-end gap-0.5">
                  {isMicActive ? (
                    userSpeaking
                      ? [1,2,3,4,5].map(i => (
                          <div
                            key={i}
                            className="w-1 bg-blue-400 rounded-full"
                            style={{
                              // OPTIMIZATION: Use pure CSS animation delays instead of Date.now() to prevent React re-renders
                              height: '80%',
                              animation: `audioBar 0.4s ease-in-out infinite alternate`,
                              animationDelay: `${i * 0.1}s`
                            }}
                          />
                        ))
                      : [1,2,3,4,5].map(i => (
                          <div key={i} className="w-1 bg-indigo-500/40 rounded-full h-1" />
                        ))
                  ) : (
                    <span className="text-xs text-slate-500">Off</span>
                  )}
                </div>
              </button>

              {/* Screen share */}
              <button
                onClick={startScreenShare}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                  isScreenSharing
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                    : 'bg-slate-900/50 border-white/5 hover:border-white/10 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isScreenSharing ? 'bg-indigo-500/20' : 'bg-slate-800'}`}>
                    <MonitorUp className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium">Share Screen</span>
                </div>
                <span className="text-xs text-slate-500">{isScreenSharing ? 'Active' : 'Off'}</span>
              </button>
            </div>
          </div>

          {/* Agent status orb */}
          <div className="bg-gradient-to-b from-slate-800/80 to-slate-800/30 border border-white/5 rounded-2xl p-5 flex-1 shadow-xl flex flex-col items-center justify-center text-center gap-4">

            {/* Orb */}
            <div className="w-24 h-24 rounded-full flex items-center justify-center relative">

              {/* Outer ring animations */}
              {orbState === 'agent-speaking' && (
                <>
                  <div className="absolute inset-0 rounded-full border-2 border-indigo-400/60 animate-ping" />
                  <div className="absolute inset-[-8px] rounded-full border border-indigo-500/20 animate-ping" style={{ animationDelay: '0.3s' }} />
                </>
              )}
              {orbState === 'user-speaking' && (
                <div className="absolute inset-0 rounded-full border-2 border-blue-400/60 animate-ping" />
              )}
              {orbState === 'listening' && (
                <div className="absolute inset-0 rounded-full border border-slate-600/40 animate-pulse" />
              )}

              {/* Core orb */}
              <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${
                orbState === 'offline'
                  ? 'bg-slate-700'
                  : orbState === 'agent-speaking'
                    ? 'bg-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.6)]'
                    : orbState === 'user-speaking'
                      ? 'bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]'
                      : 'bg-slate-600 shadow-inner'
              }`}>

                {/* Audio bars inside orb when agent speaking */}
                {orbState === 'agent-speaking' && (
                  <div className="flex items-end gap-0.5 h-5">
                    {[1,2,3,4,5].map(i => (
                      <div
                        key={i}
                        className="w-0.5 bg-white/80 rounded-full"
                        style={{ 
                          animation: `audioBar 0.5s ease-in-out infinite alternate`,
                          animationDelay: `${i * 0.15}s`
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Mic icon when user speaking */}
                {orbState === 'user-speaking' && (
                  <Mic className="w-6 h-6 text-white" />
                )}
              </div>
            </div>

            {/* Status text */}
            <div>
              <h3 className="text-md font-semibold text-slate-200 mb-1">{statusLabel}</h3>
              <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed">{statusSub}</p>
            </div>

          </div>
        </div>
      </main>

      {/* ── Keyframe animation for audio bars ─────────────────────────────── */}
      <style>{`
        @keyframes audioBar {
          0% { height: 4px; }
          100% { height: 18px; }
        }
      `}</style>
    </div>
  );
}

export default App;