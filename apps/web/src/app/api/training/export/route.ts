import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function POST() {
  try {
    const scriptPath = path.resolve(process.cwd(), '..', '..', 'scripts', 'export_active_dataset.js');
    const { stdout, stderr } = await execFileAsync('node', [scriptPath]);
    return NextResponse.json({
      success: true,
      message: 'تم استخراج وتجهيز عينات التدريب من الرصد الميداني بنجاح',
      output: stdout,
    });
  } catch (err: any) {
    console.error('Export error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'فشل استخراج عينات التدريب' },
      { status: 500 }
    );
  }
}
