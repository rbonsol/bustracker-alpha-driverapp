import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BusTelemetry, LogEntry } from './types';
import { pushTelemetry, initializeFirebase } from './services/dataService';
import { DEFAULT_CONFIG } from './services/firebaseConfig';
import { generateAnnouncement } from './services/geminiService';
import { TelemetryCard } from './components/TelemetryCard';
import { StatusLog } from './components/StatusLog';
import { v4 as uuidv4 } from 'uuid';

// Haversine formula to calculate distance in meters
const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
};

// Helper to get stored config or return default
const getStoredConfig = () => {
  try {
    const stored = localStorage.getItem('omni_firebase_config');
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error("Failed to parse stored config", e);
  }
  return DEFAULT_CONFIG;
};

const App: React.FC = () => {
  // Trip Configuration State
  // PERSISTENCE: Load busId from storage so driver doesn't re-type it
  const [busId, setBusId] = useState(() => localStorage.getItem('omni_bus_id') || "");
  const [direction, setDirection] = useState<'northbound' | 'southbound'>('northbound');
  const [isSetupComplete, setIsSetupComplete] = useState(false);

  // Tracking State
  const [isTracking, setIsTracking] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const watchIdRef = useRef<number | null>(null);
  
  // Telemetry Logic State
  const lastSentLocationRef = useRef<{lat: number, lng: number} | null>(null);
  const lastSentTimeRef = useRef<number>(0);

  // Metrics UI State
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [batteryLevel, setBatteryLevel] = useState<number>(100);
  const [isCharging, setIsCharging] = useState(false);
  const [lastSentTime, setLastSentTime] = useState<string>("-");
  const [statusMessage, setStatusMessage] = useState<string>("Ready");
  const [statusType, setStatusType] = useState<'normal' | 'error' | 'success'>('normal');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  // AI & Modals
  const [incidentText, setIncidentText] = useState("");
  const [generatedMsg, setGeneratedMsg] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  
  // Config
  const [fbConfig, setFbConfig] = useState(getStoredConfig());

  // Logging Helper
  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev.slice(-49), { // Keep last 50 logs
      id: uuidv4(),
      timestamp: new Date(),
      type,
      message
    }]);
  }, []);

  // PERSISTENCE: Save busId when changed
  useEffect(() => {
    localStorage.setItem('omni_bus_id', busId);
  }, [busId]);

  // ANDROID BACK BUTTON HANDLING
  // Trap the back button to prevent accidental app exit during tracking
  useEffect(() => {
    if (isSetupComplete) {
      // Push a dummy state to the history stack
      window.history.pushState({ screen: 'dashboard' }, "", window.location.href);

      const handlePopState = (event: PopStateEvent) => {
        if (isTracking) {
          // If tracking, prevent going back. Push state again.
          window.history.pushState({ screen: 'dashboard' }, "", window.location.href);
          setStatusMessage("Stop tracking first!");
          addLog('warning', "Back button pressed while tracking");
        } else {
          // If not tracking, allow going back to setup
          setIsSetupComplete(false);
        }
      };

      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  }, [isSetupComplete, isTracking, addLog]);


  // Initialize Firebase on mount or config change
  useEffect(() => {
    const error = initializeFirebase(fbConfig as any);
    if (error) {
      setStatusMessage(`DB Error: ${error}`);
      setStatusType('error');
      addLog('error', `Firebase Init Failed: ${error}`);
    } else {
      // Only set ready if we aren't already tracking or showing another status
      if (!isTracking) {
        setStatusMessage("System Ready");
        setStatusType('normal');
      }
      addLog('info', 'System Initialized');
    }
  }, [fbConfig, isTracking, addLog]);

  // WAKE LOCK MANAGEMENT
  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        if (!wakeLockRef.current || wakeLockRef.current.released) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          console.log('Wake Lock acquired');
        }
      } catch (err: any) {
        console.error(`WakeLock Error: ${err.name}, ${err.message}`);
      }
    }
  }, []);

  // Re-acquire wake lock periodically
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    if (isTracking) {
      requestWakeLock();
      interval = setInterval(requestWakeLock, 15000);
    } else {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isTracking) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (interval) clearInterval(interval);
      wakeLockRef.current?.release();
    };
  }, [isTracking, requestWakeLock]);

  const saveConfig = () => {
    localStorage.setItem('omni_firebase_config', JSON.stringify(fbConfig));
    setShowConfigModal(false);
    setStatusMessage("Config Saved");
    addLog('success', 'Configuration updated');
    setTimeout(() => setStatusMessage("Ready"), 1500);
  };

  // Battery Monitor
  useEffect(() => {
    if (navigator.getBattery) {
      navigator.getBattery().then(battery => {
        const updateBattery = () => {
          setBatteryLevel(battery.level * 100);
          setIsCharging(battery.charging);
        };
        updateBattery();
        battery.onlevelchange = updateBattery;
        battery.onchargingchange = updateBattery;
      });
    }
  }, []);

  // Core Logic: Process Position Update
  const processPosition = useCallback(async (position: GeolocationPosition) => {
      const { latitude, longitude, speed, heading } = position.coords;
      
      // Update UI immediately for responsiveness
      setLastLocation({ lat: latitude, lng: longitude });
      setCurrentSpeed(speed || 0);

      const now = Date.now();
      const lastLoc = lastSentLocationRef.current;
      const lastTime = lastSentTimeRef.current;

      // DISTANCE FILTER LOGIC:
      // Only send if moved > 20 meters OR if 30 seconds have passed (heartbeat)
      let shouldSend = false;
      let distanceMoved = 0;

      if (!lastLoc) {
        shouldSend = true;
      } else {
        distanceMoved = getDistanceInMeters(lastLoc.lat, lastLoc.lng, latitude, longitude);
        const timeElapsed = now - lastTime;
        
        if (distanceMoved > 20 || timeElapsed > 30000) {
          shouldSend = true;
        }
      }

      if (shouldSend) {
        setStatusMessage("Syncing...");
        
        const telemetry: BusTelemetry = {
          busId: busId,
          direction: direction,
          routeId: "alabang-lawton", // Hardcoded for MVP
          timestamp: now,
          latitude,
          longitude,
          speed,
          heading,
          batteryLevel: batteryLevel / 100,
          isCharging
        };

        try {
          const success = await pushTelemetry(telemetry);
          if (success) {
            setLastSentTime(new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
            setStatusMessage("Data Synced");
            setStatusType('success');
            addLog('success', `Sent: ${distanceMoved.toFixed(0)}m move`);
            
            // Update Refs
            lastSentLocationRef.current = { lat: latitude, lng: longitude };
            lastSentTimeRef.current = now;

            setTimeout(() => {
                setStatusMessage("Tracking Active");
                setStatusType('normal');
            }, 2000);
          } else {
            setStatusMessage("Sync Failed");
            setStatusType('error');
            addLog('error', 'Firebase sync failed');
          }
        } catch (e: any) {
          setStatusMessage("Network Error");
          setStatusType('error');
          addLog('error', `Net Err: ${e.message}`);
        }
      }
  }, [batteryLevel, busId, direction, isCharging, addLog]);

  // Start/Stop Tracking with watchPosition
  useEffect(() => {
    if (isTracking) {
      if (!navigator.geolocation) {
        setStatusMessage("GPS Not Supported");
        addLog('error', 'Navigator.geolocation missing');
        return;
      }

      addLog('info', 'Starting GPS Watch...');
      
      // watchPosition is better for Android background tracking than setInterval
      watchIdRef.current = navigator.geolocation.watchPosition(
        processPosition,
        (error) => {
          setStatusMessage(`GPS: ${error.message}`);
          setStatusType('error');
          addLog('error', `GPS Error ${error.code}: ${error.message}`);
        },
        { 
          enableHighAccuracy: true, 
          timeout: 10000, 
          maximumAge: 0 
        }
      );
    } else {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
        setStatusMessage("Tracking Paused");
        setStatusType('normal');
        addLog('info', 'Tracking Stopped');
      }
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [isTracking, processPosition, addLog]);

  // Toggle Tracking Handler (with manual Wake Lock trigger)
  const toggleTracking = () => {
    const newState = !isTracking;
    setIsTracking(newState);
    
    // Explicitly request wake lock on user gesture
    if (newState) {
      requestWakeLock();
    }
  };


  // AI Handler
  const handleAiGeneration = async () => {
    if (!incidentText.trim()) return;
    setIsGenerating(true);
    setGeneratedMsg("");
    
    const contextStr = lastLocation 
      ? `${lastLocation.lat.toFixed(4)}, ${lastLocation.lng.toFixed(4)}` 
      : "Unknown Location";
      
    const result = await generateAnnouncement(incidentText, {
      speed: (currentSpeed || 0) * 3.6,
      location: contextStr
    });
    
    setGeneratedMsg(result);
    setIsGenerating(false);
  };

  // --- TRIP SETUP SCREEN ---
  if (!isSetupComplete) {
    return (
      <div 
        className="h-screen w-full bg-slate-950 flex flex-col p-6 items-center justify-center space-y-8 select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="text-center space-y-2">
           <div className="text-xs text-slate-500 font-mono tracking-widest uppercase">Driver App</div>
           <h1 className="text-3xl font-bold text-white">OmniTrack</h1>
           <p className="text-slate-400">Configure your trip to start</p>
        </div>

        <div className="w-full max-w-sm space-y-6">
           <div className="space-y-2">
             <label className="text-xs text-slate-500 font-bold uppercase">Bus Number / ID</label>
             <input 
               type="text" 
               placeholder="e.g., BUS-042" 
               value={busId}
               onChange={(e) => setBusId(e.target.value.toUpperCase())}
               className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-center text-2xl font-mono font-bold text-white focus:border-emerald-500 focus:outline-none placeholder-slate-700 uppercase"
             />
           </div>

           <div className="space-y-2">
             <label className="text-xs text-slate-500 font-bold uppercase">Direction</label>
             <div className="grid grid-cols-2 gap-3">
               <button 
                 onClick={() => setDirection('northbound')}
                 className={`p-4 rounded-xl font-bold border-2 transition-all active:scale-95 ${direction === 'northbound' ? 'border-emerald-500 bg-emerald-900/20 text-emerald-400' : 'border-slate-800 bg-slate-900 text-slate-500'}`}
               >
                 Northbound
               </button>
               <button 
                 onClick={() => setDirection('southbound')}
                 className={`p-4 rounded-xl font-bold border-2 transition-all active:scale-95 ${direction === 'southbound' ? 'border-emerald-500 bg-emerald-900/20 text-emerald-400' : 'border-slate-800 bg-slate-900 text-slate-500'}`}
               >
                 Southbound
               </button>
             </div>
           </div>
        </div>

        <button 
          onClick={() => setIsSetupComplete(true)}
          disabled={!busId || busId.length < 3}
          className="w-full max-w-sm py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 rounded-xl font-bold text-lg shadow-lg shadow-emerald-900/20 active:scale-95 transition-transform"
        >
          START SHIFT
        </button>

        <div className="absolute bottom-6">
           <button onClick={() => setShowConfigModal(true)} className="text-slate-600 text-sm underline p-4">Server Settings</button>
        </div>

        {/* Config Modal */}
        {showConfigModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
             <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm p-6">
                <h3 className="text-white font-bold mb-4">Firebase Config</h3>
                <div className="space-y-3 mb-4">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Database URL</label>
                      <input className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-sm text-white" value={fbConfig.databaseURL} onChange={e => setFbConfig({...fbConfig, databaseURL: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">API Key</label>
                      <input className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-sm text-white" value={fbConfig.apiKey} onChange={e => setFbConfig({...fbConfig, apiKey: e.target.value})} />
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-slate-400">Cancel</button>
                    <button onClick={saveConfig} className="px-4 py-2 bg-emerald-600 text-white rounded">Save</button>
                </div>
             </div>
          </div>
        )}
      </div>
    );
  }

  // --- DASHBOARD SCREEN ---
  return (
    <div 
      className="h-screen w-full bg-slate-950 flex flex-col overflow-hidden relative touch-none select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      
      {/* App Bar */}
      <div className="flex-none bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center z-10 safe-top">
        <div onClick={() => setShowLogs(!showLogs)}>
           <div className="text-xs text-slate-500 font-mono tracking-widest uppercase">
             {busId} • <span className="text-emerald-500">{direction.toUpperCase()}</span>
           </div>
           <div className="font-bold text-slate-100 text-lg flex items-center gap-2">
             OmniTrack
             {isTracking && <span className="animate-pulse w-2 h-2 rounded-full bg-red-500"></span>}
           </div>
        </div>
        <button onClick={() => setIsSetupComplete(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-400 text-xs font-bold border border-slate-700 active:bg-slate-700">
          END SHIFT
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-grow flex flex-col p-4 space-y-4 overflow-y-auto">
        
        {/* Status Banner */}
        <div className={`flex items-center justify-between p-4 rounded-xl border ${
            statusType === 'error' ? 'bg-red-900/20 border-red-800/50 text-red-400' :
            statusType === 'success' ? 'bg-emerald-900/20 border-emerald-800/50 text-emerald-400' :
            'bg-slate-900 border-slate-800 text-slate-400'
        } transition-colors duration-300`}>
             <div className="flex items-center gap-3 overflow-hidden">
                <div className={`w-3 h-3 shrink-0 rounded-full ${isTracking ? 'animate-pulse bg-emerald-500' : 'bg-slate-600'}`}></div>
                <span className="font-mono text-sm font-bold uppercase truncate">{statusMessage}</span>
             </div>
        </div>

        {/* Speedometer (Hero Metric) */}
        <div className="flex-none bg-slate-900 rounded-3xl border border-slate-800 p-6 flex flex-col items-center justify-center py-8 shadow-inner">
            <div className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-2">Current Speed</div>
            <div className="flex items-baseline gap-2">
                <span className="text-8xl font-mono font-bold text-white tracking-tighter">
                    {((currentSpeed || 0) * 3.6).toFixed(0)}
                </span>
                <span className="text-xl text-slate-500 font-medium">KM/H</span>
            </div>
        </div>

        {/* Debug Logs (Toggleable) */}
        {showLogs && (
           <div className="mb-2">
              <StatusLog logs={logs} />
           </div>
        )}

        {/* Secondary Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
             <TelemetryCard 
                label="Last Sync" 
                value={lastSentTime} 
                icon="fa-clock" 
                unit=""
                color="default"
            />
            <TelemetryCard 
                label="Battery" 
                value={Math.round(batteryLevel)} 
                unit="%" 
                icon={isCharging ? "fa-bolt" : "fa-battery-half"} 
                color={batteryLevel < 20 ? 'danger' : 'success'} 
            />
            <TelemetryCard 
                label="Bus ID" 
                value={busId}
                icon="fa-bus" 
                color="default"
            />
            <TelemetryCard 
                label="Route" 
                value={direction === 'northbound' ? 'NB' : 'SB'} 
                icon="fa-route" 
                color="default"
            />
        </div>

        {!isTracking && (
          <div className="p-4 bg-amber-900/20 border border-amber-900/50 rounded-xl">
             <p className="text-amber-200 text-xs text-center font-bold">
               ⚠️ KEEP SCREEN ON AND APP OPEN WHILE DRIVING
             </p>
          </div>
        )}

      </div>

      {/* Footer Controls */}
      <div className="flex-none p-4 pb-8 bg-slate-900 border-t border-slate-800 flex flex-col gap-3 safe-bottom">
          
          <button
            onClick={toggleTracking}
            className={`w-full py-6 rounded-xl font-bold text-2xl shadow-lg transform active:scale-[0.98] transition-all flex items-center justify-center gap-3 ${
                isTracking 
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-900/20' 
                : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-900/20'
            }`}
            >
            <i className={`fas ${isTracking ? 'fa-stop-circle' : 'fa-play-circle'} text-3xl`}></i>
            {isTracking ? 'STOP TRACKING' : 'START TRACKING'}
          </button>

          <button
            onClick={() => setShowIncidentModal(true)}
            className="w-full py-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold border border-slate-700 transition flex items-center justify-center gap-2 active:bg-slate-700"
          >
            <i className="fas fa-bullhorn text-amber-400"></i>
            Broadcast Incident
          </button>
      </div>

      {/* Incident Modal */}
      {showIncidentModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border-t sm:border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 pb-10 sm:pb-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <i className="fas fa-robot text-emerald-400"></i> AI Assistant
                </h2>
                <button onClick={() => setShowIncidentModal(false)} className="w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center active:bg-slate-700">
                  <i className="fas fa-times"></i>
                </button>
              </div>
              
              {!generatedMsg ? (
                  <>
                    <p className="text-slate-400 text-sm mb-3">What's happening?</p>
                    <textarea
                        value={incidentText}
                        onChange={(e) => setIncidentText(e.target.value)}
                        placeholder="e.g. Flat tire, traffic delayed 10m..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-4 text-white text-lg focus:border-emerald-500 focus:outline-none min-h-[120px] mb-4"
                    />
                    <button
                        onClick={handleAiGeneration}
                        disabled={isGenerating || !incidentText}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-lg active:scale-[0.98] transition-transform"
                    >
                        {isGenerating ? <i className="fas fa-spinner fa-spin"></i> : 'Generate Alert'}
                    </button>
                  </>
              ) : (
                  <div className="space-y-4">
                      <div className="bg-emerald-900/20 border border-emerald-900/50 p-4 rounded-lg">
                        <p className="text-emerald-100 text-lg leading-relaxed">"{generatedMsg}"</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                            onClick={() => {
                            navigator.clipboard.writeText(generatedMsg);
                            setShowIncidentModal(false);
                            setGeneratedMsg("");
                            setStatusMessage("Copied to Clipboard");
                            setStatusType("success");
                            }}
                            className="py-4 bg-slate-800 text-white rounded-lg font-semibold active:bg-slate-700"
                        >
                            Copy
                        </button>
                        <button 
                             onClick={() => setGeneratedMsg("")}
                             className="py-4 bg-emerald-600 text-slate-900 rounded-lg font-bold active:bg-emerald-500"
                        >
                            New
                        </button>
                      </div>
                  </div>
              )}
          </div>
        </div>
      )}

    </div>
  );
};

export default App;