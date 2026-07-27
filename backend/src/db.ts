import sqlite3 from 'sqlite3';
import path from 'path';

// Resolve database path from environment variable or fallback to default
const dbPath = path.resolve(process.env.DATABASE_PATH || 'lunagrid.db');

console.log(`[DATABASE] Opening SQLite database at ${dbPath}`);
const db = new sqlite3.Database(dbPath);

export interface Location {
  id: string;
  name: string;
  timezone: string;
  created_at?: string;
  notifications_disabled?: number;
  car_away_schedule_enabled?: number;
  car_away_schedule_from?: string;
  car_away_schedule_to?: string;
  target_compliance_hours?: number;
  ev_wakeup_enabled?: number;
  ev_wakeup_type?: string;
  ev_wakeup_target?: string;
  ev_wakeup_headers?: string;
  ev_automation_enabled?: number;
  ev_automation_type?: string;
  ev_automation_target?: string;
  ev_automation_headers?: string;
}

export interface Device {
  id: string;
  location_id: string | null;
  friendly_name: string | null;
  status: 'PENDING' | 'ACTIVE';
  registered_at?: string;
}

export interface Automation {
  id?: number;
  location_id: string;
  enabled: number;
  type: string;
  target: string;
  headers: string;
}

// Wrap sqlite3 queries in Promises
export const runQuery = (sql: string, params: any[] = []): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
};

export const getQuery = <T>(sql: string, params: any[] = []): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
};

export const allQuery = <T>(sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
};

