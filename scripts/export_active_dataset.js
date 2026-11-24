/**
 * Active Learning Dataset Exporter for Saqr YOLO Models
 * Extracts verified positives and false alarms (hard negatives) directly from PostgreSQL,
 * writes standardized YOLO images and label txt files into data/dataset/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_DIR = path.resolve(__dirname, '..');
const DATASET_DIR = path.join(BASE_DIR, 'data', 'dataset');
const IMAGES_DIR = path.join(DATASET_DIR, 'images', 'train');
const LABELS_DIR = path.join(DATASET_DIR, 'labels', 'train');
const SNAPSHOTS_DIR = path.join(BASE_DIR, 'storage', 'snapshots', 'hot');

// Model class index mapping
const CLASS_MAP = {
  face_mask: 0,
  mask: 0,
  gloves: 1,
  hand_gloves: 1,
  phone: 2,
  cell_phone: 2
};

function ensureDirs() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(LABELS_DIR, { recursive: true });
}

function exportFromDb() {
  ensureDirs();
  console.log('[ACTIVE-LEARNING] Querying PostgreSQL for reviewed detections...');

  const query = `
    SELECT id, snapshot_url, bounding_boxes, type, feedback_type
    FROM detections
    WHERE feedback_type IN ('verified_positive', 'false_positive')
  `;

  let rows = [];
  try {
    const rawJson = execSync(
      `docker exec rased-postgres psql -U rased -d rased -t -A -c "SELECT json_agg(t) FROM (${query}) t;"`,
      { encoding: 'utf-8' }
    ).trim();
    if (rawJson && rawJson !== '') {
      rows = JSON.parse(rawJson);
    }
  } catch (err) {
    console.error('[ACTIVE-LEARNING] Failed to query database:', err.message);
    return;
  }

  if (!rows || rows.length === 0) {
    console.log('[ACTIVE-LEARNING] No reviewed samples found yet.');
    return;
  }

  console.log(`[ACTIVE-LEARNING] Processing ${rows.length} reviewed detection(s)...`);

  let positiveCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    const { id, snapshot_url, bounding_boxes, type, feedback_type } = row;
    
    // Determine snapshot filename
    let snapId = '';
    if (snapshot_url) {
      snapId = snapshot_url.replace('/api/cameras/snapshot/', '').trim();
    }
    const sourceJpg = path.join(SNAPSHOTS_DIR, `${snapId}.jpg`);
    const targetJpg = path.join(IMAGES_DIR, `${id}.jpg`);
    const targetTxt = path.join(LABELS_DIR, `${id}.txt`);

    if (fs.existsSync(sourceJpg)) {
      try {
        fs.copyFileSync(sourceJpg, targetJpg);
      } catch {}
    }

    if (feedback_type === 'false_positive') {
      // Hard negative: empty label file signals pure background to YOLO
      fs.writeFileSync(targetTxt, '', 'utf-8');
      negativeCount++;
    } else if (feedback_type === 'verified_positive') {
      // True positive: parse bounding boxes into YOLO format: <class> <x_center> <y_center> <w> <h>
      let labelLines = [];
      let boxes = [];
      try {
        boxes = typeof bounding_boxes === 'string' ? JSON.parse(bounding_boxes) : (bounding_boxes || []);
      } catch {}

      let classIdx = 0;
      const lowerType = (type || '').toLowerCase();
      if (lowerType.includes('كمام') || lowerType.includes('mask')) classIdx = CLASS_MAP.face_mask;
      else if (lowerType.includes('قفاز') || lowerType.includes('glove')) classIdx = CLASS_MAP.gloves;
      else if (lowerType.includes('هاتف') || lowerType.includes('phone')) classIdx = CLASS_MAP.phone;

      for (const b of boxes) {
        // b.x and b.y are top-left percentages (0-100)
        // b.width and b.height are width and height percentages (0-100)
        const left = (b.x || 0) / 100.0;
        const top = (b.y || 0) / 100.0;
        const width = (b.width || 0) / 100.0;
        const height = (b.height || 0) / 100.0;

        const xCenter = Math.min(1.0, Math.max(0.0, left + width / 2.0));
        const yCenter = Math.min(1.0, Math.max(0.0, top + height / 2.0));
        const wNorm = Math.min(1.0, Math.max(0.0, width));
        const hNorm = Math.min(1.0, Math.max(0.0, height));

        labelLines.push(`${classIdx} ${xCenter.toFixed(6)} ${yCenter.toFixed(6)} ${wNorm.toFixed(6)} ${hNorm.toFixed(6)}`);
      }

      fs.writeFileSync(targetTxt, labelLines.join('\n'), 'utf-8');
      positiveCount++;
    }
  }

  // Generate / update saqr_custom.yaml
  const yamlContent = `# Saqr YOLO26 Custom Retraining Dataset (Auto-generated from Field Detections)
path: ${DATASET_DIR}
train: images/train
val: images/train

names:
  0: face_mask
  1: gloves
  2: phone
`;
  fs.writeFileSync(path.join(DATASET_DIR, 'saqr_custom.yaml'), yamlContent, 'utf-8');

  console.log(`[ACTIVE-LEARNING] ✅ Export complete!`);
  console.log(`[ACTIVE-LEARNING] - Verified Positives (True Violations): ${positiveCount}`);
  console.log(`[ACTIVE-LEARNING] - Hard Negatives (False Alarms Suppressed): ${negativeCount}`);
  console.log(`[ACTIVE-LEARNING] - YAML Config: ${path.join(DATASET_DIR, 'saqr_custom.yaml')}`);
}

if (require.main === module) {
  exportFromDb();
}

module.exports = { exportFromDb };
