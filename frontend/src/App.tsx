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
}

interface HistoryItem {
  time: string;
  active: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'management' | 'settings'>('dashboard');
  
  // Settings - Read from LocalStorage or default
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() => {
    return localStorage.getItem('lunagrid_api_url') || 'http://localhost:3000';
  });
  const [tempApiUrl, setTempApiUrl] = useState<string>(apiBaseUrl);

  const [locations, setLocations] = useState<Location[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  
  // Real-time Telemetry and History States
  const [telemetry, setTelemetry] = useState<Telemetry>({
    gridActive: false,
    uptime: 0,
    freeHeap: 0,
    wifiRssi: 0,
    timestamp: 0,
    deviceId: null,
    friendlyName: null
  });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Form states for creating location
  const [newLocId, setNewLocId] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocTimezone, setNewLocTimezone] = useState('Europe/Budapest');

  // Form states for editing location
  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [editLocName, setEditLocName] = useState('');
  const [editLocTimezone, setEditLocTimezone] = useState('Europe/Budapest');

  // Form states for enrolling pending device
  const [enrollDeviceId, setEnrollDeviceId] = useState('');
  const [enrollFriendlyName, setEnrollFriendlyName] = useState('');
  const [enrollLocationId, setEnrollLocationId] = useState('');
  const [showEnrollForm, setShowEnrollForm] = useState(false);

  // 1. Fetch Metadata (Locations & Devices)
  const fetchMetadata = async () => {
    try {
      const locRes = await fetch(`${apiBaseUrl}/api/locations`);
      const devRes = await fetch(`${apiBaseUrl}/api/devices`);
      
      if (locRes.ok && devRes.ok) {
        const locData = await locRes.json();
        const devData = await devRes.json();
        setLocations(locData);
        setDevices(devData);
        setIsBackendConnected(true);

        // Auto-select first location if none selected
        if (locData.length > 0 && !selectedLocationId) {
          setSelectedLocationId(locData[0].id);
        }
      } else {
        setIsBackendConnected(false);
      }
    } catch (e) {
      setIsBackendConnected(false);
      setupMockFallbacks();
    }
  };

  // 2. Fetch Real-time Telemetry & History for the active location
  const fetchTelemetryAndHistory = async () => {
    if (!selectedLocationId || !isBackendConnected) return;
    try {
      const telRes = await fetch(`${apiBaseUrl}/api/locations/${selectedLocationId}/telemetry`);
      const histRes = await fetch(`${apiBaseUrl}/api/locations/${selectedLocationId}/history`);
      
      if (telRes.ok && histRes.ok) {
        const telData = await telRes.json();
        const histData = await histRes.json();
        setTelemetry(telData);
        setHistory(histData);
      }
    } catch (e) {
      console.error('Failed to fetch real-time telemetry:', e);
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
    if (!selectedLocationId) setSelectedLocationId(mockLocs[0].id);
  };

  // Run mock simulator only if backend is disconnected
  useEffect(() => {
    if (isBackendConnected) return;
    
    // Simulate real-time logs/telemetry locally
    const timer = setInterval(() => {
      setTelemetry(prev => {
        const toggleState = Math.random() < 0.1;
        const newGridState = toggleState ? !prev.gridActive : prev.gridActive;
        if (toggleState) {
          const now = new Date().toLocaleTimeString();
          setLogs(prevLogs => [`[${now}] Mock Grid toggled to ${newGridState ? 'OFF-PEAK' : 'ON-PEAK'}`, ...prevLogs.slice(0, 5)]);
        }
        return {
          gridActive: newGridState,
          uptime: prev.uptime + 2,
          freeHeap: 180000 + Math.floor(Math.random() * 5000),
          wifiRssi: -65 + Math.floor(Math.random() * 10 - 5),
          timestamp: Date.now(),
          deviceId: 'lunagrid_c3_mock_1',
          friendlyName: 'Mock Contactor'
        };
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [isBackendConnected, selectedLocationId]);

  // Handle periodic metadata fetching
  useEffect(() => {
    fetchMetadata();
    const interval = setInterval(fetchMetadata, 4000);
    return () => clearInterval(interval);
  }, [apiBaseUrl]);

  // Handle periodic telemetry polling
  useEffect(() => {
    fetchTelemetryAndHistory();
    const interval = setInterval(fetchTelemetryAndHistory, 2000);
    return () => clearInterval(interval);
  }, [selectedLocationId, isBackendConnected]);

  // --- API Handlers ---
  
  // Save Settings
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('lunagrid_api_url', tempApiUrl);
    setApiBaseUrl(tempApiUrl);
    setLogs(prev => [`[SYSTEM] Saved backend URL: ${tempApiUrl}`, ...prev]);
  };

  // Add Location
  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocId || !newLocName || !newLocTimezone) return;

    if (isBackendConnected) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: newLocId, name: newLocName, timezone: newLocTimezone })
        });
        if (res.ok) {
          setNewLocId('');
          setNewLocName('');
          fetchMetadata();
          setLogs(prev => [`[SYSTEM] Location '${newLocName}' created.`, ...prev]);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setLocations(prev => [...prev, { id: newLocId, name: newLocName, timezone: newLocTimezone }]);
      setNewLocId('');
      setNewLocName('');
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

  // --- Calculate Last 24h Hourly Availability Strip ---
  const getHourlyAvailabilityStrip = () => {
    const hours = [];
    const now = Date.now();

    // Map 24 hour slots backwards
    for (let i = 23; i >= 0; i--) {
      const targetTime = now - i * 60 * 60 * 1000;
      const hourLabel = new Date(targetTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Find closest state change in history prior to or near this hour slot
      
      // Get closest point in time
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
            ⚠️ Discovered {pendingDevices.length} unassigned device hardware nodes.
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
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* Current Grid State Hero */}
          <div className="card col-12 status-hero">
            {(!telemetry.deviceId && isBackendConnected) ? (
              <div style={{ padding: '2rem' }}>
                <h3 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>No Active Node Bound</h3>
                <p style={{ color: '#64748b' }}>Please map a device hardware UID to this location in the "Locations & Devices" tab.</p>
              </div>
            ) : (
              <>
                <div className={`status-circle ${telemetry.gridActive ? 'active-state' : 'inactive-state'}`}>
                  <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <h2>{telemetry.gridActive ? 'OFF-PEAK (B-Tariff Active)' : 'ON-PEAK (A-Tariff Fallback)'}</h2>
                <p>Telemetry Node: {telemetry.friendlyName || telemetry.deviceId || 'None'}</p>
              </>
            )}
          </div>

          {/* 24h Availability Strip Block */}
          {telemetry.deviceId && (
            <div className="card col-12">
              <h4>Last 24 Hours Availability Strip</h4>
              <p className="info-txt">Visualizes recent B-tariff active segments at a glance (24 hour blocks, latest on the right):</p>
              
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
                      statusLabel = 'ON-PEAK (A-Tariff Fallback)';
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

          {/* Activity Console logs (Stretched to col-12 at the bottom) */}
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
        </div>
      )}

      {activeTab === 'management' && (
        <div className="grid-layout">
          {/* Add Location Form */}
          <div className="card col-4">
            <h3>Add New Location</h3>
            <form onSubmit={handleAddLocation} style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label>Location ID Slug</label>
                <input className="form-input" type="text" required placeholder="e.g. garage-contactor" value={newLocId} onChange={e => setNewLocId(e.target.value.toLowerCase())} />
              </div>
              <div className="form-group">
                <label>Display Name</label>
                <input className="form-input" type="text" required placeholder="e.g. Outer Garage Contactor" value={newLocName} onChange={e => setNewLocName(e.target.value)} />
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
            <h3>Locations Directory (Enforcing 1-Device Invariant)</h3>
            <p className="info-txt">Each location can be bound to exactly one hardware sensor device.</p>
            
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
              {locations.map(loc => {
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
                      <button className="btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={() => {
                        setEditingLocId(loc.id);
                        setEditLocName(loc.name);
                        setEditLocTimezone(loc.timezone);
                      }}>
                        Edit
                      </button>
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
              })}
            </div>
          </div>

          {/* Registered Devices Panel */}
          <div className="card col-12" style={{ marginTop: '1.5rem' }}>
            <h3>Registered Hardware Nodes</h3>
            <p className="info-txt">A complete list of registered device nodes. You can unregister devices manually to delete them from the database.</p>
            
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
              
              <button className="btn-action" style={{ marginTop: '0.5rem' }} type="submit">Save Settings</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