// Initialize database schemas
export const initDb = async (): Promise<void> => {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/Budapest',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      location_id TEXT UNIQUE REFERENCES locations(id) ON DELETE SET NULL,
      friendly_name TEXT,
      status TEXT CHECK(status IN ('PENDING', 'ACTIVE')) DEFAULT 'PENDING',
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS firmware_releases (
      version TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      description TEXT,
      released_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Run migrations to add EV Wakeup fields to locations if they don't exist
  const addColumnSafe = async (colName: string, colDef: string) => {
    try {
      await runQuery(`ALTER TABLE locations ADD COLUMN ${colName} ${colDef}`);
      console.log(`[DATABASE] Migration: Added column '${colName}' to locations table.`);
    } catch (err: any) {
      if (!err.message.includes('duplicate column name')) {
        console.error(`[DATABASE] Migration Error adding ${colName}:`, err);
      }
    }
  };

  await addColumnSafe('ev_wakeup_enabled', 'INTEGER DEFAULT 0');
  await addColumnSafe('ev_wakeup_type', 'TEXT DEFAULT \'webhook\'');
  await addColumnSafe('ev_wakeup_target', 'TEXT DEFAULT \'\'');
  await addColumnSafe('ev_wakeup_headers', 'TEXT DEFAULT \'\'');

  await addColumnSafe('ev_automation_enabled', 'INTEGER DEFAULT 0');
  await addColumnSafe('ev_automation_type', 'TEXT DEFAULT \'webhook\'');
  await addColumnSafe('ev_automation_target', 'TEXT DEFAULT \'\'');
  await addColumnSafe('ev_automation_headers', 'TEXT DEFAULT \'\'');
  await addColumnSafe('notifications_disabled', 'INTEGER DEFAULT 0');
  await addColumnSafe('car_away_schedule_enabled', 'INTEGER DEFAULT 0');
  await addColumnSafe('car_away_schedule_from', 'TEXT DEFAULT \'08:00\'');
  await addColumnSafe('car_away_schedule_to', 'TEXT DEFAULT \'17:00\'');
  await addColumnSafe('target_compliance_hours', 'REAL DEFAULT 8.0');

  // Migrate existing data from ev_wakeup_* to ev_automation_* if they contain values
  try {
    const locations = await allQuery<Location>('SELECT * FROM locations');
    for (const loc of locations) {
      if (loc.ev_wakeup_enabled || loc.ev_wakeup_target || loc.ev_wakeup_headers) {
        if (!loc.ev_automation_enabled && !loc.ev_automation_target) {
          console.log(`[DATABASE] Migrating EV wakeup settings to EV charging automation settings for location: ${loc.id}`);
          await runQuery(
            'UPDATE locations SET ev_automation_enabled = ?, ev_automation_type = ?, ev_automation_target = ?, ev_automation_headers = ? WHERE id = ?',
            [loc.ev_wakeup_enabled || 0, loc.ev_wakeup_type || 'webhook', loc.ev_wakeup_target || '', loc.ev_wakeup_headers || '', loc.id]
          );
        }
      }
    }
  } catch (err) {
    console.error('[DATABASE] Migration error migrating wakeup columns to automation columns:', err);
  }

  // Create location_automations table for multiple automations
  await runQuery(`
    CREATE TABLE IF NOT EXISTS location_automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      enabled INTEGER DEFAULT 1,
      type TEXT DEFAULT 'webhook',
      target TEXT DEFAULT '',
      headers TEXT DEFAULT ''
    )
  `);

  // Migrate legacy single-automation fields to the new table
  try {
    const locations = await allQuery<Location>('SELECT * FROM locations');
    for (const loc of locations) {
      const isEnabled = loc.ev_automation_enabled !== undefined ? loc.ev_automation_enabled : loc.ev_wakeup_enabled;
      const type = loc.ev_automation_type || loc.ev_wakeup_type || 'webhook';
      const target = loc.ev_automation_target || loc.ev_wakeup_target || '';
      const headers = loc.ev_automation_headers || loc.ev_wakeup_headers || '';

      if (target.trim() || isEnabled) {
        const existing = await allQuery('SELECT * FROM location_automations WHERE location_id = ?', [loc.id]);
        if (existing.length === 0) {
          console.log(`[DATABASE] Migrating legacy automation for location: ${loc.id} to location_automations table`);
          await runQuery(
            'INSERT INTO location_automations (location_id, enabled, type, target, headers) VALUES (?, ?, ?, ?, ?)',
            [loc.id, isEnabled ? 1 : 0, type, target, headers]
          );
        }
      }
    }
  } catch (err) {
    console.error('[DATABASE] Migration error to location_automations table:', err);
  }

  // Seed default locations if empty
  const locationCount = await getQuery<{ count: number }>('SELECT COUNT(*) as count FROM locations');
  if (locationCount && locationCount.count === 0) {
    console.log('[DATABASE] Seeding default locations...');
    await runQuery(
      'INSERT INTO locations (id, name, timezone) VALUES (?, ?, ?)',
      ['budapest-home-1', 'Budapest Main House', 'Europe/Budapest']
    );
    await runQuery(
      'INSERT INTO locations (id, name, timezone) VALUES (?, ?, ?)',
      ['balaton-cottage', 'Balaton Cottage', 'Europe/Budapest']
    );
  }
};

// --- CRUD Operations ---

// Locations
export const getAllLocations = (): Promise<Location[]> => {
  return allQuery<Location>('SELECT * FROM locations ORDER BY name ASC');
};

export const createLocation = async (id: string, name: string, timezone: string, targetComplianceHours: number = 8.0): Promise<void> => {
  await runQuery(
    'INSERT INTO locations (id, name, timezone, target_compliance_hours) VALUES (?, ?, ?, ?)',
    [id, name, timezone, targetComplianceHours]
  );
};

export const updateLocation = async (id: string, name: string, timezone: string, targetComplianceHours: number = 8.0): Promise<void> => {
  await runQuery(
    'UPDATE locations SET name = ?, timezone = ?, target_compliance_hours = ? WHERE id = ?',
    [name, timezone, targetComplianceHours, id]
  );
};

export const deleteLocation = async (id: string): Promise<void> => {
  await runQuery('DELETE FROM locations WHERE id = ?', [id]);
};

export const getLocationById = (id: string): Promise<Location | undefined> => {
  return getQuery<Location>('SELECT * FROM locations WHERE id = ?', [id]);
};

export const updateLocationEvWakeup = async (
  id: string,
  enabled: boolean,
  type: string,
  target: string,
  headers: string
): Promise<void> => {
  await runQuery(
    'UPDATE locations SET ev_wakeup_enabled = ?, ev_wakeup_type = ?, ev_wakeup_target = ?, ev_wakeup_headers = ?, ev_automation_enabled = ?, ev_automation_type = ?, ev_automation_target = ?, ev_automation_headers = ? WHERE id = ?',
    [enabled ? 1 : 0, type, target, headers, enabled ? 1 : 0, type, target, headers, id]
  );
};

export const updateLocationEvAutomation = async (
  id: string,
  enabled: boolean,
  type: string,
  target: string,
  headers: string
): Promise<void> => {
  await runQuery(
    'UPDATE locations SET ev_wakeup_enabled = ?, ev_wakeup_type = ?, ev_wakeup_target = ?, ev_wakeup_headers = ?, ev_automation_enabled = ?, ev_automation_type = ?, ev_automation_target = ?, ev_automation_headers = ? WHERE id = ?',
    [enabled ? 1 : 0, type, target, headers, enabled ? 1 : 0, type, target, headers, id]
  );
};

export const updateLocationNotificationsDisabled = async (
  id: string,
  disabled: number | boolean
): Promise<void> => {
  const val = typeof disabled === 'number' ? disabled : (disabled ? 1 : 0);
  await runQuery(
    'UPDATE locations SET notifications_disabled = ? WHERE id = ?',
    [val, id]
  );
};

export const updateLocationCarAwaySchedule = async (
  id: string,
  enabled: boolean,
  fromTime: string,
  toTime: string
): Promise<void> => {
  await runQuery(
    'UPDATE locations SET car_away_schedule_enabled = ?, car_away_schedule_from = ?, car_away_schedule_to = ? WHERE id = ?',
    [enabled ? 1 : 0, fromTime, toTime, id]
  );
};

export const isLocationCarAwayActive = (location: Location): { active: boolean; reason: 'manual_on' | 'manual_off' | 'schedule' | 'none' } => {
  // Explicit manual override ON (notifications_disabled === 1)
  if (location.notifications_disabled === 1) {
    return { active: true, reason: 'manual_on' };
  }

  // Explicit manual override OFF (notifications_disabled === -1)
  if (location.notifications_disabled === -1) {
    return { active: false, reason: 'manual_off' };
  }

  // Automatic Schedule evaluation (when notifications_disabled === 0)
  if (location.car_away_schedule_enabled && location.car_away_schedule_from && location.car_away_schedule_to) {
    try {
      const tz = location.timezone || 'Europe/Budapest';
      const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false });
      const parts = formatter.formatToParts(new Date());
      let nowH = 0, nowM = 0;
      for (const p of parts) {
        if (p.type === 'hour') nowH = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') nowM = parseInt(p.value, 10);
      }
      const nowMins = nowH * 60 + nowM;

      const [fromH, fromM] = location.car_away_schedule_from.split(':').map(Number);
      const fromMins = fromH * 60 + fromM;

      const [toH, toM] = location.car_away_schedule_to.split(':').map(Number);
      const toMins = toH * 60 + toM;

      let inWindow = false;
      if (fromMins <= toMins) {
        inWindow = nowMins >= fromMins && nowMins < toMins;
      } else {
        // Overnight window (e.g. 22:00 to 06:00)
        inWindow = nowMins >= fromMins || nowMins < toMins;
      }

      if (inWindow) {
        return { active: true, reason: 'schedule' };
      }
    } catch (err) {
      console.error('[SCHEDULE] Error evaluating time range:', err);
    }
  }

  return { active: false, reason: 'none' };
};

