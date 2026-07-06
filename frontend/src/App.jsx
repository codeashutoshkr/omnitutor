import React, { useState } from 'react';
import { Video, Mic, MonitorUp, Wifi, WifiOff, CloudUpload, MicOff, RefreshCw, Activity } from 'lucide-react';
import { useOmniTutor } from './hooks/useOmniTutor';

function App() {
  const {
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
  } = useOmniTutor();

  const [uploadStatus, setUploadStatus] = useState('');

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

  /* ── Derive agent orb state ────────────────────────────────────────────── */
  const orbState = !isConnected
    ? 'offline'
    : userSpeaking
      ? 'user-speaking'
      : agentSpeaking
        ? 'agent-speaking'
        : 'listening';

  const statusLabel = {
    offline:          'Agent Offline',
    listening:        'Listening…',
    'user-speaking':  'Hearing you…',
    'agent-speaking': 'OmniTutor is speaking…',
  }[orbState];

  const statusSub = {
    offline:          'Connect to start a tutoring session',
    listening:        'Ready — just start talking naturally',
    'user-speaking':  'Keep talking, you can interrupt anytime',
    'agent-speaking': 'Speak to interrupt at any time',
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

              {/* Microphone */}
              <button
                id="btn-microphone"
                onClick={startMic}
                disabled={isMicActive}
                className={`device-btn${isMicActive ? ' active' : ''}`}
              >
                <div className="device-btn-left">
                  <div className="device-icon">
                    {isMicActive ? <Mic size={15} /> : <MicOff size={15} />}
                  </div>
                  <span className="device-label">Microphone</span>
                </div>

                <div className="viz-bars">
                  {isMicActive
                    ? [1,2,3,4,5].map(i => (
                        <div
                          key={i}
                          className={`viz-bar ${userSpeaking ? 'active' : 'inactive'}`}
                          style={userSpeaking ? {
                            animationDelay: `${i * 0.09}s`,
                            height: `${8 + i * 2}px`
                          } : {}}
                        />
                      ))
                    : <span className="device-status">Off</span>
                  }
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

            {/* VAD state */}
            <div className="health-row">
              <span className="health-label">
                <span className={`health-dot ${
                  agentSpeaking ? 'dot-green'
                    : userSpeaking ? 'dot-yellow'
                    : 'dot-red'
                }`} style={{ background: agentSpeaking ? '#6366f1' : undefined, boxShadow: agentSpeaking ? '0 0 6px #6366f1' : undefined }} />
                Voice State
              </span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {agentSpeaking ? 'Agent speaking' : userSpeaking ? 'You speaking' : 'Silent'}
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

          {/* Agent Orb */}
          <div className="orb-panel">
            <div className="orb-wrap">
              {/* Rings */}
              {orbState === 'agent-speaking' && (
                <>
                  <div className="orb-ring ring-agent" />
                  <div className="orb-ring ring-agent-outer" />
                </>
              )}
              {orbState === 'user-speaking' && (
                <div className="orb-ring ring-user" />
              )}
              {orbState === 'listening' && (
                <div className="orb-ring ring-listen" />
              )}

              {/* Core */}
              <div className={`orb-core ${
                orbState === 'offline'          ? 'orb-offline'   :
                orbState === 'agent-speaking'   ? 'orb-agent'     :
                orbState === 'user-speaking'    ? 'orb-user'      :
                                                  'orb-listening'
              }`}>
                {orbState === 'agent-speaking' && (
                  <div className="orb-bars">
                    {[1,2,3,4,5].map(i => (
                      <div
                        key={i}
                        className="orb-bar"
                        style={{
                          animation: `audioBar 0.5s ease-in-out infinite alternate`,
                          animationDelay: `${i * 0.13}s`
                        }}
                      />
                    ))}
                  </div>
                )}
                {orbState === 'user-speaking' && <Mic size={20} color="white" />}
              </div>
            </div>

            <div>
              <p className="orb-status-title">{statusLabel}</p>
              <p className="orb-status-sub">{statusSub}</p>
            </div>
          </div>

        </div>
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default App;