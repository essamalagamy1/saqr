const fs = require('fs');
const path = require('path');
const AIEngine = require('../apps/desktop/src/ai-engine');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const hotDir = path.join(__dirname, '..', 'storage', 'snapshots', 'hot');
  const files = fs.existsSync(hotDir)
    ? fs.readdirSync(hotDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'))
    : [];

  if (files.length === 0) {
    console.error('No JPEG snapshots found in', hotDir);
    process.exit(1);
  }

  const samplePath = path.join(hotDir, files[0]);
  const frameBuffer = fs.readFileSync(samplePath);
  const ai = new AIEngine();
  await ai.init();

  const models = ['face_mask', 'gloves', 'phone'];
  const warmupRuns = 3;
  const measuredRuns = 15;

  for (let i = 0; i < warmupRuns; i++) {
    await ai.detect(frameBuffer, models);
  }

  const latencies = [];
  let lastResult = null;
  for (let i = 0; i < measuredRuns; i++) {
    const t0 = performance.now();
    lastResult = await ai.detect(frameBuffer, models);
    latencies.push(performance.now() - t0);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const meanMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const fps = 1000 / meanMs;

  console.log(JSON.stringify({
    sample: path.basename(samplePath),
    models,
    warmupRuns,
    measuredRuns,
    meanMs: Number(meanMs.toFixed(2)),
    fps: Number(fps.toFixed(2)),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    p99Ms: Number(percentile(sorted, 99).toFixed(2)),
    personsDetected: lastResult?.persons?.length ?? 0,
    violationsDetected: lastResult?.detections?.length ?? 0
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
