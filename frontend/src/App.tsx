import React, { useState, useEffect } from 'react';

// Live telemetry simulator
interface Telemetry {
  gridActive: boolean;
  uptime: number;
  freeHeap: number;
  wifiRssi: number;
  totalActiveToday: number;
}

export default function App() {
  const [telemetry, setTelemetry] = useState<Telemetry>({
    gridActive: true,
    uptime: 3600,
    freeHeap: 184520,
    wifiRssi: -62,
    totalActiveToday: 5.4, // hours active today
  });

  const [logs, setLogs] = useState<string[]>([
    "[10:14:05] Device Boot Successful.",
    "[10:14:08] Connected to local Wi-Fi. IP: 192.168.1.144",
    "[10:14:10] TLS Handshake complete. Connected to broker.hivemq.com:8883",
    "[10:15:00] Ingest: B-tariff switched ON by DSO."
  ]);

  // Simulate real-time data changes
  useEffect(() => {
    const timer = setInterval(() => {
      setTelemetry((prev) => {
        // Occasionally toggle grid state to show reactive UI (10% chance)
        const toggleState = Math.random() < 0.15;
        const newGridState = toggleState ? !prev.gridActive : prev.gridActive;
        
        if (toggleState) {
          const now = new Date().toLocaleTimeString();
          setLogs((prevLogs) => [
            `[${now}] Event: B-tariff switched ${newGridState ? 'ON' : 'OFF'} by DSO.`,
            ...prevLogs.slice(0, 4)
          ]);
        }

        return {
          gridActive: newGridState,
          uptime: prev.uptime + 2,
          freeHeap: Math.floor(180000 + Math.random() * 8000),
          wifiRssi: Math.max(-85, Math.min(-50, prev.wifiRssi + Math.floor(Math.random() * 5) - 2)),
          totalActiveToday: prev.gridActive ? prev.totalActiveToday + (2 / 3600) : prev.totalActiveToday
        };
      });
    }, 2000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="container">
      {/* Dynamic styling injected here for self-contained elegance */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
        
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          background-color: #0b0f19;
          color: #e2e8f0;
          font-family: 'Outfit', sans-serif;
          min-height: 100vh;
          overflow-x: hidden;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem;
        }

        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 3rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 1.5rem;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .logo-icon {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.5);
          position: relative;
        }

        .logo-icon::after {
          content: '';
          position: absolute;
          width: 1.25rem;
          height: 1.25rem;
          background: #0b0f19;
          border-radius: 50%;
          top: 0.25rem;
          left: 0.25rem;
        }

        h1 {
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.025em;
          background: linear-gradient(to right, #f8fafc, #cbd5e1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .system-badge {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: #10b981;
          padding: 0.35rem 0.85rem;
          border-radius: 9999px;
          font-size: 0.85rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.1);
        }

        .system-badge .pulse {
          width: 0.5rem;
          height: 0.5rem;
          background-color: #10b981;
          border-radius: 50%;
          display: inline-block;
          animation: pulse-animation 2s infinite;
        }

        @keyframes pulse-animation {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        .grid-layout {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 1.5rem;
        }

        .card {
          background: rgba(17, 24, 39, 0.7);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 1.25rem;
          padding: 1.75rem;
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
          transition: transform 0.2s ease, border-color 0.2s ease;
        }

        .card:hover {
          transform: translateY(-2px);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .col-12 { grid-column: span 12; }
        .col-8 { grid-column: span 8; }
        .col-4 { grid-column: span 4; }

        @media (max-width: 900px) {
          .col-8, .col-4 { grid-column: span 12; }
        }

        .status-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          min-height: 250px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%);
          position: relative;
          overflow: hidden;
        }

        .status-hero::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%);
          pointer-events: none;
        }

        .status-circle {
          width: 6.5rem;
          height: 6.5rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1.25rem;
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .active-state {
          background: radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.05) 100%);
          border: 2px solid #10b981;
          color: #10b981;
          box-shadow: 0 0 30px rgba(16, 185, 129, 0.3);
        }

        .inactive-state {
          background: radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.05) 100%);
          border: 2px solid #ef4444;
          color: #ef4444;
          box-shadow: 0 0 30px rgba(239, 68, 68, 0.2);
        }

        .status-hero h2 {
          font-size: 2.25rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
        }

        .status-hero p {
          color: #94a3b8;
          font-size: 0.95rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1.25rem;
          margin-top: 1.5rem;
        }

        .metric-item {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          padding: 1.25rem;
          border-radius: 1rem;
          text-align: center;
        }

        .metric-label {
          font-size: 0.85rem;
          color: #64748b;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .metric-value {
          font-size: 1.5rem;
          font-weight: 600;
          color: #f1f5f9;
        }

        .logs-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          max-height: 250px;
          overflow-y: auto;
          font-family: monospace;
          font-size: 0.85rem;
          color: #94a3b8;
          background: rgba(0, 0, 0, 0.2);
          padding: 1rem;
          border-radius: 0.75rem;
          border: 1px solid rgba(255, 255, 255, 0.04);
        }

        .log-entry {
          border-left: 2px solid #3b82f6;
          padding-left: 0.5rem;
          line-height: 1.4;
        }
      `}</style>

      {/* Page Header */}
      <header>
        <div className="logo">
          <div className="logo-icon" />
          <h1>LUNAGRID MONITOR</h1>
        </div>
        <div className="system-badge">
          <span className="pulse" />
          MQTTS Broker Connected
        </div>
      </header>

      {/* Main Grid Content */}
      <div className="grid-layout">
        
        {/* State Panel Hero */}
        <div className="card col-12 status-hero">
          <div className={`status-circle ${telemetry.gridActive ? 'active-state' : 'inactive-state'}`}>
            <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <h2>{telemetry.gridActive ? 'ACTIVE (ON-PEAK)' : 'INACTIVE (OFF-PEAK)'}</h2>
          <p>Controlled Tariff Status (Éjszakai Áram)</p>
        </div>

        {/* Real-time Metrics Card */}
        <div className="card col-8">
          <h3>Real-time Diagnostics</h3>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1rem' }}>Updating dynamically from raw broker events</p>
          
          <div className="metrics-grid">
            <div className="metric-item">
              <div className="metric-label">Uptime</div>
              <div className="metric-value">{Math.floor(telemetry.uptime / 60)}m {telemetry.uptime % 60}s</div>
            </div>
            
            <div className="metric-item">
              <div className="metric-label">Wi-Fi Signal</div>
              <div className="metric-value">{telemetry.wifiRssi} dBm</div>
            </div>
            
            <div className="metric-item">
              <div className="metric-label">Heap Memory</div>
              <div className="metric-value">{(telemetry.freeHeap / 1024).toFixed(1)} KB</div>
            </div>

            <div className="metric-item">
              <div className="metric-label">Active Hours Today</div>
              <div className="metric-value">{telemetry.totalActiveToday.toFixed(2)}h</div>
            </div>
          </div>
        </div>

        {/* Event Logs Card */}
        <div className="card col-4">
          <h3 style={{ marginBottom: '1rem' }}>Device Activity Log</h3>
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
