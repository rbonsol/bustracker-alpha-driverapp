import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  BackHandler,
} from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BusTelemetry, LogEntry } from './types';
import { pushTelemetry, initializeFirebase } from './services/dataService';
import { DEFAULT_CONFIG } from './services/firebaseConfig';
import { generateAnnouncement } from './services/geminiService';
import { TelemetryCard } from './components/TelemetryCard';
import { StatusLog } from './components/StatusLog';
import * as ExpoCrypto from 'expo-crypto';
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
const getStoredConfig = async () => {
  try {
    const stored = await AsyncStorage.getItem('omni_firebase_config');
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error("Failed to parse stored config", e);
  }
  return DEFAULT_CONFIG;
};

const App: React.FC = () => {
  // Trip Configuration State
  const [busId, setBusId] = useState("");
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
  const [fbConfig, setFbConfig] = useState(DEFAULT_CONFIG);

  // Logging Helper
  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev.slice(-49), { // Keep last 50 logs
      id: ExpoCrypto.randomUUID(),
      timestamp: new Date(),
      type,
      message
    }]);
  }, []);

  // Load persisted data on mount
  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const storedBusId = await AsyncStorage.getItem('omni_bus_id');
        if (storedBusId) setBusId(storedBusId);
        
        const storedConfig = await AsyncStorage.getItem('omni_firebase_config');
        if (storedConfig) setFbConfig(JSON.parse(storedConfig));
      } catch (e) {
        console.error('Failed to load stored data', e);
      }
    };
    loadStoredData();
  }, []);

  // PERSISTENCE: Save busId when changed
  useEffect(() => {
    AsyncStorage.setItem('omni_bus_id', busId);
  }, [busId]);

  // ANDROID BACK BUTTON HANDLING
  useEffect(() => {
    const handleBackPress = () => {
      if (isTracking) {
        setStatusMessage("Stop tracking first!");
        addLog('warning', "Back button pressed while tracking");
        return true; // Prevent default back behavior
      }
      return false; // Allow default back behavior
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, [isTracking, addLog]);


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

    return () => {
      if (interval) clearInterval(interval);
      wakeLockRef.current?.release();
    };
  }, [isTracking, requestWakeLock]);

  const saveConfig = async () => {
    await AsyncStorage.setItem('omni_firebase_config', JSON.stringify(fbConfig));
    setShowConfigModal(false);
    setStatusMessage("Config Saved");
    addLog('success', 'Configuration updated');
    setTimeout(() => setStatusMessage("Ready"), 1500);
  };

  // Battery Monitor
  useEffect(() => {
    let batteryInterval: NodeJS.Timeout;
    
    const updateBattery = async () => {
      try {
        const level = await Battery.getBatteryLevelAsync();
        const isChargingStatus = await (Battery as any).isChargingAsync?.() ?? false;
        setBatteryLevel(level * 100);
        setIsCharging(isChargingStatus);
      } catch (error) {
        console.warn('Battery API not available:', error);
      }
    };
    
    // Update battery immediately
    updateBattery();
    
    // Update battery every 5 seconds
    batteryInterval = setInterval(updateBattery, 5000);
    
    return () => clearInterval(batteryInterval);
  }, []);

  // Core Logic: Process Position Update
  const processPosition = useCallback(async (position: any) => {
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
      if (!(navigator as any).geolocation) {
        setStatusMessage("GPS Not Supported");
        addLog('error', 'Navigator.geolocation missing');
        return;
      }

      addLog('info', 'Starting GPS Watch...');
      
      // watchPosition is better for Android background tracking than setInterval
      watchIdRef.current = (navigator as any).geolocation.watchPosition(
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
        (navigator as any).geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
        setStatusMessage("Tracking Paused");
        setStatusType('normal');
        addLog('info', 'Tracking Stopped');
      }
    }

    return () => {
      if (watchIdRef.current !== null) {
        (navigator as any).geolocation.clearWatch(watchIdRef.current);
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
      <SafeAreaView style={styles.setupContainer}>
        <ScrollView contentContainerStyle={styles.setupContent}>
          <View style={styles.setupHeader}>
            <Text style={styles.setupSubtitle}>Driver App</Text>
            <Text style={styles.setupTitle}>OmniTrack</Text>
            <Text style={styles.setupDescription}>Configure your trip to start</Text>
          </View>

          <View style={styles.setupForm}>
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Bus Number / ID</Text>
              <TextInput
                style={styles.busIdInput}
                placeholder="e.g., BUS-042"
                value={busId}
                onChangeText={(text) => setBusId(text.toUpperCase())}
                placeholderTextColor="#64748b"
                maxLength={20}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Direction</Text>
              <View style={styles.directionGrid}>
                <TouchableOpacity
                  style={[styles.directionBtn, direction === 'northbound' && styles.directionBtnActive]}
                  onPress={() => setDirection('northbound')}
                >
                  <Text style={[styles.directionBtnText, direction === 'northbound' && styles.directionBtnTextActive]}>
                    Northbound
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.directionBtn, direction === 'southbound' && styles.directionBtnActive]}
                  onPress={() => setDirection('southbound')}
                >
                  <Text style={[styles.directionBtnText, direction === 'southbound' && styles.directionBtnTextActive]}>
                    Southbound
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.startBtn, (!busId || busId.length < 3) && styles.startBtnDisabled]}
            disabled={!busId || busId.length < 3}
            onPress={() => setIsSetupComplete(true)}
          >
            <Text style={styles.startBtnText}>START SHIFT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => setShowConfigModal(true)}
          >
            <Text style={styles.settingsBtnText}>Server Settings</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Config Modal */}
        <Modal
          visible={showConfigModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowConfigModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.configModal}>
              <Text style={styles.configTitle}>Firebase Config</Text>
              <View style={styles.configInputGroup}>
                <Text style={styles.configLabel}>Database URL</Text>
                <TextInput
                  style={styles.configInput}
                  value={fbConfig.databaseURL}
                  onChangeText={(text) => setFbConfig({...fbConfig, databaseURL: text})}
                  placeholderTextColor="#64748b"
                />
              </View>
              <View style={styles.configInputGroup}>
                <Text style={styles.configLabel}>API Key</Text>
                <TextInput
                  style={styles.configInput}
                  value={fbConfig.apiKey}
                  onChangeText={(text) => setFbConfig({...fbConfig, apiKey: text})}
                  placeholderTextColor="#64748b"
                />
              </View>
              <View style={styles.configButtonGroup}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setShowConfigModal(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={saveConfig}
                >
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // --- DASHBOARD SCREEN ---
  return (
    <SafeAreaView style={styles.dashboardContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      
      {/* App Bar */}
      <View style={styles.appBar}>
        <TouchableOpacity onPress={() => setShowLogs(!showLogs)}>
          <Text style={styles.busInfo}>{busId} • {direction === 'northbound' ? 'NB' : 'SB'}</Text>
          <View style={styles.titleRow}>
            <Text style={styles.appTitle}>OmniTrack</Text>
            {isTracking && <View style={styles.trackingDot} />}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.endShiftBtn}
          onPress={() => setIsSetupComplete(false)}
        >
          <Text style={styles.endShiftBtnText}>END SHIFT</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Status Banner */}
        <View style={[styles.statusBanner, statusType === 'error' ? styles.statusError : statusType === 'success' ? styles.statusSuccess : styles.statusNormal]}>
          <View style={[styles.statusDot, {backgroundColor: isTracking ? '#10b981' : '#475569'}]} />
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>

        {/* Speedometer */}
        <View style={styles.speedometer}>
          <Text style={styles.speedLabel}>Current Speed</Text>
          <View style={styles.speedValue}>
            <Text style={styles.speedNumber}>{((currentSpeed || 0) * 3.6).toFixed(0)}</Text>
            <Text style={styles.speedUnit}>KM/H</Text>
          </View>
        </View>

        {/* Debug Logs */}
        {showLogs && <StatusLog logs={logs} />}

        {/* Metrics Grid */}
        <View style={styles.metricsGrid}>
          <TelemetryCard label="Last Sync" value={lastSentTime} unit="" color="default" />
          <TelemetryCard label="Battery" value={Math.round(batteryLevel)} unit="%" color={batteryLevel < 20 ? 'danger' : 'success'} />
          <TelemetryCard label="Bus ID" value={busId} color="default" />
          <TelemetryCard label="Route" value={direction === 'northbound' ? 'NB' : 'SB'} color="default" />
        </View>

        {!isTracking && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>⚠️ KEEP SCREEN ON AND APP OPEN WHILE DRIVING</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer Controls */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.trackingBtn, isTracking && styles.trackingBtnActive]}
          onPress={toggleTracking}
        >
          <Text style={styles.trackingBtnText}>
            {isTracking ? 'STOP TRACKING' : 'START TRACKING'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.incidentBtn}
          onPress={() => setShowIncidentModal(true)}
        >
          <Text style={styles.incidentBtnText}>Broadcast Incident</Text>
        </TouchableOpacity>
      </View>

      {/* Incident Modal */}
      <Modal
        visible={showIncidentModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowIncidentModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.incidentModal}>
            <View style={styles.incidentHeader}>
              <Text style={styles.incidentTitle}>AI Assistant</Text>
              <TouchableOpacity onPress={() => setShowIncidentModal(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {!generatedMsg ? (
              <>
                <Text style={styles.incidentPrompt}>What's happening?</Text>
                <TextInput
                  style={styles.incidentInput}
                  value={incidentText}
                  onChangeText={setIncidentText}
                  placeholder="e.g. Flat tire, traffic delayed 10m..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={4}
                />
                <TouchableOpacity
                  style={[styles.generateBtn, isGenerating && styles.generateBtnDisabled]}
                  onPress={handleAiGeneration}
                  disabled={isGenerating || !incidentText}
                >
                  <Text style={styles.generateBtnText}>
                    {isGenerating ? 'Generating...' : 'Generate Alert'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.generatedMsgBox}>
                  <Text style={styles.generatedMsg}>"{generatedMsg}"</Text>
                </View>
                <View style={styles.incidentActionGrid}>
                  <TouchableOpacity
                    style={styles.copyBtn}
                    onPress={() => {
                      // Copy to clipboard - would need Share API or clipboard library
                      setShowIncidentModal(false);
                      setGeneratedMsg("");
                      setStatusMessage("Copied to Clipboard");
                      setStatusType("success");
                    }}
                  >
                    <Text style={styles.copyBtnText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.newBtn}
                    onPress={() => setGeneratedMsg("")}
                  >
                    <Text style={styles.newBtnText}>New</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // Setup Screen
  setupContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  setupContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  setupHeader: {
    alignItems: 'center',
    marginBottom: 48,
  },
  setupSubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 8,
  },
  setupTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  setupDescription: {
    fontSize: 14,
    color: '#94a3b8',
  },
  setupForm: {
    width: '100%',
    maxWidth: 340,
    marginBottom: 32,
  },
  formGroup: {
    marginBottom: 24,
  },
  formLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  busIdInput: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  directionGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  directionBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
    alignItems: 'center',
  },
  directionBtnActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  directionBtnText: {
    fontWeight: '600',
    color: '#64748b',
    fontSize: 14,
  },
  directionBtnTextActive: {
    color: '#10b981',
  },
  startBtn: {
    width: '100%',
    maxWidth: 340,
    paddingVertical: 16,
    backgroundColor: '#10b981',
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  startBtnDisabled: {
    opacity: 0.3,
  },
  startBtnText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 'bold',
  },
  settingsBtn: {
    padding: 12,
  },
  settingsBtnText: {
    color: '#475569',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  configModal: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 320,
  },
  configTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  configInputGroup: {
    marginBottom: 16,
  },
  configLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
  },
  configInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
  },
  configButtonGroup: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  cancelBtnText: {
    color: '#64748b',
    fontSize: 14,
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#059669',
    borderRadius: 6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Dashboard
  dashboardContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  busInfo: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e2e8f0',
  },
  trackingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  endShiftBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#334155',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
  },
  endShiftBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    gap: 16,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  statusNormal: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  statusError: {
    backgroundColor: 'rgba(127, 29, 29, 0.2)',
    borderColor: 'rgba(153, 27, 27, 0.5)',
  },
  statusSuccess: {
    backgroundColor: 'rgba(22, 101, 52, 0.2)',
    borderColor: 'rgba(21, 128, 61, 0.5)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  speedometer: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 24,
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  speedValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  speedNumber: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#fff',
  },
  speedUnit: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  warningBanner: {
    backgroundColor: 'rgba(120, 53, 15, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(180, 83, 9, 0.5)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  warningText: {
    color: '#fde68a',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 12,
  },
  trackingBtn: {
    paddingVertical: 20,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
  },
  trackingBtnActive: {
    backgroundColor: '#ef4444',
  },
  trackingBtnText: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: 'bold',
  },
  incidentBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#334155',
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
  },
  incidentBtnText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  incidentModal: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  incidentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  incidentTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  closeBtn: {
    fontSize: 24,
    color: '#64748b',
  },
  incidentPrompt: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 12,
  },
  incidentInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    textAlignVertical: 'top',
    minHeight: 100,
    marginBottom: 16,
  },
  generateBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#059669',
    alignItems: 'center',
  },
  generateBtnDisabled: {
    opacity: 0.5,
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  generatedMsgBox: {
    backgroundColor: 'rgba(22, 101, 52, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(21, 128, 61, 0.5)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  generatedMsg: {
    color: '#d1fae5',
    fontSize: 16,
    lineHeight: 24,
  },
  incidentActionGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  copyBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#334155',
    borderRadius: 8,
    alignItems: 'center',
  },
  copyBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  newBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#059669',
    borderRadius: 8,
    alignItems: 'center',
  },
  newBtnText: {
    color: '#0f172a',
    fontWeight: 'bold',
  },
});

export default App;