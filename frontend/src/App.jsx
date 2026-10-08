import React, { useState, useEffect } from 'react';
import { Video, Mic, MonitorUp, Wifi, WifiOff, CloudUpload, MicOff, RefreshCw, Activity } from 'lucide-react';
import { useOmniTutor } from './hooks/useOmniTutor';

function App() {
  const {
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
  } = useOmniTutor();

  const [uploadStatus, setUploadStatus] = useState('');
  const [thinkingIndex, setThinkingIndex] = useState(0);

  const thinkingSteps = [
    { title: 'OmniTutor is thinking…', sub: 'Analyzing your question…' },
    { title: 'Processing your voice…', sub: 'Synthesizing knowledge…' },
    { title: 'Preparing response…', sub: 'Almost ready to speak…' },
  ];

  useEffect(() => {
    if (!isThinking) {
      setThinkingIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setThinkingIndex(prev => (prev + 1) % thinkingSteps.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [isThinking]);

  const handleSnapshot = async () => {
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

  /* ── Derive orb state ───────────────────────────────────────────────────── */
  const orbState = !isConnected
    ? 'offline'
    : isMicActive
      ? userSpeaking ? 'user-speaking' : 'listening'
      : isThinking
        ? 'thinking'
        : agentSpeaking
          ? 'agent-speaking'
          : 'idle';

  const statusLabel = {
    offline:          'Agent Offline',
    idle:             'Ready',
    listening:        'Listening to you…',
    'user-speaking':  'Receiving your voice…',
    thinking:         thinkingSteps[thinkingIndex].title,
    'agent-speaking': 'OmniTutor is speaking…',
  }[orbState];

  const statusSub = {
    offline:          'Connect to start a tutoring session',
    idle:             'Click the mic or orb to ask a question',
    listening:        'Speak your question — tap when finished',
    'user-speaking':  'Hearing you clearly — tap when finished',
    thinking:         thinkingSteps[thinkingIndex].sub,
    'agent-speaking': 'Tap mic to interrupt at any time',
  }[orbState];

  // Audio level bar: 0-100% mapped from RMS 0-0.3
  const audioLevelPct = Math.min(100, Math.round((audioLevel / 0.3) * 100));

  return (
    <div className="app-shell">

      {/* ── Styles ─────────────────────────────────────────────────────────── */}
      <style>{`
        :root {
          --bg-base:    #0b0f1a;
          --bg-card:    rgba(255,255,255,0.04);
          --bg-card-hv: rgba(255,255,255,0.07);
          --border:     rgba(255,255,255,0.08);
          --indigo:     #6366f1;
          --indigo-glow:rgba(99,102,241,0.5);
          --blue:       #3b82f6;
          --emerald:    #10b981;
          --rose:       #f43f5e;
          --text-1:     #f1f5f9;
          --text-2:     #94a3b8;
          --text-3:     #475569;
          font-family: 'Inter', system-ui, sans-serif;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: var(--bg-base); color: var(--text-1); }

        .app-shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.12), transparent),
                      var(--bg-base);
        }

        /* ── Header ── */
        .header {
          position: sticky; top: 0; z-index: 20;
          border-bottom: 1px solid var(--border);
          background: rgba(11,15,26,0.85);
          backdrop-filter: blur(20px);
        }
        .header-inner {
          max-width: 1100px; margin: 0 auto;
          padding: 0 24px; height: 60px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo-orb {
          width: 32px; height: 32px; border-radius: 50%;
          background: linear-gradient(135deg, var(--indigo), #818cf8);
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 12px; color: white;
          box-shadow: 0 0 20px var(--indigo-glow);
        }
        .logo-name { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }

        .header-right { display: flex; align-items: center; gap: 12px; }

        .badge {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 500;
          padding: 5px 12px; border-radius: 20px;
          border: 1px solid;
        }
        .badge-connected { color: var(--emerald); border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.08); }
        .badge-disconnected { color: var(--text-2); border-color: var(--border); background: rgba(255,255,255,0.03); }
        .badge-reconnecting {
          color: #facc15; border-color: rgba(250,204,21,0.3);
          background: rgba(250,204,21,0.08);
          animation: pulse 1.5s ease-in-out infinite;
        }

        .btn-connect, .btn-disconnect {
          padding: 7px 18px; border-radius: 20px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          border: none; transition: all 0.2s;
        }
        .btn-connect {
          background: linear-gradient(135deg, var(--indigo), #818cf8);
          color: white;
          box-shadow: 0 4px 20px var(--indigo-glow);
        }
        .btn-connect:hover { transform: translateY(-1px); box-shadow: 0 6px 28px var(--indigo-glow); }
        .btn-disconnect {
          background: rgba(244,63,94,0.1); color: var(--rose);
          border: 1px solid rgba(244,63,94,0.25);
        }
        .btn-disconnect:hover { background: rgba(244,63,94,0.18); }

        /* ── Main layout ── */
        .main {
          flex: 1; max-width: 1100px; width: 100%; margin: 0 auto;
          padding: 24px; display: flex; gap: 20px;
        }
        @media (max-width: 768px) { .main { flex-direction: column; } }

        /* ── Cards ── */
        .card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 20px;
          backdrop-filter: blur(12px);
        }
        .card-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 500; color: var(--text-2);
          margin-bottom: 16px; padding-bottom: 14px;
          border-bottom: 1px solid var(--border);
        }
        .card-title svg { color: var(--indigo); }

        /* ── Vision panel ── */
        .vision-col { flex: 1; display: flex; flex-direction: column; gap: 0; }
        .vision-card { flex: 1; display: flex; flex-direction: column; min-height: 320px; }
        .vision-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .vision-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--text-2); }

        .snapshot-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 12px; border-radius: 8px; cursor: pointer;
          background: rgba(255,255,255,0.06); color: var(--text-1);
          border: 1px solid var(--border); font-size: 12px;
          transition: all 0.15s;
        }
        .snapshot-btn:hover { background: rgba(255,255,255,0.1); }

        .video-area {
          flex: 1; border-radius: 12px; overflow: hidden;
          background: rgba(0,0,0,0.4); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          min-height: 260px;
        }
        .video-area video { width: 100%; height: 100%; object-fit: contain; }
        .no-video { text-align: center; color: var(--text-3); }
        .no-video svg { margin-bottom: 10px; }
        .no-video p { font-size: 13px; }
        .no-video small { font-size: 12px; color: var(--text-3); }

        /* ── Right column ── */
        .right-col { width: 300px; display: flex; flex-direction: column; gap: 16px; }
        @media (max-width: 768px) { .right-col { width: 100%; } }

        /* ── Device controls ── */
        .device-btn {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          padding: 12px 14px; border-radius: 12px; cursor: pointer;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.03);
          color: var(--text-2);
          transition: all 0.2s;
          font-family: inherit;
        }
        .device-btn:hover:not(:disabled) { background: var(--bg-card-hv); border-color: rgba(255,255,255,0.14); }
        .device-btn:disabled { cursor: default; }
        .device-btn.active { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.3); color: #a5b4fc; }

        .device-btn-left { display: flex; align-items: center; gap: 10px; }
        .device-icon {
          width: 34px; height: 34px; border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.05);
          transition: all 0.2s;
        }
        .device-btn.active .device-icon { background: rgba(99,102,241,0.2); }
        .device-label { font-size: 13px; font-weight: 500; }
        .device-status { font-size: 11px; color: var(--text-3); }
        .device-btn.active .device-status { color: #818cf8; }

        /* Audio visualizer bars */
        .viz-bars { display: flex; height: 18px; align-items: flex-end; gap: 2px; }
        .viz-bar { width: 3px; border-radius: 2px; transition: height 0.05s; }
        .viz-bar.active { background: var(--blue); animation: audioBar 0.4s ease-in-out infinite alternate; }
        .viz-bar.inactive { background: rgba(99,102,241,0.25); height: 3px; }

        /* ── Session health panel ── */
        .health-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .health-label { font-size: 12px; color: var(--text-2); display: flex; align-items: center; gap: 6px; }
        .health-dot { width: 7px; height: 7px; border-radius: 50%; }
        .dot-green { background: var(--emerald); box-shadow: 0 0 6px var(--emerald); }
        .dot-yellow { background: #facc15; box-shadow: 0 0 6px #facc15; animation: pulse 1.5s infinite; }
        .dot-red { background: var(--rose); }

        .audio-meter-track {
          width: 100%; height: 5px; border-radius: 3px;
          background: rgba(255,255,255,0.07); overflow: hidden; margin-top: 4px;
        }
        .audio-meter-fill {
          height: 100%; border-radius: 3px;
          transition: width 0.08s linear;
          background: linear-gradient(90deg, var(--emerald), var(--blue), var(--indigo));
        }
        .audio-meter-fill.gated { background: var(--text-3); }

        .reconnect-info {
          font-size: 11px; color: #facc15;
          display: flex; align-items: center; gap: 4px; margin-top: 6px;
        }

        /* ── Orb panel ── */
        .orb-panel {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          text-align: center; gap: 18px;
          background: linear-gradient(160deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01));
          border: 1px solid var(--border); border-radius: 18px; padding: 28px 20px;
        }
        .orb-wrap { position: relative; width: 96px; height: 96px; }
        .orb-core {
          position: absolute; inset: 12px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.35s;
        }
        .orb-offline { background: #1e293b; }
        .orb-listening { background: #334155; }
        .orb-agent { background: var(--indigo); box-shadow: 0 0 36px var(--indigo-glow); }
        .orb-user { background: var(--blue); box-shadow: 0 0 24px rgba(59,130,246,0.5); }

        .orb-ring {
          position: absolute; inset: 0; border-radius: 50%;
          border: 2px solid;
        }
        .ring-agent { border-color: rgba(99,102,241,0.6); animation: ping 1.1s cubic-bezier(0,0,0.2,1) infinite; }
        .ring-agent-outer { border-color: rgba(99,102,241,0.25); border-width: 1px; inset: -10px; animation: ping 1.1s cubic-bezier(0,0,0.2,1) infinite 0.35s; }
        .ring-user { border-color: rgba(59,130,246,0.6); animation: ping 1s cubic-bezier(0,0,0.2,1) infinite; }
        .ring-listen { border-color: rgba(255,255,255,0.1); border-width: 1px; animation: pulse 2.5s ease-in-out infinite; }

        .orb-bars { display: flex; align-items: flex-end; gap: 2px; height: 20px; }
        .orb-bar { width: 2px; background: rgba(255,255,255,0.85); border-radius: 2px; }

        .orb-status-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
        .orb-status-sub { font-size: 12px; color: var(--text-2); line-height: 1.5; max-width: 200px; }

        /* ── Keyframes ── */
        @keyframes audioBar {
          0%   { height: 3px; }
          100% { height: 16px; }
        }
        @keyframes ping {
          75%, 100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-orb">OT</div>
            <h1 className="logo-name">OmniTutor</h1>
          </div>

          <div className="header-right">
            {reconnectAttempt > 0 ? (
              <span className="badge badge-reconnecting">
                <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                Reconnecting ({reconnectAttempt}/5)
              </span>
            ) : isConnected ? (
              <span className="badge badge-connected">
                <Wifi size={12} /> Connected
              </span>
            ) : (
              <span className="badge badge-disconnected">
                <WifiOff size={12} /> Disconnected
              </span>
            )}

            <button
              id="btn-toggle-connection"
              onClick={isConnected ? disconnect : connect}
              className={isConnected ? 'btn-disconnect' : 'btn-connect'}
            >
              {isConnected ? 'Disconnect' : 'Connect Agent'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="main">

        {/* Left — Vision */}
        <div className="vision-col">
          <div className="card vision-card">
            <div className="vision-header">
              <div className="vision-title">
                <Video size={14} />
                Vision Input
              </div>
              {isScreenSharing && (
                <button id="btn-snapshot" className="snapshot-btn" onClick={handleSnapshot}>
                  <CloudUpload size={13} />
                  {uploadStatus || 'Save Snapshot'}
                </button>
              )}
            </div>

            <div className="video-area">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ display: isScreenSharing ? 'block' : 'none' }}
              />
              {!isScreenSharing && (
                <div className="no-video">
                  <MonitorUp size={40} color="#334155" />
                  <p>No video source active</p>
                  <small>Share your screen so OmniTutor can see your work</small>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right — Controls + Orb + Health */}
        <div className="right-col">

          {/* Device Controls */}
          <div className="card">
            <div className="card-title">
              <Activity size={13} />
              Device Controls
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Microphone toggle */}
              <button
                id="btn-microphone"
                onClick={isMicActive ? stopMic : startMic}
                disabled={!isConnected}
                className={`device-btn${isMicActive ? ' active' : ''}${isThinking ? ' thinking' : ''}`}
                title={isMicActive ? 'Click to finish speaking and send' : isThinking ? 'OmniTutor is thinking' : 'Click to speak'}
              >
                <div className="device-btn-left">
                  <div className="device-icon">
                    {isMicActive ? <Mic size={15} /> : <MicOff size={15} />}
                  </div>
                  <div>
                    <span className="device-label">Microphone</span>
                    <div className="device-status">
                      {isMicActive
                        ? (userSpeaking ? 'Receiving voice… tap to finish' : 'Listening… tap to finish')
                        : isThinking
                        ? 'Thinking & analyzing…'
                        : agentSpeaking
                        ? 'OmniTutor speaking'
                        : 'Tap to speak'}
                    </div>
                  </div>
                </div>

                <div className="viz-bars">
                  {isMicActive ? (
                    [1,2,3,4,5].map(i => (
                      <div
                        key={i}
                        className={`viz-bar ${userSpeaking ? 'active' : 'inactive'}`}
                        style={userSpeaking ? {
                          animationDelay: `${i * 0.09}s`,
                          height: `${8 + i * 2}px`
                        } : {}}
                      />
                    ))
                  ) : isThinking ? (
                    <div className="thinking-mini-bars">
                      <span className="mini-dot dot-1" />
                      <span className="mini-dot dot-2" />
                      <span className="mini-dot dot-3" />
                    </div>
                  ) : (
                    <span className="device-status">Off</span>
                  )}
                </div>
              </button>

              {/* Screen Share */}
              <button
                id="btn-screen-share"
                onClick={startScreenShare}
                className={`device-btn${isScreenSharing ? ' active' : ''}`}
              >
                <div className="device-btn-left">
                  <div className="device-icon">
                    <MonitorUp size={15} />
                  </div>
                  <span className="device-label">Share Screen</span>
                </div>
                <span className="device-status">{isScreenSharing ? 'Active' : 'Off'}</span>
              </button>
            </div>
          </div>

          {/* Session Health */}
          <div className="card">
            <div className="card-title">
              <Activity size={13} />
              Session Health
            </div>

            {/* Connection status */}
            <div className="health-row">
              <span className="health-label">
                <span className={`health-dot ${
                  reconnectAttempt > 0 ? 'dot-yellow'
                    : isConnected ? 'dot-green'
                    : 'dot-red'
                }`} />
                Connection
              </span>
              <span style={{ fontSize: 12, color: reconnectAttempt > 0 ? '#facc15' : isConnected ? '#10b981' : '#94a3b8' }}>
                {reconnectAttempt > 0 ? `Retry ${reconnectAttempt}/5` : isConnected ? 'Stable' : 'Offline'}
              </span>
            </div>

            {/* Voice state */}
            <div className="health-row">
              <span className="health-label">
                <span className={`health-dot ${
                  agentSpeaking ? 'dot-indigo'
                    : isThinking ? 'dot-purple'
                    : userSpeaking ? 'dot-blue'
                    : isMicActive ? 'dot-yellow'
                    : 'dot-gray'
                }`} />
                Voice State
              </span>
              <span style={{ fontSize: 12, color: agentSpeaking ? '#818cf8' : isThinking ? '#c084fc' : userSpeaking ? '#60a5fa' : isMicActive ? '#facc15' : '#94a3b8' }}>
                {agentSpeaking ? 'Agent speaking' : isThinking ? 'Thinking & analyzing' : userSpeaking ? 'Receiving voice' : isMicActive ? 'Listening' : 'Silent'}
              </span>
            </div>

            {/* Audio level meter */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>Mic Level</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{audioLevelPct}%</span>
              </div>
              <div className="audio-meter-track">
                <div
                  className={`audio-meter-fill${audioLevelPct < 5 && isMicActive ? ' gated' : ''}`}
                  style={{ width: `${audioLevelPct}%` }}
                />
              </div>
              <p style={{ fontSize: 10, color: '#475569', marginTop: 5 }}>
                {isMicActive
                  ? audioLevelPct < 5
                    ? '🔇 Background noise gated out'
                    : audioLevelPct > 75
                    ? '📢 Audio level high — move mic further'
                    : '✅ Good mic level'
                  : 'Enable microphone to see level'}
              </p>
            </div>

            {reconnectAttempt > 0 && (
              <div className="reconnect-info">
                <RefreshCw size={11} />
                Auto-reconnecting to agent…
              </div>
            )}
          </div>

          {/* Tap-to-Speak Orb Panel with Interactive Visuals */}
          <div className="orb-panel">

            {/* Visual 3-Step Workflow Guide */}
            <div className="flow-guide">
              <span className={`flow-step ${!isMicActive && !isThinking && !agentSpeaking ? 'active' : 'done'}`}>
                1. Open Mic
              </span>
              <span className="flow-arrow">→</span>
              <span className={`flow-step ${isMicActive ? 'active' : isThinking || agentSpeaking ? 'done' : ''}`}>
                2. Speak
              </span>
              <span className="flow-arrow">→</span>
              <span className={`flow-step ${isThinking ? 'active' : agentSpeaking ? 'done' : ''}`}>
                3. AI Answers
              </span>
            </div>

            {/* Primary Interactive Clickable Orb */}
            <button
              className={`orb-btn ${
                !isConnected        ? 'orb-btn-offline'       :
                isMicActive         ? (userSpeaking ? 'orb-btn-speaking-active' : 'orb-btn-recording') :
                isThinking          ? 'orb-btn-thinking'      :
                agentSpeaking       ? 'orb-btn-agent'         :
                                      'orb-btn-idle'
              }`}
              onClick={
                !isConnected ? undefined :
                isMicActive  ? stopMic   :
                               startMic
              }
              disabled={!isConnected}
              title={
                !isConnected ? 'Connect agent first' :
                isMicActive  ? 'Click to finish speaking and send' :
                isThinking   ? 'OmniTutor is thinking…' :
                'Click to speak'
              }
            >
              {/* Outer pulsing / rotating rings */}
              {isMicActive && (
                <>
                  <span className="orb-ring-pulse" />
                  {userSpeaking && <span className="orb-ring-pulse-outer" />}
                </>
              )}
              {isThinking && (
                <>
                  <span className="orb-ring-thinking-spin" />
                  <span className="orb-ring-thinking-pulse" />
                </>
              )}
              {agentSpeaking && !isMicActive && (
                <>
                  <span className="orb-ring-agent" />
                  <span className="orb-ring-agent-outer" />
                </>
              )}

              {/* Center icon & interactive visualizer */}
              {isThinking ? (
                <div className="thinking-dots" title="Analyzing...">
                  <span className="thinking-dot dot-1" />
                  <span className="thinking-dot dot-2" />
                  <span className="thinking-dot dot-3" />
                </div>
              ) : agentSpeaking && !isMicActive ? (
                <div className="orb-bars">
                  {[1,2,3,4,5].map(i => (
                    <div
                      key={i}
                      className="orb-bar"
                      style={{
                        animation: `audioBar 0.45s ease-in-out infinite alternate`,
                        animationDelay: `${i * 0.12}s`
                      }}
                    />
                  ))}
                </div>
              ) : isMicActive ? (
                userSpeaking ? (
                  <div className="orb-bars live-bars">
                    {[1,2,3,4,5].map(i => (
                      <div
                        key={i}
                        className="orb-bar user-live-bar"
                        style={{
                          height: `${Math.max(6, Math.min(26, Math.round((audioLevel / 0.18) * 20) + (i % 2 === 0 ? 5 : 9)))}px`
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <MicOff size={28} color="white" />
                )
              ) : (
                <Mic size={28} color={isConnected ? 'white' : '#475569'} />
              )}
            </button>

            {/* Dynamic Status Text & Subtitle */}
            <div style={{ textAlign: 'center', minHeight: 46 }}>
              <p className="orb-status-title">{statusLabel}</p>
              <p className="orb-status-sub">{statusSub}</p>
            </div>

            {/* Main Action Button for Instant Usability */}
            <button
              className={`main-action-btn ${
                !isConnected ? 'btn-action-offline' :
                isMicActive  ? 'btn-action-send' :
                isThinking   ? 'btn-action-thinking' :
                agentSpeaking ? 'btn-action-interrupt' :
                'btn-action-speak'
              }`}
              onClick={
                !isConnected ? connect :
                isMicActive  ? stopMic :
                startMic
              }
              disabled={isThinking}
            >
              {!isConnected ? (
                <>Connect Agent to Start</>
              ) : isMicActive ? (
                <>
                  <span className="action-icon-pulse">⏹</span>
                  Finish Speaking & Ask AI
                </>
              ) : isThinking ? (
                <>
                  <span className="action-spinner">✦</span>
                  Analyzing Your Question…
                </>
              ) : agentSpeaking ? (
                <>
                  <span>✋</span>
                  Interrupt & Speak
                </>
              ) : (
                <>
                  <Mic size={16} />
                  Tap to Speak
                </>
              )}
            </button>

            {/* Interactive Status Pill Badges */}
            {isMicActive && (
              <div className="rec-pill">
                <span className="rec-dot" />
                {userSpeaking ? 'RECEIVING VOICE • TAP TO SEND' : 'MIC OPEN • SPEAK NOW'}
              </div>
            )}
            {isThinking && (
              <div className="thinking-pill">
                <span className="thinking-sparkle">✦</span>
                ANALYZING & THINKING…
              </div>
            )}
            {agentSpeaking && (
              <div className="speaking-pill">
                <span className="speaking-wave">●</span>
                AI RESPONDING • TAP TO INTERRUPT
              </div>
            )}
          </div>

        </div>
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Tap-to-Speak Orb Button ── */
        .orb-btn {
          position: relative;
          width: 96px; height: 96px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.2s, box-shadow 0.2s;
          outline: none;
          flex-shrink: 0;
        }
        .orb-btn:active { transform: scale(0.93); }
        .orb-btn:disabled { cursor: default; }

        .orb-btn-offline {
          background: #1e293b;
          box-shadow: none;
        }
        .orb-btn-idle {
          background: linear-gradient(135deg, #334155, #1e293b);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.07);
        }
        .orb-btn-idle:hover:not(:disabled) {
          background: linear-gradient(135deg, #475569, #334155);
          box-shadow: 0 0 28px rgba(99,102,241,0.35);
          transform: scale(1.04);
        }
        .orb-btn-recording {
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          box-shadow: 0 0 32px rgba(59,130,246,0.55);
          animation: recPulse 1.6s ease-in-out infinite;
        }
        .orb-btn-speaking-active {
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          box-shadow: 0 0 42px rgba(37,99,235,0.75);
          animation: recPulse 1s ease-in-out infinite;
        }
        .orb-btn-thinking {
          background: linear-gradient(135deg, #4f46e5, #9333ea, #ec4899, #06b6d4);
          background-size: 300% 300%;
          animation: auroraShift 3s ease infinite, thinkingPulse 1.8s ease-in-out infinite alternate;
        }
        .orb-btn-agent {
          background: linear-gradient(135deg, #6366f1, #818cf8);
          box-shadow: 0 0 36px rgba(99,102,241,0.5);
        }

        @keyframes auroraShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes thinkingPulse {
          0%   { box-shadow: 0 0 22px rgba(147,51,234,0.4), 0 0 44px rgba(79,70,229,0.2); transform: scale(1); }
          100% { box-shadow: 0 0 36px rgba(236,72,153,0.6), 0 0 65px rgba(6,182,212,0.35); transform: scale(1.04); }
        }

        @keyframes recPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(59,130,246,0.5); }
          50%       { box-shadow: 0 0 48px rgba(59,130,246,0.85); }
        }

        /* Animated rings around orb */
        .orb-ring-pulse, .orb-ring-agent {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          border: 2px solid;
          animation: ping 1.1s cubic-bezier(0,0,0.2,1) infinite;
          pointer-events: none;
        }
        .orb-ring-pulse { border-color: rgba(59,130,246,0.5); }
        .orb-ring-pulse-outer {
          position: absolute;
          inset: -14px;
          border-radius: 50%;
          border: 1px solid rgba(59,130,246,0.3);
          animation: ping 1.3s cubic-bezier(0,0,0.2,1) infinite 0.2s;
          pointer-events: none;
        }
        .orb-ring-thinking-spin {
          position: absolute;
          inset: -9px;
          border-radius: 50%;
          border: 2px dashed rgba(168,85,247,0.7);
          animation: spin 3.5s linear infinite;
          pointer-events: none;
        }
        .orb-ring-thinking-pulse {
          position: absolute;
          inset: -14px;
          border-radius: 50%;
          border: 1px solid rgba(236,72,153,0.35);
          animation: ping 1.5s cubic-bezier(0,0,0.2,1) infinite;
          pointer-events: none;
        }
        .orb-ring-agent { border-color: rgba(99,102,241,0.5); }
        .orb-ring-agent-outer {
          position: absolute;
          inset: -15px;
          border-radius: 50%;
          border: 1px solid rgba(99,102,241,0.25);
          animation: ping 1.3s cubic-bezier(0,0,0.2,1) infinite 0.3s;
          pointer-events: none;
        }

        /* Thinking dots inside orb */
        .thinking-dots {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .thinking-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ffffff;
          animation: thinkingBounce 1.2s ease-in-out infinite;
        }
        .dot-1 { animation-delay: 0s; }
        .dot-2 { animation-delay: 0.2s; }
        .dot-3 { animation-delay: 0.4s; }
        @keyframes thinkingBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1.2); opacity: 1; }
        }

        /* User live audio bar animation */
        .user-live-bar {
          background: #ffffff !important;
          transition: height 0.05s ease-out;
        }

        /* Status Pills */
        .rec-pill {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 12px; border-radius: 20px;
          background: rgba(239,68,68,0.15);
          border: 1px solid rgba(239,68,68,0.3);
          color: #f87171; font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em;
        }
        .rec-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #ef4444;
          animation: pulse 1s ease-in-out infinite;
        }

        .thinking-pill {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 12px; border-radius: 20px;
          background: rgba(168,85,247,0.15);
          border: 1px solid rgba(168,85,247,0.35);
          color: #c084fc; font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em;
          animation: pulse 1.8s ease-in-out infinite;
        }
        .thinking-sparkle {
          color: #f472b6;
          display: inline-block;
          animation: spin 3s linear infinite;
        }

        .speaking-pill {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 12px; border-radius: 20px;
          background: rgba(99,102,241,0.15);
          border: 1px solid rgba(99,102,241,0.35);
          color: #a5b4fc; font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em;
        }
        .speaking-wave {
          color: #818cf8;
          animation: pulse 0.8s ease-in-out infinite;
        }

        /* Thinking mini bars in sidebar */
        .thinking-mini-bars {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .mini-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #c084fc;
          animation: thinkingBounce 1s ease-in-out infinite;
        }

        .dot-indigo { background: #6366f1; box-shadow: 0 0 6px #6366f1; }
        .dot-purple { background: #c084fc; box-shadow: 0 0 6px #c084fc; animation: pulse 1s infinite; }
        .dot-blue   { background: #3b82f6; box-shadow: 0 0 6px #3b82f6; }
        .dot-gray   { background: #475569; }

        /* ── 3-Step Flow Guide ── */
        .flow-guide {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          font-size: 11px;
          color: var(--text-3);
          margin-bottom: 4px;
        }
        .flow-step {
          padding: 2px 7px;
          border-radius: 6px;
          transition: all 0.2s;
        }
        .flow-step.active {
          background: rgba(99, 102, 241, 0.22);
          color: #a5b4fc;
          font-weight: 600;
        }
        .flow-step.done {
          color: var(--emerald);
        }
        .flow-arrow {
          color: var(--text-3);
          font-size: 10px;
        }

        /* ── Main Action Button ── */
        .main-action-btn {
          width: 100%;
          max-width: 250px;
          padding: 10px 18px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: inherit;
        }
        .btn-action-speak {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(129, 140, 248, 0.9));
          color: white;
          box-shadow: 0 4px 18px rgba(99, 102, 241, 0.4);
        }
        .btn-action-speak:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 26px rgba(99, 102, 241, 0.6);
        }
        .btn-action-send {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
          box-shadow: 0 4px 22px rgba(239, 68, 68, 0.45);
          animation: pulse 1.6s ease-in-out infinite;
        }
        .btn-action-send:hover {
          background: linear-gradient(135deg, #f87171, #ef4444);
          transform: translateY(-1px);
          box-shadow: 0 6px 28px rgba(239, 68, 68, 0.65);
        }
        .btn-action-thinking {
          background: rgba(168, 85, 247, 0.15);
          color: #c084fc;
          border-color: rgba(168, 85, 247, 0.35);
          cursor: wait;
        }
        .btn-action-interrupt {
          background: rgba(244, 63, 94, 0.12);
          color: #fb7185;
          border-color: rgba(244, 63, 94, 0.3);
        }
        .btn-action-interrupt:hover {
          background: rgba(244, 63, 94, 0.2);
        }
        .btn-action-offline {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-2);
          border-color: var(--border);
        }
        .action-icon-pulse {
          display: inline-block;
          animation: pulse 1s infinite;
        }
        .action-spinner {
          display: inline-block;
          animation: spin 2.5s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default App;