// Devices
export const getAllDevices = (): Promise<Device[]> => {
  return allQuery<Device>('SELECT * FROM devices ORDER BY registered_at DESC');
};

export const getDeviceById = (id: string): Promise<Device | undefined> => {
  return getQuery<Device>('SELECT * FROM devices WHERE id = ?', [id]);
};

export const getDeviceByLocationId = (locationId: string): Promise<Device | undefined> => {
  return getQuery<Device>('SELECT * FROM devices WHERE location_id = ?', [locationId]);
};

// Record device auto-discovery
export const autoRegisterDevice = async (id: string): Promise<void> => {
  const exists = await getDeviceById(id);
  if (!exists) {
    console.log(`[DATABASE] Auto-discovered new device: ${id}. Registering as PENDING.`);
    await runQuery(
      'INSERT INTO devices (id, location_id, friendly_name, status) VALUES (?, NULL, NULL, "PENDING")',
      [id]
    );
  }
};

// User confirmation/enrollment operation (maps device and enforces 1-to-1)
export const enrollDevice = async (id: string, locationId: string | null, friendlyName: string): Promise<void> => {
  if (locationId) {
    // Enforce 1-device-per-location: Unbind any other device currently mapped to this location
    await runQuery('UPDATE devices SET location_id = NULL WHERE location_id = ?', [locationId]);
  }

  const exists = await getDeviceById(id);
  if (!exists) {
    await runQuery(
      'INSERT INTO devices (id, location_id, friendly_name, status) VALUES (?, ?, ?, "ACTIVE")',
      [id, locationId, friendlyName]
    );
  } else {
    await runQuery(
      'UPDATE devices SET location_id = ?, friendly_name = ?, status = "ACTIVE" WHERE id = ?',
      [locationId, friendlyName, id]
    );
  }
};

