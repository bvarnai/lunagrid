import React, { useState, useEffect } from 'react';

interface Location {
  id: string;
  name: string;
  timezone: string;
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
  active: boolean;
}

interface ComplianceItem {
  date: string;
  activeHours: number;
  compliant: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'management' | 'settings'>('dashboard');
  
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
    firmwareVersion: null
  });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [compliance, setCompliance] = useState<ComplianceItem[]>([]);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);

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

  // Form states for enrolling pending device
  const [enrollDeviceId, setEnrollDeviceId] = useState('');
  const [enrollFriendlyName, setEnrollFriendlyName] = useState('');
  const [enrollLocationId, setEnrollLocationId] = useState('');
  const [showEnrollForm, setShowEnrollForm] = useState(false);

  // 1. Fetch Metadata (Locations, Devices, and Releases)
  const fetchMetadata = async () => {
    try {
      const locRes = await fetch(`${apiBaseUrl}/api/locations`);
      const devRes = await fetch(`${apiBaseUrl}/api/devices`);
      const relRes = await fetch(`${apiBaseUrl}/api/releases`);
      
      if (locRes.ok && devRes.ok) {
        const locData = await locRes.json();
        const devData = await devRes.json();
        setLocations(locData);
        setDevices(devData);
        setIsBackendConnected(true);

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
      }
    } catch (e) {
      console.error('Failed to fetch backend metadata, falling back to mock mode:', e);
      setIsBackendConnected(false);
      setupMockFallbacks();
    }
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

    // Setup 24h mock history
    const mockHistory: HistoryItem[] = [];
    const baseTime = new Date();
    // Simulate some periodic states matching B-Tariff hours (typically 22:00 to 06:00, and 13:00 to 17:00)
    for (let i = 24; i >= 0; i--) {
      const d = new Date(baseTime.getTime() - i * 60 * 60 * 1000);
      const hour = d.getHours();
      // True if off-peak B-tariff (simplified rule)
      const active = (hour >= 22 || hour < 6 || (hour >= 13 && hour < 17));
      mockHistory.push({
        time: d.toISOString(),
        active: active
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

    // Auto-select first location if none selected or the selected one is invalid (using functional updater to avoid stale closures)
    setSelectedLocationId(current => {
      const exists = mockLocs.some(loc => loc.id === current);
      if ((!current || !exists) && mockLocs.length > 0) {
        return mockLocs[0].id;
      }
      return current;
    });
  };

  // Run mock simulator only if backend is disconnected
  useEffect(() => {
    if (isBackendConnected) return;
    
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
          setLogs(prevLogs => [`[${now}] Mock Grid toggled to ${newGridState ? 'OFF-PEAK' : 'ON-PEAK'}`, ...prevLogs.slice(0, 5)]);
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
          firmwareVersion: currentVer
        };
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [isBackendConnected, selectedLocationId, showDiagnostics, rolloutTargetVersion, rolloutStatus]);

  // Handle periodic metadata fetching
  useEffect(() => {
    const poll = () => {
      if (document.hidden) return; // Pause polling when tab is inactive
      fetchMetadata();
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [apiBaseUrl]);

  // Handle periodic telemetry polling
  useEffect(() => {
    const poll = () => {
      if (document.hidden) return; // Pause polling when tab is inactive
      fetchTelemetryAndHistory();
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [selectedLocationId, isBackendConnected, showDiagnostics]);

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
    
    setLogs(prev => [`[SYSTEM] Saved backend settings. Diagnostics: ${tempShowDiagnostics ? 'ENABLED' : 'DISABLED'}`, ...prev]);
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
          active: null
        });
        continue;
      }

      // Get closest point in time in history
      let closestPoint: HistoryItem | null = null;
      let minDiff = Infinity;
      
      for (const item of history) {
        const itemTime = new Date(item.time).getTime();
        const diff = Math.abs(itemTime - targetTime);
        if (diff < minDiff && itemTime <= targetTime) {
          minDiff = diff;
          closestPoint = item;
        }
      }

      hours.push({
        label: hourLabel,
        active: closestPoint ? closestPoint.active : null
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
        .badge-offline { background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); color: #f59e0b; }
        
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
          <h1>LUNAGRID SERVICE PORTAL</h1>
        </div>
        <div className="badge-backend-online">
          <div className={`badge ${isBackendConnected ? 'badge-online' : 'badge-offline'}`}>
            <span className="pulse" />
            {isBackendConnected ? `Active Source: ${apiBaseUrl}` : 'Running Standalone Mock Mode'}
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
          {/* Quick Select Location */}
          <div className="card col-12" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem' }}>Selected Location Panel</h3>
            </div>
            <select className="form-input" style={{ width: '220px', padding: '0.35rem' }} value={selectedLocationId} onChange={e => setSelectedLocationId(e.target.value)}>
              {locations.length === 0 ? (
                <option value="">No Locations Configured</option>
              ) : (
                locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))
              )}
            </select>
          </div>

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
            ) : (
              <>
                <div className={`status-circle ${telemetry.gridActive ? 'active-state' : 'inactive-state'}`}>
                  <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <h2>{telemetry.gridActive ? 'OFF-PEAK (B-Tariff Active)' : 'ON-PEAK (B-Tariff Inactive)'}</h2>
                <p>Device: {telemetry.friendlyName || telemetry.deviceId || 'None'} {telemetry.deviceId && `(Firmware v${telemetry.firmwareVersion || '1.0.0'})`}</p>
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
                    let typeClass = 'nodata';
                    let statusLabel = 'No Data';
                    if (block.active === true) {
                      typeClass = 'active';
                      statusLabel = 'OFF-PEAK (B-Tariff Active)';
                    } else if (block.active === false) {
                      typeClass = 'inactive';
                      statusLabel = 'ON-PEAK (B-Tariff Inactive)';
                    }

                    return (
                      <div key={idx} className={`strip-block ${typeClass}`}>
                        <div className="tooltip">
                          <strong>{block.label}</strong>: {statusLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="timeline-legend">
                  <div className="legend-item">
                    <div className="legend-color" style={{ backgroundColor: '#10b981' }} />
                    <span>Active B-Tariff (Off-Peak)</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color" style={{ backgroundColor: '#ef4444' }} />
                    <span>Dead B-Tariff (On-Peak)</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color" style={{ backgroundColor: '#374151' }} />
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
                <div className="metric-value">
                  {telemetry.timestamp ? new Date(telemetry.timestamp).toLocaleTimeString() : 'Never'}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                  {telemetry.timestamp ? 'Live updates active' : 'Awaiting heartbeat'}
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
                          <td style={{ padding: '0.75rem 0.5rem' }}>{dev.friendly_name || 'Unconfigured'}</td>
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
    </div>
  );
}
