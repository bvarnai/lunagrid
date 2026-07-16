import React, { useState, useEffect } from 'react';

// Interfaces matching backend models
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
  totalActiveToday: number;
}

// Fallback Mock Data for Standalone Mode
const MOCK_LOCATIONS: Location[] = [
  { id: 'budapest-home-1', name: 'Budapest Main House', timezone: 'Europe/Budapest' },
  { id: 'balaton-cottage', name: 'Balaton Cottage', timezone: 'Europe/Budapest' }
];

const MOCK_DEVICES: Device[] = [
  { id: 'lunagrid_c3_001a', location_id: 'budapest-home-1', friendly_name: 'Water Heater Sensor', status: 'ACTIVE' },
  { id: 'lunagrid_c3_998f', location_id: null, friendly_name: null, status: 'PENDING' } // Discovered, unconfigured device
];

export default function App() {
  const [locations, setLocations] = useState<Location[]>(MOCK_LOCATIONS);
  const [devices, setDevices] = useState<Device[]>(MOCK_DEVICES);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('budapest-home-1');
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);

  // Form states for enrolling device
  const [enrollDeviceId, setEnrollDeviceId] = useState<string>('');
  const [enrollFriendlyName, setEnrollFriendlyName] = useState<string>('');
  const [enrollLocationId, setEnrollLocationId] = useState<string>('budapest-home-1');
  const [showEnrollForm, setShowEnrollForm] = useState<boolean>(false);

  // Live telemetry status
  const [telemetry, setTelemetry] = useState<Telemetry>({
    gridActive: true,
    uptime: 3600,
    freeHeap: 184520,
    wifiRssi: -62,
    totalActiveToday: 5.4,
  });

  const [logs, setLogs] = useState<string[]>([
    "[10:14:05] Device Boot Successful.",
    "[10:14:08] Connected to local Wi-Fi. IP: 192.168.1.144",
    "[10:14:10] TLS Handshake complete. Connected to broker.hivemq.com:8883"
  ]);

  // 1. Fetch data from backend API with mock fallbacks
  const fetchData = async () => {
    try {
      const locRes = await fetch('http://localhost:3000/api/locations');
      const devRes = await fetch('http://localhost:3000/api/devices');
      
      if (locRes.ok && devRes.ok) {
        const locData = await locRes.json();
        const devData = await devRes.json();
        setLocations(locData);
        setDevices(devData);
        setIsBackendConnected(true);
      } else {
        setIsBackendConnected(false);
      }
    } catch (e) {
      // Backend is offline, run in standalone mode
      setIsBackendConnected(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  // 2. Telemetry simulator (changes values dynamically depending on selected location)
  useEffect(() => {
    const timer = setInterval(() => {
      setTelemetry((prev) => {
        // Balaton has slightly different mock fluctuations to make switching visible
        const factor = selectedLocationId === 'balaton-cottage' ? 1.5 : 1.0;
        const toggleState = Math.random() < 0.10;
        const newGridState = toggleState ? !prev.gridActive : prev.gridActive;

        if (toggleState) {
          const locName = locations.find(l => l.id === selectedLocationId)?.name || 'Unknown';
          const now = new Date().toLocaleTimeString();
          setLogs((prevLogs) => [
            `[${now}] [${locName}] Grid status changed to ${newGridState ? 'ON-PEAK' : 'OFF-PEAK'}.`,
            ...prevLogs.slice(0, 4)
          ]);
        }

        return {
          gridActive: newGridState,
          uptime: prev.uptime + 2,
          freeHeap: Math.floor(180000 + Math.random() * 8000),
          wifiRssi: Math.max(-85, Math.min(-50, -60 + Math.floor((Math.random() * 8 - 4) * factor))),
          totalActiveToday: prev.gridActive ? prev.totalActiveToday + (2 / 3600) : prev.totalActiveToday
        };
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [selectedLocationId, locations]);

  // 3. Handle device enrollment submit
  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollDeviceId || !enrollFriendlyName || !enrollLocationId) return;

    if (isBackendConnected) {
      try {
        const res = await fetch('http://localhost:3000/api/devices/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: enrollDeviceId,
            locationId: enrollLocationId,
            friendlyName: enrollFriendlyName
          })
        });
        if (res.ok) {
          fetchData();
          setShowEnrollForm(false);
          setLogs(prev => [`[SYSTEM] Enrolled device ${enrollDeviceId} successfully.`, ...prev]);
        }
      } catch (err) {
        console.error('Failed to enroll device:', err);
      }
    } else {
      // Mock enrollment in standalone mode
      setDevices(prev => 
        prev.map(d => d.id === enrollDeviceId ? { ...d, location_id: enrollLocationId, friendly_name: enrollFriendlyName, status: 'ACTIVE' } : d)
      );
      setShowEnrollForm(false);
      const locName = MOCK_LOCATIONS.find(l => l.id === enrollLocationId)?.name;
      setLogs(prev => [`[MOCK SYSTEM] Enrolled device ${enrollDeviceId} to ${locName}.`, ...prev]);
    }
  };

  // Find devices mapped to current selected location
  const currentDevices = devices.filter(d => d.location_id === selectedLocationId && d.status === 'ACTIVE');
  // Find pending (unassigned) devices
  const pendingDevices = devices.filter(d => d.status === 'PENDING');

  return (
    <div className="container">
      {/* Styles Injected */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
        
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background-color: #080c14;
          color: #e2e8f0;
          font-family: 'Outfit', sans-serif;
          min-height: 100vh;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1.5rem;
        }

        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 1.5rem;
        }

        .logo { display: flex; align-items: center; gap: 0.75rem; }

        .logo-icon {
          width: 2.5rem; height: 2.5rem; border-radius: 50%;
          background: linear-gradient(135deg, #10b981, #3b82f6);
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
        }

        h1 {
          font-size: 1.6rem; font-weight: 700;
          background: linear-gradient(to right, #f8fafc, #94a3b8);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }

        .status-header-badges { display: flex; gap: 0.75rem; }

        .badge {
          padding: 0.35rem 0.85rem; border-radius: 9999px;
          font-size: 0.8rem; font-weight: 600;
          display: flex; align-items: center; gap: 0.5rem;
        }

        .badge-backend-online {
          background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #10b981;
        }

        .badge-backend-offline {
          background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); color: #f59e0b;
        }

        .grid-layout {
          display: grid; grid-template-columns: repeat(12, 1fr); gap: 1.5rem;
        }

        .col-12 { grid-column: span 12; }
        .col-8 { grid-column: span 8; }
        .col-4 { grid-column: span 4; }

        @media (max-width: 900px) {
          .col-8, .col-4 { grid-column: span 12; }
        }

        .card {
          background: rgba(17, 24, 39, 0.6);
          backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 1.25rem; padding: 1.5rem;
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.25);
        }

        .location-selector-bar {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 1.5rem; gap: 1rem;
        }

        .select-location {
          background: #111827; border: 1px solid rgba(255, 255, 255, 0.1);
          color: #f1f5f9; padding: 0.5rem 1.25rem; border-radius: 0.75rem;
          font-family: inherit; font-size: 0.95rem; cursor: pointer;
        }

        .status-hero {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          text-align: center; min-height: 220px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.7) 100%);
        }

        .status-circle {
          width: 5.5rem; height: 5.5rem; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;
          transition: all 0.5s ease;
        }

        .active-state {
          background: radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.03) 100%);
          border: 2px solid #10b981; color: #10b981;
          box-shadow: 0 0 25px rgba(16, 185, 129, 0.2);
        }

        .inactive-state {
          background: radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.03) 100%);
          border: 2px solid #ef4444; color: #ef4444;
          box-shadow: 0 0 25px rgba(239, 68, 68, 0.15);
        }

        .status-hero h2 { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.25rem; }
        .status-hero p { color: #94a3b8; font-size: 0.85rem; letter-spacing: 0.05em; }

        .metrics-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem; margin-top: 1rem;
        }

        .metric-item {
          background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.04);
          padding: 1rem; border-radius: 0.75rem; text-align: center;
        }

        .metric-label { font-size: 0.8rem; color: #64748b; margin-bottom: 0.25rem; text-transform: uppercase; }
        .metric-value { font-size: 1.35rem; font-weight: 600; color: #f1f5f9; }

        /* Pending Devices Banner */
        .pending-banner {
          background: linear-gradient(to right, rgba(245, 158, 11, 0.15), rgba(239, 68, 68, 0.05));
          border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 0.75rem;
          padding: 1rem; display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 1.5rem;
        }

        .pending-title { font-weight: 600; color: #f59e0b; display: flex; align-items: center; gap: 0.5rem; }
        .btn-action {
          background: #f59e0b; color: #080c14; border: none; padding: 0.4rem 1rem;
          border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: background 0.2s;
        }
        .btn-action:hover { background: #d97706; }

        /* Dialog / Form */
        .enroll-form {
          margin-top: 1rem; padding: 1.25rem; background: rgba(0, 0, 0, 0.2);
          border-radius: 0.75rem; border: 1px solid rgba(255, 255, 255, 0.04);
        }

        .form-group { margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
        .form-group label { font-size: 0.85rem; color: #94a3b8; }
        .form-input {
          background: #0b0f19; border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff; padding: 0.5rem; border-radius: 0.5rem; font-family: inherit;
        }

        .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
        .btn-cancel {
          background: transparent; color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 0.4rem 1rem; border-radius: 0.5rem; cursor: pointer;
        }
        .btn-cancel:hover { background: rgba(255, 255, 255, 0.05); }

        .logs-container {
          display: flex; flex-direction: column; gap: 0.6rem;
          max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 0.8rem;
          color: #94a3b8; background: rgba(0, 0, 0, 0.25); padding: 0.75rem; border-radius: 0.75rem;
        }
        .log-entry { border-left: 2px solid #10b981; padding-left: 0.5rem; }

        .info-txt { font-size: 0.9rem; color: #64748b; margin-bottom: 0.75rem; }
      `}</style>

      {/* Main Header */}
      <header>
        <div className="logo">
          <div className="logo-icon" />
          <h1>LUNAGRID MULTI-SITE CONTROL</h1>
        </div>
        <div className="status-header-badges">
          <div className={`badge ${isBackendConnected ? 'badge-backend-online' : 'badge-backend-offline'}`}>
            <span className="pulse" />
            {isBackendConnected ? 'Backend Service Live' : 'Standalone Demo Mode'}
          </div>
        </div>
      </header>

      {/* Pending Device Discovery Section */}
      {pendingDevices.length > 0 && !showEnrollForm && (
        <div className="pending-banner">
          <div className="pending-title">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Auto-Discovered {pendingDevices.length} Unconfigured Device(s)
          </div>
          <button 
            className="btn-action"
            onClick={() => {
              setEnrollDeviceId(pendingDevices[0].id);
              setEnrollLocationId(locations[0]?.id || 'budapest-home-1');
              setShowEnrollForm(true);
            }}
          >
            Configure Device
          </button>
        </div>
      )}

      {/* Enrollment configuration modal/card */}
      {showEnrollForm && (
        <div className="card col-12" style={{ marginBottom: '1.5rem' }}>
          <h3>Device Configuration & Enrollment</h3>
          <p className="info-txt">Enroll your newly auto-detected ESP32-C3 hardware node into a physical monitoring location.</p>
          
          <form onSubmit={handleEnrollSubmit} className="enroll-form">
            <div className="form-group">
              <label>Device hardware UID</label>
              <input className="form-input" type="text" readOnly value={enrollDeviceId} />
            </div>

            <div className="form-group">
              <label>Friendly Name / Nickname</label>
              <input 
                className="form-input" 
                type="text" 
                placeholder="e.g. Main Contactor Sensor"
                required
                value={enrollFriendlyName}
                onChange={(e) => setEnrollFriendlyName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Assign to Location</label>
              <select 
                className="form-input"
                value={enrollLocationId}
                onChange={(e) => setEnrollLocationId(e.target.value)}
              >
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.timezone})</option>
                ))}
              </select>
            </div>

            <div className="form-actions">
              <button className="btn-cancel" type="button" onClick={() => setShowEnrollForm(false)}>Cancel</button>
              <button className="btn-action" type="submit">Complete Enrollment</button>
            </div>
          </form>
        </div>
      )}

      {/* Location Selector Bar */}
      <div className="location-selector-bar">
        <div>
          <h3>Grid Monitor Panel</h3>
          <p className="info-txt">Select a site to view its current power state and device configuration details.</p>
        </div>
        <div>
          <select 
            className="select-location"
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
          >
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Dashboard Panels */}
      <div className="grid-layout">
        
        {/* Status Indicator Card */}
        <div className="card col-12 status-hero">
          <div className={`status-circle ${telemetry.gridActive ? 'active-state' : 'inactive-state'}`}>
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <h2>{telemetry.gridActive ? 'ACTIVE (ON-PEAK)' : 'INACTIVE (OFF-PEAK)'}</h2>
          <p>Controlled Grid Tariff Status (Éjszakai Áram)</p>
        </div>

        {/* Real-time Diagnostics */}
        <div className="card col-8">
          <h3>Diagnostics & Device Info</h3>
          <div style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
            <strong style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Associated Enrolled Devices:</strong>
            {currentDevices.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: '#ef4444', marginTop: '0.25rem' }}>No devices enrolled at this location.</div>
            ) : (
              <ul style={{ paddingLeft: '1.25rem', marginTop: '0.35rem', fontSize: '0.85rem' }}>
                {currentDevices.map(d => (
                  <li key={d.id} style={{ color: '#10b981' }}>
                    <strong>{d.friendly_name}</strong> (UUID: <span style={{ fontFamily: 'monospace' }}>{d.id}</span>)
                  </li>
                ))}
              </ul>
            )}
          </div>
          
          <div className="metrics-grid">
            <div className="metric-item">
              <div className="metric-label">Uptime</div>
              <div className="metric-value">{Math.floor(telemetry.uptime / 60)}m {telemetry.uptime % 60}s</div>
            </div>
            
            <div className="metric-item">
              <div className="metric-label">Wi-Fi RSSI</div>
              <div className="metric-value">{telemetry.wifiRssi} dBm</div>
            </div>
            
            <div className="metric-item">
              <div className="metric-label">Heap Memory</div>
              <div className="metric-value">{(telemetry.freeHeap / 1024).toFixed(1)} KB</div>
            </div>

            <div className="metric-item">
              <div className="metric-label">Today's Tariff Activity</div>
              <div className="metric-value">{telemetry.totalActiveToday.toFixed(2)}h</div>
            </div>
          </div>
        </div>

        {/* Activity Logs */}
        <div className="card col-4">
          <h3 style={{ marginBottom: '1rem' }}>Activity logs</h3>
          <div className="logs-container">
            {logs.map((log, idx) => (
              <div key={idx} className="log-entry">
                {log}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
