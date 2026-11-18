-- 001_initial_schema.up.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Companies
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    logo_url TEXT,
    industry VARCHAR(100) DEFAULT 'restaurant',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    permissions JSONB DEFAULT '{}',
    notification_prefs JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Branches
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    latitude FLOAT,
    longitude FLOAT,
    timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Zones
CREATE TABLE IF NOT EXISTS zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'general',
    polygon_coords JSONB DEFAULT '[]',
    is_restricted BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cameras
CREATE TABLE IF NOT EXISTS cameras (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    rtsp_url_encrypted TEXT,
    dvr_ip VARCHAR(45),
    dvr_channel VARCHAR(20),
    protocol VARCHAR(20) DEFAULT 'rtsp',
    resolution VARCHAR(20) DEFAULT '1080p',
    fps INT DEFAULT 25,
    status VARCHAR(20) DEFAULT 'disconnected',
    last_seen_at TIMESTAMPTZ,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Services Catalog
CREATE TABLE IF NOT EXISTS ai_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'safety',
    model_version VARCHAR(50) DEFAULT 'v1',
    default_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Camera AI Service Configuration
CREATE TABLE IF NOT EXISTS ai_service_cameras (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    camera_id UUID REFERENCES cameras(id) ON DELETE CASCADE,
    ai_service_id UUID REFERENCES ai_services(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    custom_config JSONB DEFAULT '{}',
    roi_polygon JSONB DEFAULT '[]',
    confidence_threshold FLOAT DEFAULT 0.75,
    cooldown_seconds INT DEFAULT 60,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(camera_id, ai_service_id)
);

-- Detections (Event log)
CREATE TABLE IF NOT EXISTS detections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    camera_id UUID REFERENCES cameras(id) ON DELETE CASCADE,
    ai_service_id UUID REFERENCES ai_services(id) ON DELETE SET NULL,
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium',
    confidence FLOAT NOT NULL,
    bounding_boxes JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    snapshot_url TEXT,
    video_clip_url TEXT,
    is_read BOOLEAN DEFAULT false,
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by VARCHAR(255),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial AI Services
INSERT INTO ai_services (slug, name, description, category) VALUES
('visitor_counting', 'عد الزوار', 'حساب عدد الداخلين والخارجين وقياس التوافد', 'analytics'),
('loitering_detection', 'كشف التسكع', 'رصد تواجد الأفراد في مناطق محددة لفترات تتجاوز المسموح به', 'monitoring'),
('kitchen_ppe', 'سلامة المطبخ (PPE)', 'رصد ارتداء قفازات العمل وغطاء الرأس والكمامات', 'safety'),
('phone_usage', 'كشف استخدام الجوال', 'رصد استخدام الموظفين للهواتف أثناء ساعات العمل أو في مناطق الإنتاج', 'operations'),
('employee_monitoring', 'مراقبة الموظفين', 'تتبع تواجد العاملين في نطاقات عملهم المحددة', 'operations'),
('queue_wait_time', 'العميل المنتظر', 'قياس أوقات الانتظار وطول الطوابير', 'analytics')
ON CONFLICT (slug) DO NOTHING;
