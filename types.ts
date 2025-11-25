export interface BusTelemetry {
  busId: string;         // e.g., "BUS-402"
  direction: 'northbound' | 'southbound';
  routeId: string;       // e.g., "alabang-lawton"
  timestamp: number;
  latitude: number;
  longitude: number;
  speed: number | null; // in meters/second
  heading: number | null;
  batteryLevel: number | null; // 0.0 to 1.0
  isCharging: boolean | null;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

// Battery API extension
export interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  onchargingchange: EventListenerOrEventListenerObject | null;
  onlevelchange: EventListenerOrEventListenerObject | null;
}

declare global {
  interface Navigator {
    getBattery?: () => Promise<BatteryManager>;
  }
  // Wake Lock API types (Partial)
  interface WakeLockSentinel extends EventTarget {
    readonly released: boolean;
    release: () => Promise<void>;
  }
  interface WakeLock {
    request(type: 'screen'): Promise<WakeLockSentinel>;
  }
  interface Navigator {
    readonly wakeLock: WakeLock;
  }
}