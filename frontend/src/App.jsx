import React, { useState } from 'react';
import { useOmniTutor } from './hooks/useOmniTutor';
import { Video, Mic, MonitorUp, Wifi, WifiOff, CloudUpload, MicOff } from 'lucide-react';

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
    if (!isScreenSharing || !videoRef.current) return;
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
              <video
                ref={videoRef}
                autoPlay
                playsInline
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
                              height: `${20 + Math.sin(Date.now() / 200 + i) * 60}%`,
                              animation: `audioBar 0.${3 + i}s ease-in-out infinite alternate`
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
                        style={{ animation: `audioBar 0.${4 + i}s ease-in-out infinite alternate` }}
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
          from { height: 4px; }
          to   { height: 18px; }
        }
      `}</style>
    </div>
  );
}

export default App;
