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

    if (!buffer || buffer.length < 500) {
      return NextResponse.json({ success: false, error: 'Empty or invalid frame' }, { status: 400 });
    }

    const frameData = { buffer, updatedAt: Date.now() };

    if (cameraId) {
      global.cameraLiveFrames?.set(cameraId, frameData);
    }
    if (cameraIp) {
      global.cameraLiveFrames?.set(cameraIp, frameData);
      global.cameraLiveFrames?.set(`${cameraIp}_${cameraChannel.toLowerCase()}`, frameData);
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
  return NextResponse.json({
    success: true,
    activeFramesCount: count,
    cachedKeys: global.cameraLiveFrames ? Array.from(global.cameraLiveFrames.keys()) : [],
  });
}

export async function DELETE(req: NextRequest) {
  if (global.cameraLiveFrames) {
    global.cameraLiveFrames.clear();
  }
  return NextResponse.json({ success: true, message: 'Frames cache cleared' });
}
