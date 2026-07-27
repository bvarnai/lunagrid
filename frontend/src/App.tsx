import React, { useState, useEffect } from 'react';

interface Location {
  id: string;
  name: string;
  timezone: string;
  notifications_disabled?: number;
  car_away_schedule_enabled?: number;
  car_away_schedule_from?: string;
  car_away_schedule_to?: string;
  ev_wakeup_enabled?: number;
  ev_wakeup_type?: string;
  ev_wakeup_target?: string;
  ev_wakeup_headers?: string;
  ev_automation_enabled?: number;
  ev_automation_type?: string;
  ev_automation_target?: string;
  ev_automation_headers?: string;
}

interface Automation {
  id?: number;
  location_id: string;
  enabled: number;
  type: string;
  target: string;
  headers: string;
}

interface Device {
  id: string;
  location_id: string | null;
  friendly_name: string | null;
  status: 'PENDING' | 'ACTIVE';
}

interface Telemetry {
  gridActive: boolean;
  uptime: number;
  freeHeap: number;
  wifiRssi: number;
  timestamp: number;
  deviceId: string | null;
  friendlyName: string | null;
  firmwareVersion: string | null;
  connectionStatus?: 'ONLINE' | 'OFFLINE' | 'DISCONNECTED';
}

interface FirmwareRelease {
  version: string;
  url: string;
  description: string;
  released_at?: string;
}

interface RolloutStatus {
  version: string;
  totalCount: number;
  updatedCount: number;
  percentage: number;
  devices: Array<{
    deviceId: string;
    friendlyName: string | null;
    currentVersion: string;
    isUpdated: boolean;
  }>;
}

interface HistoryItem {
  time: string;
  value: number; // 0.0 to 1.0 representing active fraction
}

interface ComplianceItem {
  date: string;
  activeHours: number;
  compliant: boolean;
}

