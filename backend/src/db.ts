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
}

export interface Device {
  id: string;
  location_id: string | null;
  friendly_name: string | null;
  status: 'PENDING' | 'ACTIVE';
  registered_at?: string;
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

export const createLocation = async (id: string, name: string, timezone: string): Promise<void> => {
  await runQuery(
    'INSERT INTO locations (id, name, timezone) VALUES (?, ?, ?)',
    [id, name, timezone]
  );
};

export const updateLocation = async (id: string, name: string, timezone: string): Promise<void> => {
  await runQuery(
    'UPDATE locations SET name = ?, timezone = ? WHERE id = ?',
    [name, timezone, id]
  );
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