// Enforces 1-device-per-location mapping directly
export const bindDeviceToLocation = async (deviceId: string | null, locationId: string): Promise<void> => {
  // 1. Unbind any device currently mapped to this location
  await runQuery('UPDATE devices SET location_id = NULL WHERE location_id = ?', [locationId]);

  if (deviceId) {
    // 2. Unbind this device from any other location it was previously mapped to
    await runQuery('UPDATE devices SET location_id = NULL WHERE id = ?', [deviceId]);
    // 3. Map the target device to the new location
    await runQuery('UPDATE devices SET location_id = ?, status = "ACTIVE" WHERE id = ?', [locationId, deviceId]);
  }
};

export const unregisterDevice = async (id: string): Promise<void> => {
  await runQuery('DELETE FROM devices WHERE id = ?', [id]);
};

// Update device friendly name
export const updateDeviceFriendlyName = async (id: string, friendlyName: string): Promise<void> => {
  await runQuery(
    'UPDATE devices SET friendly_name = ? WHERE id = ?',
    [friendlyName, id]
  );
};

// Firmware Releases
export interface FirmwareRelease {
  version: string;
  url: string;
  description: string;
  released_at?: string;
}

export const getAllReleases = (): Promise<FirmwareRelease[]> => {
  return allQuery<FirmwareRelease>('SELECT * FROM firmware_releases ORDER BY released_at DESC');
};

export const createRelease = async (version: string, url: string, description: string): Promise<void> => {
  await runQuery(
    'INSERT INTO firmware_releases (version, url, description) VALUES (?, ?, ?)',
    [version, url, description]
  );
};

export const deleteRelease = async (version: string): Promise<void> => {
  await runQuery('DELETE FROM firmware_releases WHERE version = ?', [version]);
};

// Automations CRUD
export const getAllAutomations = (): Promise<Automation[]> => {
  return allQuery<Automation>('SELECT * FROM location_automations');
};

export const getAutomationsByLocationId = (locationId: string): Promise<Automation[]> => {
  return allQuery<Automation>('SELECT * FROM location_automations WHERE location_id = ?', [locationId]);
};

export const getAutomationById = (id: number): Promise<Automation | undefined> => {
  return getQuery<Automation>('SELECT * FROM location_automations WHERE id = ?', [id]);
};

export const createAutomation = async (
  locationId: string,
  enabled: boolean,
  type: string,
  target: string,
  headers: string
): Promise<number> => {
  await runQuery(
    'INSERT INTO location_automations (location_id, enabled, type, target, headers) VALUES (?, ?, ?, ?, ?)',
    [locationId, enabled ? 1 : 0, type, target, headers]
  );
  const row = await getQuery<{ id: number }>('SELECT last_insert_rowid() as id');
  return row ? row.id : 0;
};

export const updateAutomation = async (
  id: number,
  enabled: boolean,
  type: string,
  target: string,
  headers: string
): Promise<void> => {
  await runQuery(
    'UPDATE location_automations SET enabled = ?, type = ?, target = ?, headers = ? WHERE id = ?',
    [enabled ? 1 : 0, type, target, headers, id]
  );
};

export const deleteAutomation = async (id: number): Promise<void> => {
  await runQuery('DELETE FROM location_automations WHERE id = ?', [id]);
};
