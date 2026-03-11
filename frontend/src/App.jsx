import React, { useState } from 'react';
import { useOmniTutor } from './hooks/useOmniTutor';
import { Video, Mic, MonitorUp, Wifi, WifiOff, CloudUpload } from 'lucide-react';

function App() {
  const {
    isConnected,
    isScreenSharing,
    isMicActive,
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
          // Extract one frame
          const canvas = document.createElement('canvas');
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col font-sans selection:bg-indigo-500/30">
      
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <span className="font-bold tracking-tight text-white">OT</span>
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

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 flex flex-col md:flex-row gap-6">
        
        {/* Left Column: Visuals */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-4 flex flex-col flex-1 shadow-xl relative overflow-hidden group">
            {/* Ambient Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all duration-700"></div>
            
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
            
            <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden border border-white/5 relative flex items-center justify-center group/video">
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
                    <p className="text-xs mt-1 text-slate-600">Share your screen or camera to let the tutor see.</p>
                  </div>
                )}
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Agent State */}
        <div className="w-full md:w-80 flex flex-col gap-4">
          <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 shadow-xl">
             <h2 className="text-sm font-medium text-slate-300 mb-4 pb-4 border-b border-white/5">Device Controls</h2>
             
             <div className="space-y-3">
               <button 
                 onClick={startMic}
                 className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                   isMicActive 
                     ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' 
                     : 'bg-slate-900/50 border-white/5 hover:border-white/10 text-slate-300'
                 }`}
               >
                 <div className="flex items-center gap-3">
                   <div className={`p-2 rounded-lg ${isMicActive ? 'bg-indigo-500/20' : 'bg-slate-800'}`}>
                     <Mic className="w-4 h-4" />
                   </div>
                   <span className="text-sm font-medium font-medium">Microphone</span>
                 </div>
                 <div className="flex h-3 items-center gap-0.5">
                   {/* Audio visualizer dots skeleton */}
                   {isMicActive ? (
                      [1,2,3,4].map(i => <div key={i} className={`w-1 bg-indigo-500 rounded-full animate-pulse ${i === 2 || i === 3 ? 'h-full' : 'h-2'}`}></div>)
                   ) : (
                      <span className="text-xs text-slate-500">Off</span>
                   )}
                 </div>
               </button>

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
          
          <div className="bg-gradient-to-b from-slate-800/80 to-slate-800/30 border border-white/5 rounded-2xl p-5 flex-1 shadow-xl flex flex-col items-center justify-center text-center">
             <div className="w-20 h-20 rounded-full bg-slate-900 border-4 border-slate-800 flex items-center justify-center mb-4 relative shadow-inner">
                {/* Agent talking indicator */}
                {isConnected && (
                  <>
                    <div className="absolute inset-0 rounded-full border-2 border-indigo-500/50 animate-ping"></div>
                    <div className="w-8 h-8 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>
                  </>
                )}
                {!isConnected && (
                  <div className="w-8 h-8 rounded-full bg-slate-700"></div>
                )}
             </div>
             <h3 className="text-md font-medium text-slate-200 mb-1">
               {isConnected ? 'Agent is Listening...' : 'Agent Offline'}
             </h3>
             <p className="text-xs text-slate-400">
               {isConnected ? 'Speaking to OmniTutor natively' : 'Connect to start tutoring session'}
             </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
