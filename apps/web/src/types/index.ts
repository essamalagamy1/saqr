export interface Company {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  industry: string;
  settings: Record<string, any>;
  created_at: string;
}

export interface Branch {
  id: string;
  company_id: string;
  name: string;
  address?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  is_active: boolean;
}

export interface Zone {
  id: string;
  branch_id: string;
  name: string;
  description?: string;
  type: string;
  polygon_coords: any[];
  is_restricted: boolean;
}

export interface Camera {
  id: string;
  branch_id: string;
  zone_id?: string;
  branch_name?: string;
  zone_name?: string;
  name: string;
  dvr_ip?: string;
  dvr_channel?: string;
  protocol: string;
  resolution: string;
  fps: number;
  status: 'active' | 'pause' | 'disconnected';
  last_seen_at?: string;
}

export interface AIService {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: 'safety' | 'operations' | 'analytics' | 'monitoring';
  is_active: boolean;
  detections_count?: number;
}

export interface Detection {
  id: string;
  company_id: string;
  branch_id: string;
  branch_name: string;
  camera_id: string;
  camera_name: string;
  service_name: string;
  zone_name?: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  bounding_boxes: any[];
  metadata: Record<string, any>;
  snapshot_url: string;
  is_read: boolean;
  detected_at: string;
}

export interface DashboardStats {
  total_cameras: number;
  active_cameras: number;
  active_services: number;
  detections_today: number;
  unread_detections: number;
  trial_days_remaining: number;
  trial_expires_at: string;
  quota_usage_percent: number;
}
