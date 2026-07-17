const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// 1. Read Backend Version
const backendPkgPath = path.join(rootDir, 'backend', 'package.json');
const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
const backendVersion = backendPkg.version;

// 2. Read Frontend Version
const frontendPkgPath = path.join(rootDir, 'frontend', 'package.json');
const frontendPkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));
const frontendVersion = frontendPkg.version;

// 3. Read Firmware Version
const mainCppPath = path.join(rootDir, 'firmware', 'src', 'main.cpp');
const mainCpp = fs.readFileSync(mainCppPath, 'utf8');
const firmwareVersionMatch = mainCpp.match(/const char\*\s+FIRMWARE_VERSION\s*=\s*"([^"]+)";/);

if (!firmwareVersionMatch) {
  console.error('ERROR: Could not find FIRMWARE_VERSION definition in firmware/src/main.cpp');
  process.exit(1);
}
const firmwareVersion = firmwareVersionMatch[1];

console.log('--- Version Consistency Check ---');
console.log(`Backend Version:  v${backendVersion}`);
console.log(`Frontend Version: v${frontendVersion}`);
console.log(`Firmware Version: v${firmwareVersion}`);
console.log('---------------------------------');

if (backendVersion !== frontendVersion || backendVersion !== firmwareVersion) {
  console.error('ERROR: Version mismatch detected!');
  console.error('All version tags in backend, frontend, and firmware must be identical.');
  process.exit(1);
}

console.log('SUCCESS: All version numbers are consistent!');
process.exit(0);