// Helper to generate a stable, secure-looking hash suffix from a string
const getStableSuffix = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).substring(0, 6);
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'management' | 'settings' | 'history'>('dashboard');
  
  // Settings - Read from LocalStorage or default
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() => {
    return localStorage.getItem('lunagrid_api_url') || 'http://localhost:3000';
  });
  const [tempApiUrl, setTempApiUrl] = useState<string>(apiBaseUrl);

  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(() => {
    return localStorage.getItem('lunagrid_show_diagnostics') === 'true';
  });
  const [tempShowDiagnostics, setTempShowDiagnostics] = useState<boolean>(showDiagnostics);

  const [locations, setLocations] = useState<Location[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(() => {
    return localStorage.getItem('lunagrid_selected_location_id') || '';
  });
  
  // Real-time Telemetry and History States
  const [telemetry, setTelemetry] = useState<Telemetry>({
    gridActive: false,
    uptime: 0,
    freeHeap: 0,
    wifiRssi: 0,
    timestamp: 0,
    deviceId: null,
    friendlyName: null,
    firmwareVersion: null,
    connectionStatus: 'DISCONNECTED'
  });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [compliance, setCompliance] = useState<ComplianceItem[]>([]);
  const [isMockMode, setIsMockMode] = useState<boolean>(() => {
    return localStorage.getItem('lunagrid_mock_mode') === 'true';
  });
  const [tempForceMockMode, setTempForceMockMode] = useState<boolean>(isMockMode);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);
  const isBackendConnected = !isMockMode && isBackendOnline;
  const [logs, setLogs] = useState<string[]>([]);

  // New Range History States
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [rangeHistory, setRangeHistory] = useState<Array<{ time: string; value: number }>>([]);
  const [isRangeLoading, setIsRangeLoading] = useState<boolean>(false);

  // EV Charging Estimator States (persisted in local storage)
  const [chargingPower, setChargingPower] = useState<number | "">(() => {
    const saved = localStorage.getItem('lunagrid_charging_power');
    return (saved !== null && saved !== "") ? parseFloat(saved) : 11.0;
  });
  const [windowStartHour, setWindowStartHour] = useState<number>(() => {
    const saved = localStorage.getItem('lunagrid_window_start_hour');
    return saved ? parseInt(saved) : 20; // 8 PM
  });
  const [windowEndHour, setWindowEndHour] = useState<number>(() => {
    const saved = localStorage.getItem('lunagrid_window_end_hour');
    return saved ? parseInt(saved) : 6; // 6 AM
  });
  const [evConsumption, setEvConsumption] = useState<number | "">(() => {
    const saved = localStorage.getItem('lunagrid_ev_consumption');
    return (saved !== null && saved !== "") ? parseFloat(saved) : 18.0; // kWh / 100 km
  });

  useEffect(() => {
    localStorage.setItem('lunagrid_charging_power', chargingPower.toString());
    localStorage.setItem('lunagrid_window_start_hour', windowStartHour.toString());
    localStorage.setItem('lunagrid_window_end_hour', windowEndHour.toString());
    localStorage.setItem('lunagrid_ev_consumption', evConsumption.toString());
  }, [chargingPower, windowStartHour, windowEndHour, evConsumption]);

  useEffect(() => {
    if (isMockMode) {
      setupMockFallbacks();
    } else {
      setLocations([]);
      setDevices([]);
      setReleases([]);
      setHistory([]);
      setCompliance([]);
      setTelemetry({
        gridActive: false,
        uptime: 0,
        freeHeap: 0,
        wifiRssi: 0,
        timestamp: 0,
        deviceId: null,
        friendlyName: null,
        firmwareVersion: null
      });
      fetchMetadata();
    }
  }, [isMockMode]);

  // Firmware Releases & Rollout States
  const [releases, setReleases] = useState<FirmwareRelease[]>([]);
  const [newReleaseVersion, setNewReleaseVersion] = useState('');
  const [newReleaseUrl, setNewReleaseUrl] = useState('');
  const [newReleaseDesc, setNewReleaseDesc] = useState('');
  const [rolloutTargetVersion, setRolloutTargetVersion] = useState<string>('');
  const [rolloutStatus, setRolloutStatus] = useState<RolloutStatus | null>(null);

  // Persist selected location ID in LocalStorage when changed
  useEffect(() => {
    if (selectedLocationId) {
      localStorage.setItem('lunagrid_selected_location_id', selectedLocationId);
    } else {
      localStorage.removeItem('lunagrid_selected_location_id');
    }
  }, [selectedLocationId]);

  // Form states for creating location
  const [newLocId, setNewLocId] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocTimezone, setNewLocTimezone] = useState('Europe/Budapest');
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);

  // Form states for editing location
  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [editLocName, setEditLocName] = useState('');
  const [editLocTimezone, setEditLocTimezone] = useState('Europe/Budapest');

  // Form states for editing device friendly name
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editingFriendlyName, setEditingFriendlyName] = useState('');

  // Form states for enrolling pending device
  const [enrollDeviceId, setEnrollDeviceId] = useState('');
  const [enrollFriendlyName, setEnrollFriendlyName] = useState('');
  const [enrollLocationId, setEnrollLocationId] = useState('');
  const [showEnrollForm, setShowEnrollForm] = useState(false);

  // Temporary input states for EV charging automation settings to prevent periodic poll overwrites while typing
  const [tempAutomationTarget, setTempAutomationTarget] = useState<Record<string, string>>({});
  const [tempAutomationHeaders, setTempAutomationHeaders] = useState<Record<string, string>>({});

  // 1. Fetch Metadata (Locations, Devices, and Releases)
  const fetchMetadata = async () => {
    if (isMockMode) {
      setupMockFallbacks();
      setIsBackendOnline(false);
      return;
    }
    try {
      const locRes = await fetch(`${apiBaseUrl}/api/locations`);
      const devRes = await fetch(`${apiBaseUrl}/api/devices`);
      const relRes = await fetch(`${apiBaseUrl}/api/releases`);
      const autoRes = await fetch(`${apiBaseUrl}/api/automations`);
      
      if (locRes.ok && devRes.ok) {
        const locData = await locRes.json();
        const devData = await devRes.json();
        setLocations(locData);
        setDevices(devData);
        setIsBackendOnline(true);

        if (autoRes.ok) {
          const autoData = await autoRes.json();
          setAutomations(autoData);
        }

        if (relRes.ok) {
          const relData = await relRes.json();
          setReleases(relData);
        }

        // Auto-select first location if none selected or the selected one is invalid (using functional updater to avoid stale closures)
        setSelectedLocationId(current => {
          const exists = locData.some((loc: Location) => loc.id === current);
          if ((!current || !exists) && locData.length > 0) {
            return locData[0].id;
          }
          return current;
        });
      } else {
        setIsBackendOnline(false);
      }
    } catch (e) {
      console.error('Failed to fetch backend metadata:', e);
      setIsBackendOnline(false);
    }
  };

  // Generate mock history for selected target date range with Yesterday/Tomorrow context
  const generateMockRangeHistory = (dateStr: string) => {
    const target = new Date(dateStr + 'T00:00:00');
    const start = new Date(target.getTime() - 24 * 60 * 60 * 1000);
    const list = [];
    for (let i = 0; i < 72; i++) {
      const time = new Date(start.getTime() + i * 60 * 60 * 1000);
      const hour = time.getHours();
      
      const str = dateStr + hour + i;
      let hash = 0;
      for (let c = 0; c < str.length; c++) {
        hash = (hash << 5) - hash + str.charCodeAt(c);
        hash |= 0;
      }
      const rand = Math.abs(hash) % 100 / 100;
      
      const isBTariffON = (hour >= 22 || hour < 6) || (hour >= 12 && hour < 14);
      const value = (rand < 0.15) ? (isBTariffON ? 0.0 : 1.0) : (isBTariffON ? 1.0 : 0.0);
      list.push({ time: time.toISOString(), value });
    }
    setRangeHistory(list);
  };

  // Fetch range history for the active location
  const fetchRangeHistory = async () => {
    if (!selectedLocationId) return;
    if (isMockMode) {
      generateMockRangeHistory(selectedHistoryDate);
      return;
    }
    setIsRangeLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/locations/${selectedLocationId}/history/range?date=${selectedHistoryDate}`);
      if (res.ok) {
        const data = await res.json();
        setRangeHistory(data);
      }
    } catch (e) {
      console.error('Failed to fetch range history:', e);
    } finally {
      setIsRangeLoading(false);
    }
  };

  // Map 72h history points to Yesterday, Target, and Tomorrow 24h strips
  const getStripsForRange = () => {
    const targetStart = new Date(selectedHistoryDate + 'T00:00:00').getTime();
    const yesterdayStart = targetStart - 24 * 60 * 60 * 1000;
    const tomorrowStart = targetStart + 24 * 60 * 60 * 1000;

    const yesterdayStrips = [];
    const targetStrips = [];
    const tomorrowStrips = [];

    for (let h = 0; h < 24; h++) {
      yesterdayStrips.push({ label: `${String(h).padStart(2, '0')}:00`, value: null as number | null });
      targetStrips.push({ label: `${String(h).padStart(2, '0')}:00`, value: null as number | null });
      tomorrowStrips.push({ label: `${String(h).padStart(2, '0')}:00`, value: null as number | null });
    }

    for (const point of rangeHistory) {
      const timeMs = new Date(point.time).getTime();
      
      if (timeMs >= yesterdayStart && timeMs < targetStart) {
        const hourIdx = Math.floor((timeMs - yesterdayStart) / (60 * 60 * 1000));
        if (hourIdx >= 0 && hourIdx < 24) {
          yesterdayStrips[hourIdx].value = point.value;
        }
      }
      else if (timeMs >= targetStart && timeMs < tomorrowStart) {
        const hourIdx = Math.floor((timeMs - targetStart) / (60 * 60 * 1000));
        if (hourIdx >= 0 && hourIdx < 24) {
          targetStrips[hourIdx].value = point.value;
        }
      }
      else if (timeMs >= tomorrowStart && timeMs < tomorrowStart + 24 * 60 * 60 * 1000) {
        const hourIdx = Math.floor((timeMs - tomorrowStart) / (60 * 60 * 1000));
        if (hourIdx >= 0 && hourIdx < 24) {
          tomorrowStrips[hourIdx].value = point.value;
        }
      }
    }

    return { yesterdayStrips, targetStrips, tomorrowStrips };
  };

  // 2. Fetch Real-time Telemetry, History, and Compliance metrics for the active location
  const fetchTelemetryAndHistory = async () => {
    if (!selectedLocationId || !isBackendConnected) return;
    
    // Fetch telemetry
    try {
      const telRes = await fetch(`${apiBaseUrl}/api/locations/${selectedLocationId}/telemetry`);
      if (telRes.ok) {
        const telData = await telRes.json();
        setTelemetry(telData);
      }
    } catch (e) {
      console.error('Failed to fetch real-time telemetry:', e);
    }

    // Fetch history
    try {
      const histRes = await fetch(`${apiBaseUrl}/api/locations/${selectedLocationId}/history`);
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData);
      }
    } catch (e) {
      console.error('Failed to fetch real-time history:', e);
    }

    // Fetch compliance
    try {
      const compRes = await fetch(`${apiBaseUrl}/api/locations/${selectedLocationId}/compliance`);
      if (compRes.ok) {
        const compData = await compRes.json();
        setCompliance(compData);
      }
    } catch (e) {
      console.error('Failed to fetch real-time compliance:', e);
    }

    // Fetch Rollout Status if a target is selected
    if (rolloutTargetVersion) {
      try {
        const rolloutRes = await fetch(`${apiBaseUrl}/api/releases/rollout/status?version=${rolloutTargetVersion}`);
        if (rolloutRes.ok) {
          const rolloutData = await rolloutRes.json();
          setRolloutStatus(rolloutData);
        }
      } catch (e) {
        console.error('Failed to fetch rollout status:', e);
      }
    }

    // Fetch ingestion logs (only if diagnostics mode is enabled by user)
    if (showDiagnostics) {
      try {
        const logsRes = await fetch(`${apiBaseUrl}/api/logs`);
        if (logsRes.ok) {
          const logsData: Array<{ timestamp: number; message: string }> = await logsRes.json();
          const formatted = logsData.map(log => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            return `[${timeStr}] ${log.message}`;
          });
          setLogs(formatted);
        }
      } catch (e) {
        console.error('Failed to fetch real-time logs:', e);
      }
    }
  };

  // Handle adding a new firmware release
  const handleAddRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReleaseVersion || !newReleaseUrl) return;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/releases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: newReleaseVersion,
            url: newReleaseUrl,
            description: newReleaseDesc
          })
        });
        if (res.ok) {
          setNewReleaseVersion('');
          setNewReleaseUrl('');
          setNewReleaseDesc('');
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Created new firmware release v${newReleaseVersion}`, ...prev]);
        } else {
          const errData = await res.json();
          alert(errData.error || 'Failed to create release');
        }
      } catch (err) {
        console.error(err);
        alert('Network error: failed to create firmware release');
      }
    } else {
      // Mock add release
      setReleases(prev => [
        { version: newReleaseVersion, url: newReleaseUrl, description: newReleaseDesc },
        ...prev
      ]);
      setNewReleaseVersion('');
      setNewReleaseUrl('');
      setNewReleaseDesc('');
      setLogs(prev => [`[SYSTEM] Created mock firmware release v${newReleaseVersion}`, ...prev]);
    }
  };

  // Handle deleting a firmware release
  const handleDeleteRelease = async (version: string) => {
    if (confirm(`Are you sure you want to delete release version v${version}?`)) {
      if (isBackendConnected) {
        try {
          const res = await fetch(`${apiBaseUrl}/api/releases/${version}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            fetchMetadata();
            setLogs(prev => [`[SYSTEM] Deleted firmware release v${version}`, ...prev]);
            if (rolloutTargetVersion === version) {
              setRolloutTargetVersion('');
              setRolloutStatus(null);
            }
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        // Mock delete
        setReleases(prev => prev.filter(r => r.version !== version));
        setLogs(prev => [`[SYSTEM] Deleted mock firmware release v${version}`, ...prev]);
        if (rolloutTargetVersion === version) {
          setRolloutTargetVersion('');
          setRolloutStatus(null);
        }
      }
    }
  };

  // Trigger rollout of a version
  const handleTriggerRollout = async (version: string) => {
    if (confirm(`Are you sure you want to trigger a firmware rollout of version v${version} to all eligible devices?`)) {
      setRolloutTargetVersion(version);
      if (isBackendConnected) {
        try {
          const res = await fetch(`${apiBaseUrl}/api/releases/rollout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version })
          });
          if (res.ok) {
            const data = await res.json();
            setLogs(prev => [`[SYSTEM] Rollout triggered: ${data.message}`, ...prev]);
            // Initial poll
            const statusRes = await fetch(`${apiBaseUrl}/api/releases/rollout/status?version=${version}`);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              setRolloutStatus(statusData);
            }
          } else {
            const errData = await res.json();
            alert(errData.error || 'Failed to trigger rollout');
          }
        } catch (err) {
          console.error(err);
          alert('Network error: failed to trigger rollout');
        }
      } else {
        // Mock trigger rollout: initialize status
        const total = devices.filter(d => d.status === 'ACTIVE').length;
        setRolloutStatus({
          version,
          totalCount: total,
          updatedCount: 0,
          percentage: 0,
          devices: devices.filter(d => d.status === 'ACTIVE').map(d => ({
            deviceId: d.id,
            friendlyName: d.friendly_name,
            currentVersion: '1.0.0',
            isUpdated: false
          }))
        });
        setLogs(prev => [`[SYSTEM] Rollout triggered locally for mock release v${version}`, ...prev]);
      }
    }
  };

  // Populate mock data if backend offline (so the app works standalone)
  const setupMockFallbacks = () => {
    const mockLocs = [
      { id: 'budapest-home-1', name: 'Budapest Main House (Mock)', timezone: 'Europe/Budapest' },
      { id: 'balaton-cottage', name: 'Balaton Cottage (Mock)', timezone: 'Europe/Budapest' }
    ];
    const mockDevs = [
      { id: 'lunagrid_c3_mock_1', location_id: 'budapest-home-1', friendly_name: 'Water Heater Sensor', status: 'ACTIVE' as const },
      { id: 'lunagrid_c3_mock_2', location_id: null, friendly_name: null, status: 'PENDING' as const }
    ];
    setLocations(mockLocs);
    setDevices(mockDevs);

    // Seed mock releases
    const mockReleases = [
      { version: '1.0.0', url: 'http://nas48.vbl.hu/lunagrid/releases/firmware_v1.0.0.bin', description: 'Initial stable rollout version.' },
      { version: '1.1.0', url: 'http://nas48.vbl.hu/lunagrid/releases/firmware_v1.1.0.bin', description: 'Reduced telemetry interval to 5 mins and optimized memory heap usage.' }
    ];
    setReleases(mockReleases);

    // Setup 30h mock history of hourly averages
    const mockHistory: HistoryItem[] = [];
    const baseTime = new Date();
    baseTime.setMinutes(0, 0, 0); // Align to start of hour
    for (let i = 30; i >= 0; i--) {
      const d = new Date(baseTime.getTime() - i * 60 * 60 * 1000);
      const hour = d.getHours();
      
      let val = 0.0;
      if (hour >= 22 || hour < 6 || (hour >= 13 && hour < 17)) {
        val = 1.0;
      } else if (hour === 21 || hour === 6 || hour === 12 || hour === 17) {
        // Randomly assign partial fractions (25%, 50%, 75%)
        const fracs = [0.25, 0.5, 0.75];
        val = fracs[(i + hour) % fracs.length];
      }

      mockHistory.push({
        time: d.toISOString(),
        value: val
      });
    }
    setHistory(mockHistory);

    // Generate mock compliance data for the last 7 calendar days
    const mockCompliance = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const targetTime = now - i * 24 * 60 * 60 * 1000;
      const d = new Date(targetTime);
      const dayName = dayNames[d.getDay()];
      const dateLabel = `${dayName}, ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      
      // Simulate that two of the days fail B-tariff compliance
      const activeHours = i === 2 || i === 5 ? 6.8 : 8.2 + (i % 3) * 0.5;
      mockCompliance.push({
        date: dateLabel,
        activeHours: activeHours,
        compliant: activeHours >= 8.0
      });
    }
    setCompliance(mockCompliance);

    // Seed mock automations
    const mockAutomations = [
      { id: 1, location_id: 'budapest-home-1', enabled: 1, type: 'webhook', target: 'http://192.168.1.50:8123/api/webhook/ev_charging', headers: '{"Authorization": "Bearer token123"}' },
      { id: 2, location_id: 'budapest-home-1', enabled: 0, type: 'mqtt', target: 'evcc/charger/status', headers: '{"on": "C", "off": "A"}' }
    ];
    setAutomations(mockAutomations);

    // Auto-select first location if none selected or the selected one is invalid (using functional updater to avoid stale closures)
    setSelectedLocationId(current => {
      const exists = mockLocs.some(loc => loc.id === current);
      if ((!current || !exists) && mockLocs.length > 0) {
        return mockLocs[0].id;
      }
      return current;
    });
  };

  // Run mock simulator only if mock mode is enabled
  useEffect(() => {
    if (!isMockMode) return;
    
    // Simulate real-time logs/telemetry locally
    const timer = setInterval(() => {
      if (document.hidden) return; // Pause simulator updates when tab is inactive

      // Simulate mock rollout updates
      if (rolloutTargetVersion && rolloutStatus) {
        setRolloutStatus(prev => {
          if (!prev) return null;
          if (prev.updatedCount >= prev.totalCount) return prev;
          
          const newDevices = prev.devices.map(d => {
            if (!d.isUpdated && Math.random() < 0.25) {
              return { ...d, currentVersion: prev.version, isUpdated: true };
            }
            return d;
          });
          const updated = newDevices.filter(d => d.isUpdated).length;
          const pct = Math.round((updated / prev.totalCount) * 100);
          
          const newlyUpdated = newDevices.find((d, idx) => d.isUpdated && !prev.devices[idx].isUpdated);
          if (newlyUpdated) {
            const nowStr = new Date().toLocaleTimeString();
            setLogs(prevLogs => [`[${nowStr}] [MOCK OTA] Device ${newlyUpdated.deviceId} successfully flashed and rebooted to v${prev.version}`, ...prevLogs.slice(0, 5)]);
          }

          return {
            ...prev,
            devices: newDevices,
            updatedCount: updated,
            percentage: pct
          };
        });
      }

      setTelemetry(prev => {
        const toggleState = Math.random() < 0.1;
        const newGridState = toggleState ? !prev.gridActive : prev.gridActive;
        if (toggleState && showDiagnostics) {
          const now = new Date().toLocaleTimeString();
          setLogs(prevLogs => [`[${now}] Mock Grid toggled to ${newGridState ? 'B-Tariff ON' : 'B-Tariff OFF'}`, ...prevLogs.slice(0, 5)]);
        }
        
        let currentVer = prev.firmwareVersion || '1.0.0';
        if (rolloutTargetVersion && rolloutStatus) {
          const matchedDevice = rolloutStatus.devices.find(d => d.deviceId === 'lunagrid_c3_mock_1');
          if (matchedDevice) {
            currentVer = matchedDevice.currentVersion;
          }
        }

        return {
          gridActive: newGridState,
          uptime: prev.uptime + 2,
          freeHeap: 180000 + Math.floor(Math.random() * 5000),
          wifiRssi: -65 + Math.floor(Math.random() * 10 - 5),
          timestamp: Date.now(),
          deviceId: 'lunagrid_c3_mock_1',
          friendlyName: 'Mock Contactor',
          firmwareVersion: currentVer,
          connectionStatus: 'ONLINE'
        };
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [isMockMode, selectedLocationId, showDiagnostics, rolloutTargetVersion, rolloutStatus]);

  // Handle periodic metadata fetching
  useEffect(() => {
    const poll = () => {
      if (document.hidden) return; // Pause polling when tab is inactive
      fetchMetadata();
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [apiBaseUrl, isMockMode]);

  // Handle periodic telemetry polling
  useEffect(() => {
    const poll = () => {
      if (document.hidden) return; // Pause polling when tab is inactive
      fetchTelemetryAndHistory();
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [selectedLocationId, isBackendOnline, isMockMode, showDiagnostics]);

  // Handle history range polling/updates
  useEffect(() => {
    fetchRangeHistory();
  }, [selectedLocationId, selectedHistoryDate, isMockMode, isBackendOnline]);

  // --- API Handlers ---
  
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${tempApiUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setTestResult({
          success: true,
          message: `🟢 Connection Successful! Status: ${data.status} | API Version: ${data.version || '1.0.0'}`
        });
      } else {
        setTestResult({
          success: false,
          message: `🔴 Connection Failed! Status code: ${res.status}`
        });
      }
    } catch (e) {
      setTestResult({
        success: false,
        message: `🔴 Connection Failed! Unable to reach backend server. Ensure backend is running and CORS is enabled.`
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Save Settings
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('lunagrid_api_url', tempApiUrl);
    setApiBaseUrl(tempApiUrl);
    
    localStorage.setItem('lunagrid_show_diagnostics', tempShowDiagnostics ? 'true' : 'false');
    setShowDiagnostics(tempShowDiagnostics);

    localStorage.setItem('lunagrid_mock_mode', tempForceMockMode ? 'true' : 'false');
    setIsMockMode(tempForceMockMode);
    
    setLogs(prev => [
      `[SYSTEM] Saved backend settings. Mock Mode: ${tempForceMockMode ? 'ON' : 'OFF'} | Diagnostics: ${tempShowDiagnostics ? 'ENABLED' : 'DISABLED'}`,
      ...prev
    ]);
  };

  // Helper to generate a URL slug from display name
  const generateSlug = (name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')     // remove non-alphanumeric (except spaces/hyphens)
      .replace(/[\s_-]+/g, '-')     // replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, '');     // trim leading/trailing hyphens
  };

  const handleNameChange = (val: string) => {
    setNewLocName(val);
    if (!isSlugManuallyEdited) {
      setNewLocId(generateSlug(val));
    }
  };

  const handleSlugChange = (val: string) => {
    setNewLocId(val.toLowerCase());
    setIsSlugManuallyEdited(true);
  };

  // Add Location
  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlug = newLocId.trim() || generateSlug(newLocName);
    if (!finalSlug || !newLocName || !newLocTimezone) return;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: finalSlug, name: newLocName, timezone: newLocTimezone })
        });
        if (res.ok) {
          setNewLocId('');
          setNewLocName('');
          setIsSlugManuallyEdited(false);
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Location '${newLocName}' created.`, ...prev]);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setLocations(prev => [...prev, { id: finalSlug, name: newLocName, timezone: newLocTimezone }]);
      setNewLocId('');
      setNewLocName('');
      setIsSlugManuallyEdited(false);
    }
  };

  // Edit Location
  const handleEditLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLocId || !editLocName || !editLocTimezone) return;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations/${editingLocId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editLocName, timezone: editLocTimezone })
        });
        if (res.ok) {
          setEditingLocId(null);
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Location '${editLocName}' updated.`, ...prev]);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setLocations(prev => prev.map(l => l.id === editingLocId ? { ...l, name: editLocName, timezone: editLocTimezone } : l));
      setEditingLocId(null);
    }
  };

  // Enforce 1-device-per-location mapping
  const handleDeviceMapping = async (locationId: string, deviceId: string) => {
    const targetDevId = deviceId === 'unmap' ? '' : deviceId;
    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations/${locationId}/bind`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: targetDevId })
        });
        if (res.ok) {
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Reconfigured mapping for location: ${locationId}`, ...prev]);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      // Mock mapping locally
      setDevices(prev => {
        return prev.map(d => {
          if (d.id === targetDevId) return { ...d, location_id: locationId, status: 'ACTIVE' };
          if (d.location_id === locationId && d.id !== targetDevId) return { ...d, location_id: null };
          return d;
        });
      });
    }
  };

  // Complete Pending Device Configuration
  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollDeviceId || !enrollFriendlyName) return;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/devices/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: enrollDeviceId,
            locationId: enrollLocationId || null,
            friendlyName: enrollFriendlyName
          })
        });
        if (res.ok) {
          setShowEnrollForm(false);
          setEnrollDeviceId('');
          setEnrollFriendlyName('');
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Enrolled device ${enrollDeviceId}`, ...prev]);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      // Mock enroll locally
      setDevices(prev => 
        prev.map(d => d.id === enrollDeviceId ? { ...d, location_id: enrollLocationId || null, friendly_name: enrollFriendlyName, status: 'ACTIVE' } : d)
      );
      setShowEnrollForm(false);
    }
  };

  // Unregister a device from registry database
  const handleUnregisterDevice = async (id: string) => {
    if (confirm(`Are you sure you want to unregister and delete device: ${id}?`)) {
      if (isBackendConnected) {
        try {
          const res = await fetch(`${apiBaseUrl}/api/devices/${id}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            fetchMetadata();
            setLogs(prev => [`[SYSTEM] Unregistered device ${id}`, ...prev]);
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        // Mock unregister locally
        setDevices(prev => prev.filter(d => d.id !== id));
      }
    }
  };

  // Update device friendly name
  const handleUpdateFriendlyName = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/devices/${id}/friendly-name`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ friendlyName: newName })
        });
        if (res.ok) {
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Updated friendly name of device ${id} to "${newName}"`, ...prev]);
        } else {
          const errData = await res.json();
          alert(`Failed to update friendly name: ${errData.error || res.statusText}`);
        }
      } catch (err) {
        console.error(err);
        alert('Failed to update friendly name due to network error');
      }
    } else {
      // Mock update locally
      setDevices(prev =>
        prev.map(d => d.id === id ? { ...d, friendly_name: newName } : d)
      );
    }
    setEditingDeviceId(null);
  };

  // Toggle Car Away (notification silence) state for a location
  const handleToggleNotifications = async (locationId: string, currentActive: boolean) => {
    const newDisabled = !currentActive;
    const targetLoc = locations.find(l => l.id === locationId);
    const locName = targetLoc?.name || locationId;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations/${locationId}/notifications`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: newDisabled })
        });

        if (res.ok) {
          const data = await res.json();
          setLocations(prev =>
            prev.map(l => l.id === locationId ? { ...l, notifications_disabled: data.notifications_disabled } : l)
          );
          setLogs(prev => [
            `[SYSTEM] Location "${locName}" Car Away set to ${data.message || (newDisabled ? 'ON' : 'OFF')}.`,
            ...prev
          ]);
        } else {
          const errData = await res.json();
          alert(`Failed to update Car Away status: ${errData.error || res.statusText}`);
        }
      } catch (err) {
        console.error(err);
        alert('Failed to update Car Away status due to network error');
      }
    } else {
      // Mock update locally
      const mockVal = newDisabled ? 1 : -1;
      setLocations(prev =>
        prev.map(l => l.id === locationId ? { ...l, notifications_disabled: mockVal } : l)
      );
      setLogs(prev => [
        `[MOCK] Location "${locName}" Car Away set to ${newDisabled ? 'ON (Manual Override)' : 'OFF (Manual Override)'}.`,
        ...prev
      ]);
    }
  };

  const handleResetScheduleOverride = async (locationId: string) => {
    const targetLoc = locations.find(l => l.id === locationId);
    const locName = targetLoc?.name || locationId;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations/${locationId}/notifications`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ override: 'auto' })
        });

        if (res.ok) {
          setLocations(prev =>
            prev.map(l => l.id === locationId ? { ...l, notifications_disabled: 0 } : l)
          );
          setLogs(prev => [
            `[SYSTEM] Location "${locName}" Car Away manual override cleared. Resumed Auto Schedule.`,
            ...prev
          ]);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setLocations(prev =>
        prev.map(l => l.id === locationId ? { ...l, notifications_disabled: 0 } : l)
      );
    }
  };

  const checkIsScheduleActive = (fromStr?: string, toStr?: string, tzStr?: string) => {
    if (!fromStr || !toStr) return false;
    try {
      const tz = tzStr || 'Europe/Budapest';
      const nowTimeStr = new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      const [nowH, nowM] = nowTimeStr.split(':').map(Number);
      const nowMins = nowH * 60 + nowM;

      const [fromH, fromM] = fromStr.split(':').map(Number);
      const fromMins = fromH * 60 + fromM;

      const [toH, toM] = toStr.split(':').map(Number);
      const toMins = toH * 60 + toM;

      if (fromMins <= toMins) {
        return nowMins >= fromMins && nowMins < toMins;
      } else {
        return nowMins >= fromMins || nowMins < toMins;
      }
    } catch (err) {
      return false;
    }
  };

  const handleUpdateSchedule = async (locationId: string, enabled: boolean, from: string, to: string) => {
    const targetLoc = locations.find(l => l.id === locationId);
    const locName = targetLoc?.name || locationId;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations/${locationId}/schedule`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, from, to })
        });

        if (res.ok) {
          setLocations(prev =>
            prev.map(l => l.id === locationId ? {
              ...l,
              car_away_schedule_enabled: enabled ? 1 : 0,
              car_away_schedule_from: from,
              car_away_schedule_to: to
            } : l)
          );
          setLogs(prev => [
            `[SYSTEM] Location "${locName}" Car Away schedule set to ${enabled ? 'ENABLED' : 'DISABLED'} (${from} - ${to}).`,
            ...prev
          ]);
        } else {
          const errData = await res.json();
          alert(`Failed to update Car Away schedule: ${errData.error || res.statusText}`);
        }
      } catch (err) {
        console.error(err);
        alert('Failed to update schedule due to network error');
      }
    } else {
      // Mock update locally
      setLocations(prev =>
        prev.map(l => l.id === locationId ? {
          ...l,
          car_away_schedule_enabled: enabled ? 1 : 0,
          car_away_schedule_from: from,
          car_away_schedule_to: to
        } : l)
      );
      setLogs(prev => [
        `[MOCK] Location "${locName}" Car Away schedule set to ${enabled ? 'ENABLED' : 'DISABLED'} (${from} - ${to}).`,
        ...prev
      ]);
    }
  };

  // Delete a location
  const handleDeleteLocation = async (id: string) => {
    // Check if there is any device currently mapped to this location
    const boundDevice = devices.find(d => d.location_id === id && d.status === 'ACTIVE');
    if (boundDevice) {
      alert(`Cannot delete location. Device "${boundDevice.friendly_name || boundDevice.id}" is currently mapped to it. Unbind the device first.`);
      return;
    }

    if (confirm(`Are you sure you want to delete location: ${id}?`)) {
      if (isBackendConnected) {
        try {
          const res = await fetch(`${apiBaseUrl}/api/locations/${id}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            fetchMetadata();
            setLogs(prev => [`[SYSTEM] Deleted location ${id}`, ...prev]);
          } else {
            const errData = await res.json();
            alert(errData.error || 'Failed to delete location');
          }
        } catch (err) {
          console.error(err);
          alert('Failed to connect to backend to delete location');
        }
      } else {
        // Mock delete locally
        setLocations(prev => prev.filter(l => l.id !== id));
        // Reset selectedLocationId if it was the deleted one
        setSelectedLocationId(current => {
          if (current === id) {
            const remaining = locations.filter(l => l.id !== id);
            return remaining.length > 0 ? remaining[0].id : '';
          }
          return current;
        });
        setLogs(prev => [`[SYSTEM] Deleted mock location ${id}`, ...prev]);
      }
    }
  };

  const handleCreateAutomation = async (locationId: string) => {
    const defaultAuto = {
      enabled: 1,
      type: 'webhook',
      target: 'http://',
      headers: ''
    };

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations/${locationId}/automations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(defaultAuto)
        });
        if (res.ok) {
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Created new automation for location ${locationId}`, ...prev]);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      const mockId = Date.now();
      setAutomations(prev => [...prev, { id: mockId, location_id: locationId, ...defaultAuto }]);
    }
  };

  const handleUpdateAutomation = async (id: number, updatedFields: Partial<Automation>) => {
    setAutomations(prev =>
      prev.map(auto => (auto.id === id ? { ...auto, ...updatedFields } : auto))
    );

    const autoToUpdate = automations.find(a => a.id === id);
    if (!autoToUpdate) return;
    const finalAuto = { ...autoToUpdate, ...updatedFields };

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/automations/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalAuto)
        });
        if (!res.ok) {
          console.error('Failed to update automation');
        } else {
          setLogs(prev => [`[SYSTEM] Updated automation ${id}`, ...prev]);
          setTempAutomationTarget(prev => {
            const copy = { ...prev };
            delete copy[`auto_${id}`];
            return copy;
          });
          setTempAutomationHeaders(prev => {
            const copy = { ...prev };
            delete copy[`auto_${id}`];
            return copy;
          });
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setLogs(prev => [`[MOCK] Updated automation ${id} locally`, ...prev]);
      setTempAutomationTarget(prev => {
        const copy = { ...prev };
        delete copy[`auto_${id}`];
        return copy;
      });
      setTempAutomationHeaders(prev => {
        const copy = { ...prev };
        delete copy[`auto_${id}`];
        return copy;
      });
    }
  };

  const handleDeleteAutomation = async (id: number) => {
    if (confirm('Are you sure you want to delete this integration?')) {
      if (isBackendConnected) {
        try {
          const res = await fetch(`${apiBaseUrl}/api/automations/${id}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            fetchMetadata();
            setLogs(prev => [`[SYSTEM] Deleted automation ${id}`, ...prev]);
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        setAutomations(prev => prev.filter(auto => auto.id !== id));
      }
    }
  };

  const handleTestSingleAutomation = async (id: number, state: 'on' | 'off') => {
    if (!isBackendConnected) {
      alert(`[MOCK] Single Automation test (${state.toUpperCase()}) triggered locally.`);
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/api/automations/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      });
      if (res.ok) {
        alert(`Automation integration test (${state.toUpperCase()}) triggered successfully! Check the system logs for status.`);
      } else {
        const errData = await res.json();
        alert(`Test trigger failed: ${errData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      alert(`Failed to trigger automation test.`);
    }
  };

  // --- Calculate Today's Hourly Availability Strip ---
  const getHourlyAvailabilityStrip = () => {
    const hours = [];
    const now = Date.now();

    // Get midnight (start of today) in local timezone
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Map 24 hour slots of the current calendar day (00:00 to 23:00)
    for (let i = 0; i < 24; i++) {
      const targetTime = startOfDay.getTime() + i * 60 * 60 * 1000;
      const hourLabel = `${i.toString().padStart(2, '0')}:00`;

      // If this hour slot is in the future relative to now, mark it as future
      if (targetTime > now) {
        hours.push({
          label: `${hourLabel} (Future)`,
          value: null
        });
        continue;
      }

      // Find the aggregated point for this specific hour today.
      // Since the backend query aggregates by 1h using timeSrc: "_start",
      // we look for a history point that matches the hour's start time exactly (or within 5 minutes).
      let matchedPoint: HistoryItem | null = null;
      let minDiff = Infinity;
      
      for (const item of history) {
        const itemTime = new Date(item.time).getTime();
        const diff = Math.abs(itemTime - targetTime);
        if (diff < minDiff && diff < 5 * 60 * 1000) {
          minDiff = diff;
          matchedPoint = item;
        }
      }

      hours.push({
        label: hourLabel,
        value: matchedPoint ? matchedPoint.value : null
      });
    }
    return hours;
  };

  const hourlyStrip = getHourlyAvailabilityStrip();
  const pendingDevices = devices.filter(d => d.status === 'PENDING');

  return (
    <div className="container">
      {/* Styles Injected */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background-color: #070a13; color: #e2e8f0; font-family: 'Outfit', sans-serif; min-height: 100vh; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }

        header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 1.5rem;
        }
        .logo { display: flex; align-items: center; gap: 0.75rem; }
        .logo-icon {
          width: 2.5rem; height: 2.5rem; border-radius: 50%;
          background: linear-gradient(135deg, #10b981, #3b82f6);
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
        }
        h1 { font-size: 1.6rem; font-weight: 700; background: linear-gradient(to right, #f8fafc, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

        /* Navigation Tabs */
        .tabs { display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 0.5rem; }
        .tab-btn {
          background: transparent; border: none; color: #64748b; font-size: 1rem; font-weight: 600;
          padding: 0.5rem 1rem; cursor: pointer; border-radius: 0.5rem; transition: all 0.2s;
        }
        .tab-btn:hover { color: #f1f5f9; background: rgba(255, 255, 255, 0.03); }
        .tab-btn.active { color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.15); }

        .badge { padding: 0.35rem 0.85rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
        .badge-online { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #10b981; }
        .badge-offline { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; }
        .badge-mock { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); color: #3b82f6; }
        
        .grid-layout { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1.5rem; }
        .col-12 { grid-column: span 12; }
        .col-8 { grid-column: span 8; }
        .col-4 { grid-column: span 4; }

        @media (max-width: 900px) { .col-8, .col-4 { grid-column: span 12; } }

        .card {
          background: rgba(17, 24, 39, 0.6); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 1.25rem; padding: 1.5rem; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.25);
        }

        .status-hero {
          display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 200px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.7) 100%);
        }
        .status-circle {
          width: 5.5rem; height: 5.5rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;
        }
        .active-state { background: radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.03) 100%); border: 2px solid #10b981; color: #10b981; box-shadow: 0 0 25px rgba(16, 185, 129, 0.25); }
        .inactive-state { background: radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.03) 100%); border: 2px solid #ef4444; color: #ef4444; box-shadow: 0 0 25px rgba(239, 68, 68, 0.15); }
        .offline-state { background: radial-gradient(circle, rgba(148, 163, 184, 0.2) 0%, rgba(148, 163, 184, 0.03) 100%); border: 2px solid #94a3b8; color: #94a3b8; box-shadow: 0 0 25px rgba(148, 163, 184, 0.15); }
        
        /* 24h Availability Strip */
        .timeline-container { margin: 1.5rem 0; }
        .strip { display: grid; grid-template-columns: repeat(24, 1fr); gap: 4px; height: 1.75rem; margin-top: 0.5rem; }
        .strip-block { border-radius: 3px; cursor: pointer; position: relative; transition: opacity 0.2s; }
        .strip-block:hover { opacity: 0.8; }
        .strip-block.active { background-color: #10b981; box-shadow: 0 0 5px rgba(16, 185, 129, 0.3); }
        .strip-block.inactive { background-color: #ef4444; }
        .strip-block.nodata { background-color: #374151; }
        
        /* Tooltip */
        .strip-block .tooltip {
          visibility: hidden; position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);
          background-color: #1f2937; color: #fff; text-align: center; padding: 4px 8px; border-radius: 4px;
          font-size: 0.75rem; white-space: nowrap; z-index: 10; border: 1px solid rgba(255,255,255,0.1);
        }
        .strip-block:hover .tooltip { visibility: visible; }

        .timeline-legend { display: flex; justify-content: flex-end; gap: 1rem; margin-top: 0.5rem; font-size: 0.8rem; color: #64748b; }
        .legend-item { display: flex; align-items: center; gap: 0.25rem; }
        .legend-color { width: 0.75rem; height: 0.75rem; border-radius: 2px; }

        /* Discovery Banner */
        .pending-banner {
          background: linear-gradient(to right, rgba(245, 158, 11, 0.15), rgba(239, 68, 68, 0.05));
          border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 0.75rem; padding: 1rem;
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;
        }
        .btn-action { background: #f59e0b; color: #080c14; border: none; padding: 0.4rem 1rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; }
        .btn-action:hover { background: #d97706; }
        .btn-secondary { background: rgba(255, 255, 255, 0.05); color: #f1f5f9; border: 1px solid rgba(255,255,255,0.1); padding: 0.4rem 1rem; border-radius: 0.5rem; cursor: pointer; }
        .btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }

        /* Forms */
        .form-group { margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
        .form-group label { font-size: 0.85rem; color: #94a3b8; font-weight: 600; }
        .form-input { background: #0f172a; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 0.55rem; border-radius: 0.5rem; font-family: inherit; font-size: 0.95rem; }
        
        .logs-container { display: flex; flex-direction: column; gap: 0.5rem; max-height: 150px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; color: #94a3b8; background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 0.5rem; }
        .info-txt { font-size: 0.9rem; color: #64748b; margin-bottom: 0.5rem; }

        /* Management Panel List */
        .location-mgmt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-top: 1rem; }
        .location-mgmt-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 1rem; padding: 1.25rem; }
        .location-mgmt-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
        
        .mapping-control { margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.75rem; }
      `}</style>

      {/* Main Header */}
      <header>
        <div className="logo">
          <div className="logo-icon" />
          <h1>LUNAGRID CONSOLE</h1>
        </div>
        <div className="badge-backend-online">
          <div className={`badge ${
            isMockMode 
              ? 'badge-mock' 
              : isBackendOnline 
                ? 'badge-online' 
                : 'badge-offline'
          }`}>
            <span className="pulse" />
            {isMockMode 
              ? 'Manual Mock Mode' 
              : isBackendOnline 
                ? `Active Source: ${apiBaseUrl}` 
                : 'Backend Connection Offline'}
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="tabs">
        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          Dashboard
        </button>
        <button className={`tab-btn ${activeTab === 'management' ? 'active' : ''}`} onClick={() => setActiveTab('management')}>
          Locations & Devices
        </button>
        <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          Source Settings
        </button>
        <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          Historical Logs
        </button>
      </nav>

      {/* Discovery Banner Alert */}
      {pendingDevices.length > 0 && !showEnrollForm && (
        <div className="pending-banner">
          <div style={{ color: '#f59e0b', fontWeight: 600 }}>
            ⚠️ Discovered {pendingDevices.length} unconfigured device(s).
          </div>
          <button className="btn-action" onClick={() => {
            setEnrollDeviceId(pendingDevices[0].id);
            setEnrollLocationId(locations[0]?.id || '');
            setShowEnrollForm(true);
          }}>
            Configure Device
          </button>
        </div>
      )}

      {/* Enrollment Card Form */}
      {showEnrollForm && (
        <div className="card col-12" style={{ marginBottom: '1.5rem' }}>
          <h3>Configure Newly Discovered Device</h3>
          <form onSubmit={handleEnrollSubmit} style={{ marginTop: '1rem' }}>
            <div className="form-group">
              <label>Device UID</label>
              <input className="form-input" type="text" readOnly value={enrollDeviceId} />
            </div>
            <div className="form-group">
              <label>Device Nickname / Friendly Name</label>
              <input className="form-input" type="text" required placeholder="e.g. Server Room Contactor" value={enrollFriendlyName} onChange={e => setEnrollFriendlyName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Map to Location (optional)</label>
              <select className="form-input" value={enrollLocationId} onChange={e => setEnrollLocationId(e.target.value)}>
                <option value="">Unassigned</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-secondary" type="button" onClick={() => setShowEnrollForm(false)}>Cancel</button>
              <button className="btn-action" type="submit">Complete Registration</button>
            </div>
          </form>
        </div>
      )}

      {/* Main Tab Render Switcher */}
      {activeTab === 'dashboard' && (
        <div className="grid-layout">
          {/* Connection Error Banner */}
          {!isMockMode && !isBackendOnline && (
            <div className="card col-12" style={{
              background: 'linear-gradient(to right, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              padding: '1.25rem',
              borderRadius: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <div>
                <strong style={{ display: 'block', fontSize: '1rem', fontWeight: 600 }}>Backend Connection Offline</strong>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  Unable to establish connection to the backend server at <code>{apiBaseUrl}</code>. Data on the dashboard may be stale or unavailable. Please ensure the backend is running and the REST API URL in Settings is configured correctly.
                </span>
              </div>
            </div>
          )}

          {/* Manual Mock Mode Active Banner */}
          {isMockMode && (
            <div className="card col-12" style={{
              background: 'linear-gradient(to right, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05))',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: '#3b82f6',
              padding: '1.25rem',
              borderRadius: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>ℹ️</span>
              <div>
                <strong style={{ display: 'block', fontSize: '1rem', fontWeight: 600 }}>Running in Force Mock Mode</strong>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  The application is running in forced Standalone Mock Mode. Telemetry is being simulated. You can disable this in the Settings tab to connect to your real device backend.
                </span>
              </div>
            </div>
          )}

          {/* Location Selection Panel */}
          <div className="card col-12" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Location</h3>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Select active location</span>
            </div>

            <select 
              className="form-input" 
              style={{ 
                width: 'auto', 
                minWidth: '220px', 
                maxWidth: '350px', 
                padding: '0.35rem 2rem 0.35rem 0.75rem', 
                textOverflow: 'ellipsis', 
                overflow: 'hidden', 
                whiteSpace: 'nowrap' 
              }} 
              value={selectedLocationId} 
              onChange={e => setSelectedLocationId(e.target.value)}
            >
              {locations.length === 0 ? (
                <option value="">No Locations Configured</option>
              ) : (
                locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))
              )}
            </select>
          </div>

          {/* Car Away Panel */}
          {selectedLocationId && (() => {
            const currentLoc = locations.find(l => l.id === selectedLocationId);
            if (!currentLoc) return null;
            const isManualOn = currentLoc.notifications_disabled === 1;
            const isManualOff = currentLoc.notifications_disabled === -1;
            const isScheduleEnabled = Boolean(currentLoc.car_away_schedule_enabled);
            const scheduleFrom = currentLoc.car_away_schedule_from || '08:00';
            const scheduleTo = currentLoc.car_away_schedule_to || '17:00';

            const isScheduleActive = checkIsScheduleActive(scheduleFrom, scheduleTo, currentLoc.timezone);

            let isCarAwayActive = false;
            let statusText = '';

            if (isManualOn) {
              isCarAwayActive = true;
              statusText = 'Car is away (Manual Override ON), notifications disabled.';
            } else if (isManualOff) {
              isCarAwayActive = false;
              statusText = 'Car is home (Manual Override OFF), notifications enabled.';
            } else if (isScheduleEnabled && isScheduleActive) {
              isCarAwayActive = true;
              statusText = `Car is away (Scheduled: ${scheduleFrom} - ${scheduleTo}), notifications disabled.`;
            } else {
              isCarAwayActive = false;
              statusText = 'Car is home, notifications enabled.';
            }

            return (
              <div className="card col-12" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Car Away</h3>
                      {(isManualOn || isManualOff) && isScheduleEnabled && (
                        <button
                          style={{
                            border: 'none',
                            background: 'rgba(245, 158, 11, 0.15)',
                            color: '#f59e0b',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}
                          onClick={() => handleResetScheduleOverride(currentLoc.id)}
                          title="Reset manual override and resume automatic schedule"
                        >
                          ↺ Resume Schedule
                        </button>
                      )}
                    </div>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {statusText}
                    </span>
                  </div>

                  {/* Toggle Switch (Manual Override) */}
                  <button
                    role="switch"
                    aria-checked={isCarAwayActive}
                    style={{
                      position: 'relative',
                      width: '56px',
                      height: '28px',
                      borderRadius: '14px',
                      border: 'none',
                      background: isCarAwayActive ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255, 255, 255, 0.15)',
                      cursor: 'pointer',
                      transition: 'all 0.25s ease',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px',
                      boxShadow: isCarAwayActive ? '0 0 10px rgba(245, 158, 11, 0.3)' : 'none'
                    }}
                    onClick={() => handleToggleNotifications(currentLoc.id, isCarAwayActive)}
                    title={isCarAwayActive ? "Click to set Car Home (notifications enabled)" : "Click to set Car Away (notifications disabled)"}
                  >
                    <div style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: '#fff',
                      transform: isCarAwayActive ? 'translateX(28px)' : 'translateX(0px)',
                      transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.7rem',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
                    }}>
                      {isCarAwayActive ? '🚗' : '🏠'}
                    </div>
                  </button>
                </div>

                {/* Daily Schedule Controls */}
                <div style={{
                  paddingTop: '0.75rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <input
                      type="checkbox"
                      id={`schedule_enable_${currentLoc.id}`}
                      checked={isScheduleEnabled}
                      style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#f59e0b' }}
                      onChange={e => handleUpdateSchedule(currentLoc.id, e.target.checked, scheduleFrom, scheduleTo)}
                    />
                    <label htmlFor={`schedule_enable_${currentLoc.id}`} style={{ fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', cursor: 'pointer' }}>
                      Daily Automatic Schedule
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', opacity: isScheduleEnabled ? 1 : 0.4, pointerEvents: isScheduleEnabled ? 'auto' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>From:</span>
                      <input
                        type="time"
                        className="form-input"
                        style={{ padding: '0.25rem 0.4rem', fontSize: '0.85rem', width: '118px', boxSizing: 'border-box' }}
                        value={scheduleFrom}
                        onChange={e => handleUpdateSchedule(currentLoc.id, isScheduleEnabled, e.target.value, scheduleTo)}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>To:</span>
                      <input
                        type="time"
                        className="form-input"
                        style={{ padding: '0.25rem 0.4rem', fontSize: '0.85rem', width: '118px', boxSizing: 'border-box' }}
                        value={scheduleTo}
                        onChange={e => handleUpdateSchedule(currentLoc.id, isScheduleEnabled, scheduleFrom, e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Current Grid State Hero */}
          <div className="card col-12 status-hero">
            {locations.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <h3 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>No Locations Configured</h3>
                <p style={{ color: '#64748b' }}>Please create a location first in the "Locations & Devices" tab.</p>
              </div>
            ) : (!telemetry.deviceId && isBackendConnected) ? (
              <div style={{ padding: '2rem' }}>
                <h3 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>No Active Device Bound</h3>
                <p style={{ color: '#64748b' }}>Please map a device to this location in the "Locations & Devices" tab.</p>
              </div>
            ) : (telemetry.deviceId && (telemetry.connectionStatus === 'OFFLINE' || telemetry.connectionStatus === 'DISCONNECTED')) ? (
              <>
                <div className="status-circle offline-state">
                  <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-3.536 5 5 0 011.414-3.536m0 0l2.829 2.829m-5.656 2.829L3 21M5.636 5.636a9 9 0 0112.728 0M12 12h.01" />
                  </svg>
                </div>
                <h2>DEVICE OFFLINE / DISCONNECTED</h2>
                <p style={{ color: '#ef4444', fontWeight: 600, marginTop: '0.5rem' }}>
                  {telemetry.connectionStatus === 'DISCONNECTED' 
                    ? 'No heartbeat/telemetry has been received from this device.' 
                    : `No telemetry received for over 6 minutes (last: ${new Date(telemetry.timestamp).toLocaleTimeString()}).`}
                </p>
              </>
            ) : (
              <>
                <div className={`status-circle ${telemetry.gridActive ? 'active-state' : 'inactive-state'}`}>
                  <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <h2>{telemetry.gridActive ? 'B-Tariff ON' : 'B-Tariff OFF'}</h2>
                <p>Device: {telemetry.friendlyName || telemetry.deviceId || 'None'}</p>
              </>
            )}
          </div>

          {/* Calendar Day Availability Strip Block */}
          {telemetry.deviceId && (
            <div className="card col-12">
              <h4>Today's Availability Strip (Calendar Day)</h4>
              <p className="info-txt">Visualizes B-tariff active segments for the current calendar day (from 00:00 to 23:00):</p>
              
              <div className="timeline-container">
                <div className="strip">
                  {hourlyStrip.map((block, idx) => {
                    let bgColor = '#374151'; // default no data / grey
                    let statusLabel = 'No Data';

                    if (block.value !== null) {
                      const percentage = Math.round(block.value * 100);
                      statusLabel = `${percentage}% B-Tariff ON`;

                      if (block.value <= 0.05) {
                        bgColor = '#ef4444'; // 0% active (red)
                      } else if (block.value <= 0.35) {
                        bgColor = '#f97316'; // 25% active (orange)
                      } else if (block.value <= 0.65) {
                        bgColor = '#eab308'; // 50% active (yellow)
                      } else if (block.value <= 0.95) {
                        bgColor = '#84cc16'; // 75% active (lime)
                      } else {
                        bgColor = '#10b981'; // 100% active (green)
                      }
                    } else {
                      if (block.label.includes('Future')) {
                        statusLabel = 'Future Slot';
                      }
                    }

                    return (
                      <div 
                        key={idx} 
                        className="strip-block" 
                        style={{ backgroundColor: bgColor }}
                      >
                        <div className="tooltip">
                          <strong>{block.label}</strong>: {statusLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="timeline-legend" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div className="legend-color" style={{ width: '0.75rem', height: '0.75rem', borderRadius: '2px', backgroundColor: '#10b981' }} />
                    <span>100%</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div className="legend-color" style={{ width: '0.75rem', height: '0.75rem', borderRadius: '2px', backgroundColor: '#84cc16' }} />
                    <span>75%</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div className="legend-color" style={{ width: '0.75rem', height: '0.75rem', borderRadius: '2px', backgroundColor: '#eab308' }} />
                    <span>50%</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div className="legend-color" style={{ width: '0.75rem', height: '0.75rem', borderRadius: '2px', backgroundColor: '#f97316' }} />
                    <span>25%</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div className="legend-color" style={{ width: '0.75rem', height: '0.75rem', borderRadius: '2px', backgroundColor: '#ef4444' }} />
                    <span>0%</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div className="legend-color" style={{ width: '0.75rem', height: '0.75rem', borderRadius: '2px', backgroundColor: '#374151' }} />
                    <span>No Records</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DSO Contractual Compliance (7-Day Overview) */}
          {telemetry.deviceId && (
            <div className="card col-12" style={{ marginTop: '0rem' }}>
              <h3>DSO B-Tariff Contractual Compliance (7-Day Overview)</h3>
              <p className="info-txt">Checks if the utility provider has met the contractual daily minimum of 8.0 hours of B-tariff availability.</p>
              
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
                {(() => {
                  const now = Date.now();
                  const last7Days = [];
                  for (let i = 6; i >= 0; i--) {
                    last7Days.push(new Date(now - i * 24 * 60 * 60 * 1000));
                  }

                  return last7Days.map((d, index) => {
                    let matchedItem = null;
                    if (isBackendConnected) {
                      matchedItem = compliance.find(item => {
                        const itemDate = new Date(item.date);
                        if (isNaN(itemDate.getTime())) return false;
                        
                        // Compare local calendar day (d) with InfluxDB UTC daily date (itemDate)
                        const localYMD = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
                        const utcYMD = `${itemDate.getUTCFullYear()}-${(itemDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${itemDate.getUTCDate().toString().padStart(2, '0')}`;
                        return localYMD === utcYMD;
                      });
                    } else {
                      matchedItem = compliance[index];
                    }

                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    const dayName = dayNames[d.getDay()];
                    const subLabel = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

                    const hasData = !!matchedItem;
                    const hoursVal = matchedItem ? `${matchedItem.activeHours.toFixed(1)}h` : 'N/A';
                    const isCompliant = matchedItem ? matchedItem.compliant : false;
                    const statusText = matchedItem ? (matchedItem.compliant ? 'COMPLIANT' : 'FAIL') : 'N/A';

                    return (
                      <div 
                        key={index} 
                        style={{ 
                          flex: '1 1 calc(14.28% - 1rem)', 
                          minWidth: '120px', 
                          background: 'rgba(255,255,255,0.02)',
                          border: hasData 
                            ? (isCompliant ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(239, 68, 68, 0.25)')
                            : '1px solid rgba(255, 255, 255, 0.05)',
                          borderRadius: '0.75rem',
                          padding: '1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          opacity: hasData ? 1.0 : 0.5,
                          boxShadow: (hasData && !isCompliant) ? '0 0 10px rgba(239, 68, 68, 0.05)' : 'none'
                        }}
                      >
                        <div style={{ fontWeight: '600', fontSize: '0.9rem', color: '#94a3b8' }}>{dayName}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>{subLabel}</div>
                        
                        <div style={{ 
                          fontSize: '1.5rem', 
                          fontWeight: '700', 
                          margin: '0.25rem 0', 
                          color: hasData 
                            ? (isCompliant ? '#10b981' : '#ef4444')
                            : '#64748b' 
                        }}>
                          {hoursVal}
                        </div>
                        
                        <span 
                          style={{ 
                            fontSize: '0.7rem', 
                            fontWeight: '700', 
                            padding: '0.15rem 0.5rem', 
                            borderRadius: '9999px',
                            background: hasData 
                              ? (isCompliant ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)')
                              : 'rgba(255, 255, 255, 0.05)',
                            color: hasData 
                              ? (isCompliant ? '#10b981' : '#ef4444')
                              : '#64748b',
                            border: hasData 
                              ? (isCompliant ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)')
                              : '1px solid rgba(255, 255, 255, 0.1)',
                            marginTop: '0.25rem'
                          }}
                        >
                          {statusText}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Real-time Diagnostics Text Cards */}
          <div className="card col-12" style={{ marginTop: '0rem' }}>
            <h3>Diagnostic Parameters</h3>
            <p className="info-txt">Real-time hardware status metrics reported directly by the edge microcontroller.</p>
            
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-label">System Uptime</div>
                <div className="metric-value">
                  {(() => {
                    const sec = telemetry.uptime;
                    if (!sec) return '0s';
                    const h = Math.floor(sec / 3600);
                    const m = Math.floor((sec % 3600) / 60);
                    const s = sec % 60;
                    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
                  })()}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>Continuous Operation</div>
              </div>

              <div className="metric-item">
                <div className="metric-label">Wi-Fi Connection</div>
                <div className="metric-value">
                  {telemetry.wifiRssi ? `${telemetry.wifiRssi} dBm` : '0 dBm'}
                </div>
                <div style={{ 
                  fontSize: '0.85rem', 
                  fontWeight: '600',
                  color: (() => {
                    const rssi = telemetry.wifiRssi;
                    if (!rssi) return '#64748b';
                    if (rssi >= -65) return '#10b981';
                    if (rssi >= -78) return '#f59e0b';
                    return '#ef4444';
                  })(),
                  marginTop: '0.25rem' 
                }}>
                  {(() => {
                    const rssi = telemetry.wifiRssi;
                    if (!rssi) return 'No Signal';
                    if (rssi >= -60) return 'Signal: Excellent';
                    if (rssi >= -70) return 'Signal: Good';
                    if (rssi >= -80) return 'Signal: Fair';
                    return 'Signal: Weak';
                  })()}
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-label">Free Heap Memory</div>
                <div className="metric-value">
                  {telemetry.freeHeap ? `${(telemetry.freeHeap / 1024).toFixed(1)} KB` : '0 KB'}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                  {telemetry.freeHeap ? 'SRAM Heap: Stable' : 'N/A'}
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-label">Last Ingest Time</div>
                <div className="metric-value" style={{ 
                  color: (telemetry.connectionStatus === 'ONLINE' || !telemetry.deviceId) ? '#e2e8f0' : '#ef4444' 
                }}>
                  {telemetry.timestamp ? new Date(telemetry.timestamp).toLocaleTimeString() : 'Never'}
                </div>
                <div style={{ 
                  fontSize: '0.8rem', 
                  fontWeight: telemetry.deviceId ? '600' : '400',
                  color: !telemetry.deviceId ? '#64748b' : (telemetry.connectionStatus === 'ONLINE' ? '#10b981' : '#ef4444'),
                  marginTop: '0.25rem' 
                }}>
                  {(() => {
                    if (!telemetry.deviceId) return 'Awaiting heartbeat';
                    if (telemetry.connectionStatus === 'ONLINE') return 'Device Online';
                    if (telemetry.connectionStatus === 'OFFLINE') return 'Device Offline (Timeout)';
                    return 'Device Disconnected';
                  })()}
                </div>
              </div>

              <div className="metric-item">
                <div className="metric-label">Firmware Version</div>
                <div className="metric-value">
                  {telemetry.deviceId ? `v${telemetry.firmwareVersion || '1.0.0'}` : 'N/A'}
                </div>
              </div>
            </div>
          </div>

          {/* Activity Console logs (Stretched to col-12 at the bottom, conditional on user setting) */}
          {showDiagnostics && (
            <div className="card col-12" style={{ marginTop: '0rem' }}>
              <h3>Console Activity Logs</h3>
              <p className="info-txt">Stretched monitor view displaying raw ingestion logs, MQTT events, and enrollment events in full width.</p>
              <div className="logs-container" style={{ marginTop: '1rem' }}>
                {logs.length === 0 ? (
                  <div style={{ color: '#4b5563' }}>Awaiting active telemetry streams...</div>
                ) : (
                  logs.map((log, idx) => <div key={idx} className="log-entry" style={{ wordBreak: 'break-all' }}>{log}</div>)
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'management' && (
        <div className="grid-layout">
          {/* Add Location Form */}
          <div className="card col-4">
            <h3>Add New Location</h3>
            <form onSubmit={handleAddLocation} style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label>Display Name</label>
                <input className="form-input" type="text" required placeholder="e.g. Detached Garage" value={newLocName} onChange={e => handleNameChange(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Location ID Slug (Optional)</label>
                <input className="form-input" type="text" placeholder="e.g. detached-garage" value={newLocId} onChange={e => handleSlugChange(e.target.value)} />
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Generated from name if left empty.</span>
              </div>
              <div className="form-group">
                <label>Timezone</label>
                <input className="form-input" type="text" required value={newLocTimezone} onChange={e => setNewLocTimezone(e.target.value)} />
              </div>
              <button className="btn-action" style={{ width: '100%', marginTop: '0.5rem' }} type="submit">Create Location</button>
            </form>
          </div>

          {/* Locations & Mapped Devices List */}
          <div className="card col-8">
            <h3>Locations Directory</h3>
            <p className="info-txt">Each location can be bound to exactly one device.</p>
            
            {editingLocId && (
              <div className="enroll-form" style={{ marginBottom: '1.5rem' }}>
                <h4>Editing Location ID: {editingLocId}</h4>
                <form onSubmit={handleEditLocationSubmit} style={{ marginTop: '0.5rem' }}>
                  <div className="form-group">
                    <label>Display Name</label>
                    <input className="form-input" type="text" value={editLocName} onChange={e => setEditLocName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Timezone</label>
                    <input className="form-input" type="text" value={editLocTimezone} onChange={e => setEditLocTimezone(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn-secondary" type="button" onClick={() => setEditingLocId(null)}>Cancel</button>
                    <button className="btn-action" type="submit">Save Changes</button>
                  </div>
                </form>
              </div>
            )}

            <div className="location-mgmt-grid">
              {locations.length === 0 ? (
                <div style={{ padding: '2rem', color: '#64748b', textAlign: 'center', width: '100%', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '0.75rem' }}>
                  No locations configured in the system. Use the form above to add one.
                </div>
              ) : (
                locations.map(loc => {
                  // Find currently bound device
                  const boundDevice = devices.find(d => d.location_id === loc.id && d.status === 'ACTIVE');
                  // Eligible devices: unmapped ones, or the device currently mapped to this location
                  const eligibleDevices = devices.filter(d => d.location_id === null || d.location_id === loc.id);

                  return (
                    <div key={loc.id} className="location-mgmt-card">
                      <div className="location-mgmt-header">
                        <div>
                          <strong>{loc.name}</strong>
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>ID: {loc.id} | TZ: {loc.timezone}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button className="btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={() => {
                            setEditingLocId(loc.id);
                            setEditLocName(loc.name);
                            setEditLocTimezone(loc.timezone);
                          }}>
                            Edit
                          </button>
                          <button 
                            className="btn-secondary" 
                            style={{ 
                              padding: '0.2rem 0.6rem', 
                              fontSize: '0.8rem', 
                              color: '#ef4444', 
                              border: '1px solid rgba(239, 68, 68, 0.2)',
                              background: boundDevice ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                              opacity: boundDevice ? 0.4 : 1,
                              cursor: boundDevice ? 'not-allowed' : 'pointer'
                            }} 
                            title={boundDevice ? "Unbind device first to delete location" : "Delete Location"}
                            onClick={() => handleDeleteLocation(loc.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <div className="mapping-control">
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>Mapped Device (1-to-1):</label>
                        <select 
                          className="form-input" 
                          style={{ width: '100%', padding: '0.35rem', fontSize: '0.85rem' }}
                          value={boundDevice ? boundDevice.id : 'unmap'}
                          onChange={e => handleDeviceMapping(loc.id, e.target.value)}
                        >
                          <option value="unmap">None (Unmapped)</option>
                          {eligibleDevices.map(d => (
                            <option key={d.id} value={d.id}>{d.friendly_name || d.id}</option>
                          ))}
                        </select>
                      </div>

                      {/* EV Charging Automations (Multiple) */}
                      <div className="ev-automation-control" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#3b82f6' }}>EV Charging Integrations</span>
                          <button 
                            className="btn-secondary"
                            style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem', borderColor: '#10b981', color: '#10b981', background: 'rgba(16,185,129,0.05)' }}
                            onClick={() => handleCreateAutomation(loc.id)}
                          >
                            + Add Integration
                          </button>
                        </div>

                        {(() => {
                          const locAutos = automations.filter(auto => auto.location_id === loc.id);
                          if (locAutos.length === 0) {
                            return (
                              <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '1rem 0' }}>
                                No integrations configured. Click "+ Add Integration" above.
                              </div>
                            );
                          }

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              {locAutos.map((auto, autoIdx) => {
                                const autoId = auto.id!;
                                const tempKeyTarget = `auto_${autoId}`;
                                
                                const valTarget = tempAutomationTarget[tempKeyTarget] !== undefined 
                                  ? tempAutomationTarget[tempKeyTarget] 
                                  : auto.target;
                                  
                                const valHeaders = tempAutomationHeaders[tempKeyTarget] !== undefined 
                                  ? tempAutomationHeaders[tempKeyTarget] 
                                  : auto.headers;

                                return (
                                  <div key={autoId} style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#94a3b8' }}>Integration #{autoIdx + 1}</span>
                                      
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', margin: 0 }}>
                                          <input 
                                            type="checkbox" 
                                            checked={auto.enabled === 1}
                                            onChange={e => handleUpdateAutomation(autoId, { enabled: e.target.checked ? 1 : 0 })}
                                            style={{ width: '0.85rem', height: '0.85rem', cursor: 'pointer' }}
                                          />
                                          <span style={{ fontSize: '0.75rem', color: auto.enabled === 1 ? '#10b981' : '#64748b' }}>
                                            {auto.enabled === 1 ? 'Enabled' : 'Disabled'}
                                          </span>
                                        </label>
                                        
                                        <button
                                          onClick={() => handleDeleteAutomation(autoId)}
                                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0, marginLeft: '0.25rem', display: 'inline-flex', alignItems: 'center' }}
                                          title="Delete integration"
                                        >
                                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>

                                    <div>
                                      <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Type:</label>
                                      <select
                                        className="form-input"
                                        style={{ width: '100%', padding: '0.2rem', fontSize: '0.85rem', marginTop: '0.1rem' }}
                                        value={auto.type}
                                        onChange={e => handleUpdateAutomation(autoId, { type: e.target.value })}
                                      >
                                        <option value="webhook">Webhook (HTTP POST)</option>
                                        <option value="ntfy">ntfy Notification Service</option>
                                        <option value="script">Local Shell Script / CLI</option>
                                        <option value="mqtt">MQTT Message Broker</option>
                                      </select>
                                    </div>

                                    <div>
                                      <label style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                        {auto.type === 'script'
                                          ? 'Local Script / CLI Command (use {state} placeholder):'
                                          : auto.type === 'ntfy'
                                          ? 'ntfy Topic URL:'
                                          : auto.type === 'mqtt'
                                          ? 'MQTT Status Topic:'
                                          : 'Webhook Endpoint URL:'}
                                      </label>
                                      <input
                                        type="text"
                                        className="form-input"
                                        style={{ width: '100%', padding: '0.2rem', fontSize: '0.85rem', marginTop: '0.1rem' }}
                                        placeholder={
                                          auto.type === 'script'
                                            ? 'e.g. tools/handle_ev.sh {state}'
                                            : auto.type === 'ntfy'
                                            ? `e.g. https://ntfy.sh/lunagrid-${loc.id || 'automation'}-${getStableSuffix(loc.id || '')}`
                                            : auto.type === 'mqtt'
                                            ? 'e.g. evcc/charger/status'
                                            : 'e.g. http://192.168.1.50:8123/api/webhook/...'
                                        }
                                        value={valTarget}
                                        onChange={e => setTempAutomationTarget(prev => ({ ...prev, [tempKeyTarget]: e.target.value }))}
                                        onBlur={() => handleUpdateAutomation(autoId, { target: valTarget })}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            e.currentTarget.blur();
                                          }
                                        }}
                                      />
                                    </div>

                                    {(auto.type === 'webhook' || auto.type === 'ntfy' || auto.type === 'mqtt') && (
                                      <div>
                                        <label style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                          {auto.type === 'ntfy'
                                            ? 'Custom HTTP Headers (JSON, optional):'
                                            : auto.type === 'mqtt'
                                            ? 'Custom MQTT Payloads (JSON, optional - e.g. {"on": "C", "off": "A"}):'
                                            : 'Custom HTTP Headers (JSON, optional):'}
                                        </label>
                                        <textarea
                                          className="form-input"
                                          style={{ width: '100%', padding: '0.2rem', fontSize: '0.85rem', marginTop: '0.1rem', fontFamily: 'monospace', height: '40px', resize: 'vertical' }}
                                          placeholder={
                                            auto.type === 'ntfy'
                                              ? 'e.g. {"Priority": "urgent", "Tags": "zap,battery"}'
                                              : auto.type === 'mqtt'
                                              ? 'e.g. {"on": "C", "off": "A"}'
                                              : 'e.g. {"Authorization": "Bearer tok..."}'
                                          }
                                          value={valHeaders}
                                          onChange={e => setTempAutomationHeaders(prev => ({ ...prev, [tempKeyTarget]: e.target.value }))}
                                          onBlur={() => handleUpdateAutomation(autoId, { headers: valHeaders })}
                                        />
                                      </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem' }}>
                                      <button 
                                        className="btn-secondary" 
                                        style={{ width: '50%', padding: '0.25rem', fontSize: '0.75rem', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)', color: '#10b981' }}
                                        onClick={() => handleTestSingleAutomation(autoId, 'on')}
                                      >
                                        Test ON
                                      </button>
                                      <button 
                                        className="btn-secondary" 
                                        style={{ width: '50%', padding: '0.25rem', fontSize: '0.75rem', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: '#ef4444' }}
                                        onClick={() => handleTestSingleAutomation(autoId, 'off')}
                                      >
                                        Test OFF
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Registered Devices Panel */}
          <div className="card col-12" style={{ marginTop: '1.5rem' }}>
            <h3>Registered Devices</h3>
            <p className="info-txt">A complete list of registered devices. You can unregister devices manually to delete them from the database.</p>
            
            {devices.length === 0 ? (
              <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.95rem' }}>No devices registered in the system.</div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Device UID</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Friendly Name</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Location Mapping</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map(dev => {
                      const locationName = locations.find(l => l.id === dev.location_id)?.name || 'Unassigned';
                      return (
                        <tr key={dev.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>{dev.id}</td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>
                            {editingDeviceId === dev.id ? (
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input 
                                  type="text" 
                                  className="form-input" 
                                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.85rem', margin: 0, width: '180px' }}
                                  value={editingFriendlyName}
                                  onChange={e => setEditingFriendlyName(e.target.value)}
                                  autoFocus
                                />
                                <button 
                                  className="btn-secondary" 
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)', color: '#10b981' }}
                                  onClick={() => handleUpdateFriendlyName(dev.id, editingFriendlyName)}
                                >
                                  Save
                                </button>
                                <button 
                                  className="btn-secondary" 
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                                  onClick={() => setEditingDeviceId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>{dev.friendly_name || 'Unconfigured'}</span>
                                <button
                                  onClick={() => {
                                    setEditingDeviceId(dev.id);
                                    setEditingFriendlyName(dev.friendly_name || '');
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#3b82f6',
                                    cursor: 'pointer',
                                    padding: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                  }}
                                  title="Edit Friendly Name"
                                >
                                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>{locationName}</td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>
                            <span className={`badge ${dev.status === 'ACTIVE' ? 'badge-online' : 'badge-offline'}`} style={{ display: 'inline-flex', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}>
                              {dev.status}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                            <button 
                              className="btn-secondary" 
                              style={{ padding: '0.2rem 0.6rem', fontSize: '0.85rem', borderColor: '#ef4444', color: '#ef4444' }}
                              onClick={() => handleUnregisterDevice(dev.id)}
                            >
                              Unregister
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Firmware Release Manager Panel */}
          <div className="card col-12" style={{ marginTop: '1.5rem' }}>
            <h3>Firmware Release Manager</h3>
            <p className="info-txt">Manage firmware binaries, verify versions, and roll out OTA updates across all connected ESP32 devices.</p>

            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
              
              {/* Form: Register New Release */}
              <div style={{ flex: '1 1 350px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '0.75rem', padding: '1.25rem' }}>
                <h4 style={{ marginBottom: '1rem', color: '#10b981' }}>Register New Release</h4>
                <form onSubmit={handleAddRelease}>
                  <div className="form-group">
                    <label>Version Number (e.g. 1.1.0)</label>
                    <input className="form-input" type="text" required placeholder="1.1.0" value={newReleaseVersion} onChange={e => setNewReleaseVersion(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Firmware Binary URL (.bin)</label>
                    <input className="form-input" type="url" required placeholder="http://nas48.vbl.hu/lunagrid/releases/firmware.bin" value={newReleaseUrl} onChange={e => setNewReleaseUrl(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Release Notes / Description</label>
                    <textarea 
                      className="form-input" 
                      style={{ height: '70px', resize: 'vertical' }}
                      placeholder="Changes in this version..." 
                      value={newReleaseDesc} 
                      onChange={e => setNewReleaseDesc(e.target.value)} 
                    />
                  </div>
                  <button className="btn-action" type="submit" style={{ width: '100%', marginTop: '0.5rem' }}>Register Version</button>
                </form>
              </div>

              {/* List: Releases Registry */}
              <div style={{ flex: '2 1 500px' }}>
                <h4 style={{ marginBottom: '1rem' }}>Registered Releases</h4>
                {releases.length === 0 ? (
                  <div style={{ padding: '2rem', color: '#64748b', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '0.75rem' }}>
                    No firmware releases registered.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {releases.map(rel => (
                      <div key={rel.version} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '0.75rem', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong style={{ fontSize: '1.1rem', color: '#f8fafc' }}>v{rel.version}</strong>
                            {rolloutTargetVersion === rel.version && (
                              <span style={{ fontSize: '0.7rem', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.25)', padding: '0.05rem 0.4rem', borderRadius: '0.25rem' }}>ROLLING OUT</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'monospace', marginTop: '0.25rem', wordBreak: 'break-all' }}>{rel.url}</div>
                          <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.35rem' }}>{rel.description}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button 
                            className="btn-action" 
                            style={{ 
                              padding: '0.3rem 0.75rem', 
                              fontSize: '0.8rem',
                              background: rolloutTargetVersion === rel.version ? 'rgba(59, 130, 246, 0.15)' : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                              borderColor: rolloutTargetVersion === rel.version ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                              color: rolloutTargetVersion === rel.version ? '#3b82f6' : '#ffffff'
                            }} 
                            onClick={() => handleTriggerRollout(rel.version)}
                          >
                            {rolloutTargetVersion === rel.version ? 'Re-Rollout' : 'Rollout'}
                          </button>
                          <button 
                            className="btn-secondary" 
                            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)' }} 
                            onClick={() => handleDeleteRelease(rel.version)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Panel: Active Rollout Status Dashboard */}
            {rolloutStatus && (
              <div style={{ marginTop: '2rem', padding: '1.25rem', background: 'rgba(59,130,246,0.02)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ color: '#60a5fa' }}>Active Rollout Status: v{rolloutStatus.version}</h4>
                  <span style={{ fontWeight: 'bold', color: '#60a5fa' }}>{rolloutStatus.percentage}% Complete</span>
                </div>
                
                {/* Progress bar */}
                <div style={{ height: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.25rem', overflow: 'hidden', marginBottom: '1rem' }}>
                  <div style={{ width: `${rolloutStatus.percentage}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', transition: 'width 0.5s ease-in-out' }} />
                </div>

                <p className="info-txt" style={{ marginBottom: '1rem' }}>
                  Devices updated: <strong>{rolloutStatus.updatedCount}</strong> of <strong>{rolloutStatus.totalCount}</strong> active devices.
                </p>

                {/* Device Rollout List Table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                        <th style={{ padding: '0.5rem' }}>Device UID</th>
                        <th style={{ padding: '0.5rem' }}>Friendly Name</th>
                        <th style={{ padding: '0.5rem' }}>Version</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rolloutStatus.devices.map(d => (
                        <tr key={d.deviceId} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{d.deviceId}</td>
                          <td style={{ padding: '0.5rem' }}>{d.friendlyName || 'Unconfigured'}</td>
                          <td style={{ padding: '0.5rem', color: d.isUpdated ? '#10b981' : '#f59e0b' }}>v{d.currentVersion}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                            <span style={{ 
                              color: d.isUpdated ? '#10b981' : '#f59e0b', 
                              background: d.isUpdated ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                              border: d.isUpdated ? '1px solid rgba(16,185,129,0.15)' : '1px solid rgba(245,158,11,0.15)',
                              padding: '0.1rem 0.4rem', 
                              borderRadius: '0.25rem',
                              fontSize: '0.75rem' 
                            }}>
                              {d.isUpdated ? 'Up to Date' : 'Pending Update'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="grid-layout">
          <div className="card col-12">
            <h3>Source Configurations</h3>
            <p className="info-txt">Define the endpoint paths used by the client dashboard interface to fetch registries and telemetry.</p>
            
            <form onSubmit={handleSaveSettings} style={{ marginTop: '1rem', maxWidth: '600px' }}>
              <div className="form-group" style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1.5rem' }}>
                <label style={{ fontSize: '1rem', color: '#f1f5f9', marginBottom: '0.5rem' }}>Operating Mode</label>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.65rem', marginTop: '0.5rem' }}>
                  <input 
                    type="checkbox" 
                    id="forceMockMode" 
                    checked={tempForceMockMode} 
                    onChange={e => setTempForceMockMode(e.target.checked)} 
                    style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer', margin: 0 }}
                  />
                  <label htmlFor="forceMockMode" style={{ cursor: 'pointer', fontSize: '0.95rem', userSelect: 'none', fontWeight: '500', color: '#e2e8f0' }}>
                    Force Standalone Mock Mode (Simulates device telemetry)
                  </label>
                </div>
                <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginTop: '0.25rem' }}>
                  When enabled, the app will run entirely offline using mock devices and telemetry simulators. When disabled, it will connect directly to the REST API URL below.
                </span>
              </div>

              <div className="form-group">
                <label>Backend REST API Base URL</label>
                <input className="form-input" type="url" value={tempApiUrl} onChange={e => setTempApiUrl(e.target.value)} placeholder="http://localhost:3000" required />
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Used to retrieve SQLite registry files, enrollments, and route Flux history requests.</span>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.65rem', marginTop: '1.25rem' }}>
                <input 
                  type="checkbox" 
                  id="showDiagnostics" 
                  checked={tempShowDiagnostics} 
                  onChange={e => setTempShowDiagnostics(e.target.checked)} 
                  style={{ width: '1.15rem', height: '1.15rem', cursor: 'pointer', margin: 0 }}
                />
                <label htmlFor="showDiagnostics" style={{ cursor: 'pointer', fontSize: '0.925rem', userSelect: 'none', fontWeight: '500' }}>
                  Enable Diagnostic Console Logs on Dashboard
                </label>
              </div>
              
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button className="btn-action" type="submit">Save Settings</button>
                <button className="btn-secondary" type="button" onClick={handleTestConnection} disabled={isTesting}>
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>
              </div>

              {testResult && (
                <div style={{ 
                  marginTop: '1rem', 
                  padding: '0.75rem', 
                  borderRadius: '0.5rem',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  border: testResult.success ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                  background: testResult.success ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                  color: testResult.success ? '#10b981' : '#ef4444'
                }}>
                  {testResult.message}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="grid-layout">
          {/* Header Bar */}
          <div className="card col-12" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem' }}>Grid Archive Explorer</h3>
              <p className="info-txt" style={{ margin: 0 }}>Select a target date to analyze B-tariff history with context.</p>
            </div>
            
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <select 
                  className="form-input" 
                  style={{ 
                    width: 'auto', 
                    minWidth: '220px', 
                    maxWidth: '300px', 
                    padding: '0.35rem 2rem 0.35rem 0.75rem',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap'
                  }} 
                  value={selectedLocationId} 
                  onChange={e => setSelectedLocationId(e.target.value)}
                >
                  {locations.length === 0 ? (
                    <option value="">No Locations Configured</option>
                  ) : (
                    locations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))
                  )}
                </select>
              </div>
              
              <div className="form-group" style={{ margin: 0, flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="historyDatePicker" style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8' }}>Target Date:</label>
                <input 
                  type="date" 
                  id="historyDatePicker"
                  className="form-input" 
                  style={{ padding: '0.3rem 0.5rem', width: '160px' }} 
                  value={selectedHistoryDate} 
                  onChange={e => setSelectedHistoryDate(e.target.value)} 
                />
              </div>
            </div>
          </div>

          {/* Connection Warning Banner in History */}
          {!isMockMode && !isBackendOnline && (
            <div className="card col-12" style={{
              background: 'linear-gradient(to right, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              padding: '1.25rem',
              borderRadius: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <div>
                <strong style={{ display: 'block', fontSize: '1rem', fontWeight: 600 }}>Backend Connection Offline</strong>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  Unable to connect to the backend server to fetch history logs. Please check your network connection or configure the server base URL.
                </span>
              </div>
            </div>
          )}

          {/* Main Timelines Card */}
          <div className="card col-12">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4>Historical Availability Timeline (3-Day Context Window)</h4>
              {isRangeLoading && <span style={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600 }}>Loading archive data...</span>}
            </div>

            {locations.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                Please configure a location and bind a device first.
              </div>
            ) : !isMockMode && !isBackendOnline ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                No historical data available while backend is offline.
              </div>
            ) : (
              (() => {
                const { yesterdayStrips, targetStrips, tomorrowStrips } = getStripsForRange();
                
                const formatDateLabel = (daysOffset: number) => {
                  const date = new Date(selectedHistoryDate + 'T00:00:00');
                  date.setDate(date.getDate() + daysOffset);
                  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                };

                const getActiveHours = (strip: Array<{ value: number | null }>) => {
                  return strip.filter(s => s.value !== null && s.value > 0.5).length;
                };

                const todayStr = (() => {
                  const today = new Date();
                  const year = today.getFullYear();
                  const month = String(today.getMonth() + 1).padStart(2, '0');
                  const day = String(today.getDate()).padStart(2, '0');
                  return `${year}-${month}-${day}`;
                })();

                const isFutureDate = (daysOffset: number) => {
                  const today = new Date(todayStr + 'T00:00:00');
                  const date = new Date(selectedHistoryDate + 'T00:00:00');
                  date.setDate(date.getDate() + daysOffset);
                  return date.getTime() > today.getTime();
                };

                const renderDayStrip = (title: string, label: string, stripData: Array<{ label: string, value: number | null }>, highlight: boolean = false, disabled: boolean = false) => {
                  const activeHours = getActiveHours(stripData);
                  return (
                    <div style={{ 
                      margin: '1.5rem 0', 
                      padding: '1rem', 
                      borderRadius: '0.75rem', 
                      background: highlight ? 'rgba(255,255,255,0.02)' : 'transparent',
                      border: highlight ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      opacity: disabled ? 0.35 : 1,
                      pointerEvents: disabled ? 'none' : 'auto'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: highlight ? '#10b981' : '#e2e8f0' }}>
                          {title} <span style={{ color: '#64748b', fontWeight: 400, fontSize: '0.85rem', marginLeft: '0.5rem' }}>({label})</span>
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                          {disabled ? (
                            <span style={{ color: '#64748b', fontStyle: 'italic' }}>Unavailable (Future Date)</span>
                          ) : (
                            <>Active: <strong style={{ color: activeHours > 0 ? '#10b981' : '#64748b' }}>{activeHours}h</strong> ({(activeHours / 24 * 100).toFixed(0)}%)</>
                          )}
                        </span>
                      </div>
                      
                      <div className="strip" style={{ height: '1.5rem' }}>
                        {stripData.map((block, idx) => {
                          let bgColor = '#1f2937'; // darker grey for future
                          let statusLabel = 'Future Date - Telemetry Unavailable';

                          if (!disabled) {
                            bgColor = '#374151'; // standard no data
                            statusLabel = 'No Data';

                            if (block.value !== null) {
                              const percentage = Math.round(block.value * 100);
                              statusLabel = `${percentage}% B-Tariff ON`;
                              bgColor = block.value > 0.5 ? '#10b981' : '#ef4444';
                            }
                          }

                          return (
                            <div 
                              key={idx} 
                              className="strip-block" 
                              style={{ backgroundColor: bgColor }}
                            >
                              <div className="tooltip">
                                <strong>{block.label}</strong>: {statusLabel}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                };

                return (
                  <div>
                    {renderDayStrip('Day Before', formatDateLabel(-1), yesterdayStrips, false, isFutureDate(-1))}
                    {renderDayStrip('Selected Target Date', formatDateLabel(0), targetStrips, true, isFutureDate(0))}
                    {renderDayStrip('Day After', formatDateLabel(1), tomorrowStrips, false, isFutureDate(1))}
                    
                    <div className="timeline-legend" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', marginTop: '1.5rem' }}>
                      <div className="legend-item">
                        <div className="legend-color" style={{ backgroundColor: '#10b981' }} />
                        <span>Active (B-Tariff ON)</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color" style={{ backgroundColor: '#ef4444' }} />
                        <span>Inactive (B-Tariff OFF)</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color" style={{ backgroundColor: '#374151' }} />
                        <span>No Telemetry Data</span>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          {/* EV Charging Estimator Card */}
          <div className="card col-12" style={{ marginTop: '0rem' }}>
            <h3>B-Tariff Charging Capacity Estimator</h3>
            <p className="info-txt">Calculate the average energy and estimated driving range delivered to your EV during your daily home charging window, based on real historical B-tariff availability.</p>
            
            {locations.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                Awaiting location and telemetry logs configuration.
              </div>
            ) : !isMockMode && !isBackendOnline ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                Connect to the backend to calculate historical B-tariff capacity.
              </div>
            ) : (
              (() => {
                // Helper to calculate estimator values
                const calculateEstimator = () => {
                  const todayStr = (() => {
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    const day = String(today.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                  })();
                  
                  const isFutureDay = (daysOffset: number) => {
                    const today = new Date(todayStr + 'T00:00:00');
                    const date = new Date(selectedHistoryDate + 'T00:00:00');
                    date.setDate(date.getDate() + daysOffset);
                    return date.getTime() > today.getTime();
                  };

                  const { yesterdayStrips, targetStrips, tomorrowStrips } = getStripsForRange();
                  
                  const validDaysStrips = [];
                  if (!isFutureDay(-1)) validDaysStrips.push(yesterdayStrips);
                  if (!isFutureDay(0)) validDaysStrips.push(targetStrips);
                  if (!isFutureDay(1)) validDaysStrips.push(tomorrowStrips);

                  if (validDaysStrips.length === 0) {
                    return { totalHours: 0, activeHours: 0, energyDelivered: 0, rangeAddedKm: 0, rangeAddedMiles: 0 };
                  }

                  const windowHours = [];
                  let h = windowStartHour;
                  let totalHours = 0;
                  while (h !== windowEndHour) {
                    windowHours.push(h);
                    h = (h + 1) % 24;
                    totalHours++;
                    if (totalHours > 24) break;
                  }

                  let totalActiveSum = 0;
                  for (const hour of windowHours) {
                    let activeSumForHour = 0;
                    let daysWithData = 0;
                    
                    for (const dayStrip of validDaysStrips) {
                      const block = dayStrip[hour];
                      if (block && block.value !== null) {
                        activeSumForHour += block.value;
                        daysWithData++;
                      }
                    }
                    
                    if (daysWithData > 0) {
                      totalActiveSum += activeSumForHour / daysWithData;
                    }
                  }

                  const powerNum = chargingPower === "" ? 0 : chargingPower;
                  const consumptionNum = evConsumption === "" ? 0 : evConsumption;

                  const energyDelivered = totalActiveSum * powerNum;
                  const rangeAddedKm = (consumptionNum > 0) ? (energyDelivered / consumptionNum * 100) : 0;
                  const rangeAddedMiles = rangeAddedKm * 0.621371;

                  return {
                    totalHours,
                    activeHours: parseFloat(totalActiveSum.toFixed(1)),
                    energyDelivered: parseFloat(energyDelivered.toFixed(1)),
                    rangeAddedKm: Math.round(rangeAddedKm),
                    rangeAddedMiles: Math.round(rangeAddedMiles)
                  };
                };

                const { totalHours, activeHours, energyDelivered, rangeAddedKm, rangeAddedMiles } = calculateEstimator();
                
                return (
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
                    {/* Left: Input parameters */}
                    <div style={{ flex: '1 1 350px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      
                      {/* Charging Power Selection */}
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontWeight: '600' }}>Charger Power Rating (kW)</label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input 
                            type="number" 
                            className="form-input" 
                            style={{ width: '120px', padding: '0.4rem 0.6rem' }} 
                            step="0.05"
                            min="0.5"
                            max="50"
                            value={chargingPower} 
                            onChange={e => {
                              const val = e.target.value;
                              setChargingPower(val === "" ? "" : parseFloat(val));
                            }} 
                          />
                          <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 600 }}>kW</span>
                        </div>
                        
                        {/* Power Presets */}
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                          {[
                            { label: '3.7 kW (16A 1P)', value: 3.7 },
                            { label: '5.75 kW (25A 1P)', value: 5.75 },
                            { label: '7.4 kW (32A 1P)', value: 7.4 },
                            { label: '11 kW (16A 3P)', value: 11.0 },
                            { label: '22 kW (32A 3P)', value: 22.0 }
                          ].map(preset => (
                            <button
                              key={preset.value}
                              type="button"
                              className="btn-secondary"
                              style={{ 
                                padding: '0.25rem 0.5rem', 
                                fontSize: '0.75rem', 
                                borderRadius: '4px',
                                border: chargingPower === preset.value ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                                color: chargingPower === preset.value ? '#10b981' : '#f1f5f9',
                                background: chargingPower === preset.value ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.02)'
                              }}
                              onClick={() => setChargingPower(preset.value)}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Daily Charging Time Window */}
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontWeight: '600' }}>Daily Charging Window</label>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Plug-in Time</span>
                            <select 
                              className="form-input" 
                              style={{ width: '100%', padding: '0.35rem' }}
                              value={windowStartHour} 
                              onChange={e => setWindowStartHour(parseInt(e.target.value))}
                            >
                              {Array.from({ length: 24 }).map((_, h) => (
                                <option key={h} value={h}>{String(h).padStart(2, '0')}:00 {h >= 12 ? 'PM' : 'AM'}</option>
                              ))}
                            </select>
                          </div>
                          
                          <span style={{ color: '#64748b', marginTop: '1.25rem' }}>to</span>
                          
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Unplug Time</span>
                            <select 
                              className="form-input" 
                              style={{ width: '100%', padding: '0.35rem' }}
                              value={windowEndHour} 
                              onChange={e => setWindowEndHour(parseInt(e.target.value))}
                            >
                              {Array.from({ length: 24 }).map((_, h) => (
                                <option key={h} value={h}>{String(h).padStart(2, '0')}:00 {h >= 12 ? 'PM' : 'AM'}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* EV Consumption Parameter */}
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontWeight: '600' }}>EV Energy Consumption</label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input 
                            type="number" 
                            className="form-input" 
                            style={{ width: '120px', padding: '0.4rem 0.6rem' }} 
                            step="0.1"
                            min="5"
                            max="50"
                            value={evConsumption} 
                            onChange={e => {
                              const val = e.target.value;
                              setEvConsumption(val === "" ? "" : parseFloat(val));
                            }} 
                          />
                          <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 600 }}>kWh / 100 km</span>
                        </div>
                      </div>

                    </div>

                    {/* Right: Results Analysis Output Box */}
                    <div style={{ 
                      flex: '1 1 300px', 
                      background: 'rgba(255,255,255,0.01)', 
                      border: '1px solid rgba(255,255,255,0.05)', 
                      borderRadius: '0.75rem', 
                      padding: '1.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '1.25rem'
                    }}>
                      <h4 style={{ margin: 0, fontSize: '1rem', color: '#3b82f6', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                        Expected Charging Yield
                      </h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                          <span style={{ color: '#94a3b8' }}>Total Session Window:</span>
                          <span style={{ fontWeight: 600 }}>{totalHours} hours</span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                          <span style={{ color: '#94a3b8' }}>B-Tariff Active Duration:</span>
                          <span style={{ fontWeight: 600, color: activeHours > 0 ? '#10b981' : '#64748b' }}>
                            {activeHours} hours ({totalHours > 0 ? (activeHours / totalHours * 100).toFixed(0) : 0}%)
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                          <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            ⚡ Energy Delivered:
                          </span>
                          <span style={{ fontWeight: 700, color: '#f59e0b' }}>
                            {energyDelivered} kWh
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.85rem' }}>
                          <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
                            🚗 Est. Range Added:
                          </span>
                          <span style={{ fontWeight: 800, color: '#10b981' }}>
                            ~{rangeAddedKm} km <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 400 }}>(~{rangeAddedMiles} mi)</span>
                          </span>
                        </div>
                      </div>
                      
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                        *Averaged over the valid days in the loaded timeline explorer range.
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
