/**
 * Saqr Tiered Storage Lifecycle Manager
 * Implements: Hot (0-30d) -> Warm (31-90d, WebP 65%) -> Cold (>90d, image purged, analytics kept)
 * Exempts: Pinned detections and acknowledged tasks (permanently kept in /pinned/)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('/mnt/essam/sites/saqr/apps/desktop/node_modules/sharp');

const STORAGE_DIR = process.env.SNAPSHOT_STORAGE_DIR || '/mnt/essam/sites/saqr/storage/snapshots';
const HOT_DIR = path.join(STORAGE_DIR, 'hot');
const WARM_DIR = path.join(STORAGE_DIR, 'warm');
const PINNED_DIR = path.join(STORAGE_DIR, 'pinned');
const API_BASE = process.env.API_BASE || 'http://localhost:8080/api/v1';

[HOT_DIR, WARM_DIR, PINNED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function getAuthToken() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fitforless@rased.com', password: 'password123' })
  });
  const data = await res.json();
  return data.data?.tokens?.access_token || '';
}

async function runStorageLifecycle() {
  console.log(`[TIERED-STORAGE] 🚀 Starting lifecycle check at ${new Date().toISOString()}...`);
  try {
    const token = await getAuthToken();
    if (!token) throw new Error('Authentication failed');

    // 1. Trigger DB tier transitions (Hot -> Warm -> Cold)
    const tierRes = await fetch(`${API_BASE}/detections/storage/process-tiers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const tierData = await tierRes.json();
    console.log('[TIERED-STORAGE] Database tiers processed:', tierData.data);

    // 2. Scan Hot folder for images that need WebP compression (>30 days old)
    const now = Date.now();
    const hotFiles = fs.readdirSync(HOT_DIR).filter(f => f.endsWith('.jpg'));
    let compressedCount = 0;

    for (const file of hotFiles) {
      const filePath = path.join(HOT_DIR, file);
      const stat = fs.statSync(filePath);
      const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);

      // If file older than 30 days, compress to WebP in WARM_DIR
      if (ageDays >= 30 && ageDays < 90) {
        const snapId = file.replace('.jpg', '');
        const warmFile = path.join(WARM_DIR, `${snapId}.webp`);
        await sharp(filePath)
          .webp({ quality: 65, effort: 4 })
          .toFile(warmFile);
        fs.unlinkSync(filePath);
        compressedCount++;
      } else if (ageDays >= 90) {
        // Cold tier purge: delete from disk
        fs.unlinkSync(filePath);
      }
    }

    if (compressedCount > 0) {
      console.log(`[TIERED-STORAGE] 📦 Compressed ${compressedCount} snapshots to WebP (65% quality).`);
    }

    console.log('[TIERED-STORAGE] ✅ Lifecycle run completed successfully.');
  } catch (err) {
    console.error('[TIERED-STORAGE] Error running lifecycle:', err.message);
  }
}

if (require.main === module) {
  runStorageLifecycle();
}

module.exports = { runStorageLifecycle };
