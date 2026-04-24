/**
 * Reads APP_VERSION env var and patches package.json before the build.
 * Usage (PowerShell): $env:APP_VERSION="1.2.0"; npm run build
 * Usage (CMD):        set APP_VERSION=1.2.0 && npm run build
 */
const fs   = require('fs');
const path = require('path');

const version = process.env.APP_VERSION;
if (!version) process.exit(0);

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`[prebuild] version set to ${version}`);
