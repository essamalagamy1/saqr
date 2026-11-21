import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Global memory cache for live camera frames
declare global {
  var cameraLiveFrames: Map<string, { buffer: Buffer; updatedAt: number }> | undefined;
}

if (!global.cameraLiveFrames) {
  global.cameraLiveFrames = new Map();
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let cameraId = req.headers.get('x-camera-id') || '';
    let cameraIp = req.headers.get('x-camera-ip') || '';
    let cameraChannel = req.headers.get('x-camera-channel') || 'CH1';
    let buffer: Buffer | null = null;

    if (contentType.includes('application/json')) {
      const body = await req.json();
      cameraId = body.id || cameraId;
      cameraIp = body.ip || cameraIp;
      cameraChannel = body.channel || cameraChannel;
      if (body.frame) {
        // Base64 frame
        buffer = Buffer.from(body.frame.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      }
    } else {
      // Raw binary image bytes
      const arrayBuffer = await req.arrayBuffer();
      if (arrayBuffer && arrayBuffer.byteLength > 0) {
        buffer = Buffer.from(arrayBuffer);
      }
    }

    if (!buffer || buffer.length < 2000) {
      return NextResponse.json({ success: false, error: 'Empty or incomplete frame (min 2KB required)' }, { status: 400 });
    }

    const frameData = { buffer, updatedAt: Date.now() };

    if (cameraId) {
      global.cameraLiveFrames?.set(cameraId, frameData);
    }
    if (cameraIp && cameraChannel) {
      const cleanCh = cameraChannel.toLowerCase().trim();
      global.cameraLiveFrames?.set(`${cameraIp}_${cleanCh}`, frameData);
      // Also index by number only if formatted like CH1 / CH01
      const numOnly = cleanCh.replace(/[^0-9]/g, '');
      if (numOnly) {
        global.cameraLiveFrames?.set(`${cameraIp}_ch${numOnly}`, frameData);
        global.cameraLiveFrames?.set(`${cameraIp}_${numOnly}`, frameData);
      }
    } else if (cameraIp) {
      // Only set bare IP if no channel was specified (single standalone camera)
      global.cameraLiveFrames?.set(cameraIp, frameData);
    }

    return NextResponse.json({
      success: true,
      size: buffer.length,
      updatedAt: frameData.updatedAt
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const count = global.cameraLiveFrames ? global.cameraLiveFrames.size : 0;
  const now = Date.now();
  const details: Record<string, { ageSeconds: number; sizeBytes: number }> = {};
  if (global.cameraLiveFrames) {
    for (const [key, val] of global.cameraLiveFrames.entries()) {
      details[key] = {
        ageSeconds: Math.round((now - (val.updatedAt || 0)) / 1000),
        sizeBytes: val.buffer?.length || 0,
      };
    }
  }
  return NextResponse.json({
    success: true,
    activeFramesCount: count,
    now,
    details,
  });
}

export async function DELETE(req: NextRequest) {
  if (global.cameraLiveFrames) {
    global.cameraLiveFrames.clear();
  }
  return NextResponse.json({ success: true, message: 'Frames cache cleared' });
}
