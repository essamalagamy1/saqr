package detection

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rased/api/internal/notification"
	"github.com/rased/api/pkg/redis"
)

type Detection struct {
	ID              string    `json:"id"`
	CompanyID       string    `json:"company_id"`
	BranchID        string    `json:"branch_id"`
	BranchName      string    `json:"branch_name,omitempty"`
	CameraID        string    `json:"camera_id"`
	CameraName      string    `json:"camera_name,omitempty"`
	AIServiceID     *string   `json:"ai_service_id,omitempty"`
	ServiceName     string    `json:"service_name,omitempty"`
	ZoneID          *string   `json:"zone_id,omitempty"`
	ZoneName        string    `json:"zone_name,omitempty"`
	Type            string    `json:"type"`
	Severity        string    `json:"severity"` // low, medium, high, critical
	Confidence      float64   `json:"confidence"`
	BoundingBoxes   string    `json:"bounding_boxes"`
	Metadata        string    `json:"metadata"`
	SnapshotURL     string    `json:"snapshot_url"`
	VideoClipURL    string    `json:"video_clip_url,omitempty"`
	IsRead          bool      `json:"is_read"`
	IsAcknowledged  bool      `json:"is_acknowledged"`
	AcknowledgedBy  string    `json:"acknowledged_by,omitempty"`
	DetectedAt      time.Time `json:"detected_at"`
	CreatedAt       time.Time `json:"created_at"`
}

type CreateDetectionRequest struct {
	CameraID      string  `json:"camera_id"`
	BranchID      string  `json:"branch_id"`
	AIServiceSlug string  `json:"ai_service_slug"`
	Type          string  `json:"type"`
	Severity      string  `json:"severity"`
	Confidence    float64 `json:"confidence"`
	BoundingBoxes string  `json:"bounding_boxes"`
	SnapshotURL   string  `json:"snapshot_url"`
	Metadata      string  `json:"metadata"`
}

type Handler struct {
	db       *pgxpool.Pool
	redis    *redis.Client
	notifier *notification.TelegramNotifier
}

func NewHandler(db *pgxpool.Pool, rc *redis.Client, notif *notification.TelegramNotifier) *Handler {
	return &Handler{
		db:       db,
		redis:    rc,
		notifier: notif,
	}
}

// List returns detections with filters
func (h *Handler) List(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)
	branchID := c.Query("branch_id")
	cameraID := c.Query("camera_id")
	serviceType := c.Query("type")
	severity := c.Query("severity")

	query := `
		SELECT d.id, d.company_id, d.branch_id, b.name as branch_name,
		       d.camera_id, c.name as camera_name, d.ai_service_id, COALESCE(s.name, d.type) as service_name,
		       d.zone_id, COALESCE(z.name, '') as zone_name,
		       d.type, d.severity, d.confidence, d.bounding_boxes::text, d.metadata::text,
		       COALESCE(d.snapshot_url, ''), COALESCE(d.video_clip_url, ''),
		       d.is_read, d.is_acknowledged, COALESCE(d.acknowledged_by, ''),
		       d.detected_at, d.created_at
		FROM detections d
		JOIN branches b ON d.branch_id = b.id
		JOIN cameras c ON d.camera_id = c.id
		LEFT JOIN ai_services s ON d.ai_service_id = s.id
		LEFT JOIN zones z ON d.zone_id = z.id
		WHERE d.company_id = $1
	`
	var args []interface{}
	args = append(args, companyID)

	idx := 2
	if branchID != "" {
		query += fmt.Sprintf(" AND d.branch_id = $%d", idx)
		args = append(args, branchID)
		idx++
	}
	if cameraID != "" {
		query += fmt.Sprintf(" AND d.camera_id = $%d", idx)
		args = append(args, cameraID)
		idx++
	}
	if serviceType != "" {
		query += fmt.Sprintf(" AND d.type = $%d", idx)
		args = append(args, serviceType)
		idx++
	}
	if severity != "" {
		query += fmt.Sprintf(" AND d.severity = $%d", idx)
		args = append(args, severity)
		idx++
	}

	query += ` ORDER BY d.detected_at DESC LIMIT 50`

	rows, err := h.db.Query(c.Context(), query, args...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	defer rows.Close()

	var detections []Detection
	for rows.Next() {
		var d Detection
		if err := rows.Scan(
			&d.ID, &d.CompanyID, &d.BranchID, &d.BranchName,
			&d.CameraID, &d.CameraName, &d.AIServiceID, &d.ServiceName,
			&d.ZoneID, &d.ZoneName,
			&d.Type, &d.Severity, &d.Confidence, &d.BoundingBoxes, &d.Metadata,
			&d.SnapshotURL, &d.VideoClipURL,
			&d.IsRead, &d.IsAcknowledged, &d.AcknowledgedBy,
			&d.DetectedAt, &d.CreatedAt,
		); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
		}
		detections = append(detections, d)
	}

	return c.JSON(fiber.Map{"success": true, "data": detections})
}

// Ingest creates a detection from the Edge Agent and publishes real-time events
func (h *Handler) Ingest(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	var req CreateDetectionRequest
	if err := c.BodyParser(&req); err != nil || req.CameraID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Invalid detection payload: camera_id is required"})
	}

	if req.BranchID == "" {
		_ = h.db.QueryRow(c.Context(), `SELECT branch_id FROM cameras WHERE id = $1`, req.CameraID).Scan(&req.BranchID)
	}

	if req.BoundingBoxes == "" {
		req.BoundingBoxes = "[]"
	}
	if req.Metadata == "" {
		req.Metadata = "{}"
	}
	if req.Severity == "" {
		req.Severity = "medium"
	}

	query := `
		INSERT INTO detections (company_id, branch_id, camera_id, type, severity, confidence, bounding_boxes, metadata, snapshot_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
		RETURNING id, type, severity, confidence, detected_at
	`
	var id, dType, severity string
	var confidence float64
	var detectedAt time.Time

	err := h.db.QueryRow(c.Context(), query, companyID, req.BranchID, req.CameraID, req.Type, req.Severity, req.Confidence, req.BoundingBoxes, req.Metadata, req.SnapshotURL).Scan(
		&id, &dType, &severity, &confidence, &detectedAt,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	// Fetch camera and branch names for notifications
	var branchName, cameraName, zoneName string
	_ = h.db.QueryRow(c.Context(), `SELECT name FROM branches WHERE id = $1`, req.BranchID).Scan(&branchName)
	_ = h.db.QueryRow(c.Context(), `SELECT name FROM cameras WHERE id = $1`, req.CameraID).Scan(&cameraName)

	eventData := fiber.Map{
		"id":           id,
		"company_id":   companyID,
		"branch_id":    req.BranchID,
		"branch_name":  branchName,
		"camera_id":    req.CameraID,
		"camera_name":  cameraName,
		"zone_name":    zoneName,
		"type":         dType,
		"severity":     severity,
		"confidence":   confidence,
		"snapshot_url": req.SnapshotURL,
		"detected_at":  detectedAt,
	}

	// Publish to Redis channel for SSE real-time broadcast
	if h.redis != nil {
		payloadBytes, _ := json.Marshal(eventData)
		channel := fmt.Sprintf("company:%s:events", companyID)
		go func() {
			if err := h.redis.Publish(context.Background(), channel, string(payloadBytes)); err != nil {
				log.Printf("Failed to publish detection to Redis: %v", err)
			}
		}()
	}

	// Dispatch Telegram alert if high or critical
	if h.notifier != nil && (severity == "high" || severity == "critical") {
		go func() {
			_ = h.notifier.SendAlert(context.Background(), notification.AlertPayload{
				DetectionID: id,
				CompanyID:   companyID,
				BranchName:  branchName,
				CameraName:  cameraName,
				ZoneName:    zoneName,
				Type:        dType,
				Severity:    severity,
				Confidence:  confidence,
				SnapshotURL: req.SnapshotURL,
				DetectedAt:  detectedAt,
			})
		}()
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"success": true,
		"data":    eventData,
	})
}

// MarkAsRead marks a detection as read
func (h *Handler) MarkAsRead(c *fiber.Ctx) error {
	id := c.Params("id")
	companyID := c.Locals("company_id").(string)

	_, err := h.db.Exec(c.Context(), `
		UPDATE detections SET is_read = true WHERE id = $1 AND company_id = $2
	`, id, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Marked as read"})
}

// Acknowledge marks a detection as acknowledged
func (h *Handler) Acknowledge(c *fiber.Ctx) error {
	id := c.Params("id")
	companyID := c.Locals("company_id").(string)

	var body struct {
		AcknowledgedBy string `json:"acknowledged_by"`
	}
	_ = c.BodyParser(&body)
	if body.AcknowledgedBy == "" {
		body.AcknowledgedBy = "User"
	}

	_, err := h.db.Exec(c.Context(), `
		UPDATE detections SET is_acknowledged = true, acknowledged_by = $1, is_read = true WHERE id = $2 AND company_id = $3
	`, body.AcknowledgedBy, id, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Detection acknowledged"})
}

// Stats returns KPI counts for dashboard
func (h *Handler) Stats(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	var totalDetections, unreadDetections, activeCameras, activeServices int

	_ = h.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM detections WHERE company_id = $1`, companyID).Scan(&totalDetections)
	_ = h.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM detections WHERE company_id = $1 AND is_read = false`, companyID).Scan(&unreadDetections)
	_ = h.db.QueryRow(c.Context(), `
		SELECT COUNT(c.id) FROM cameras c 
		JOIN branches b ON c.branch_id = b.id 
		WHERE b.company_id = $1 AND c.status = 'active'`, companyID).Scan(&activeCameras)
	_ = h.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM ai_services WHERE is_active = true`).Scan(&activeServices)

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"total_detections":  totalDetections,
			"unread_detections": unreadDetections,
			"active_cameras":    activeCameras,
			"active_services":   activeServices,
		},
	})
}

// Delete removes a single detection by ID
func (h *Handler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	companyID := c.Locals("company_id").(string)

	res, err := h.db.Exec(c.Context(), `DELETE FROM detections WHERE id = $1 AND company_id = $2`, id, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	if res.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "error": "Detection not found"})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Detection deleted successfully"})
}

// DeleteAll removes all detections for the company
func (h *Handler) DeleteAll(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	res, err := h.db.Exec(c.Context(), `DELETE FROM detections WHERE company_id = $1`, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"deleted": res.RowsAffected(),
		"message": "All detections deleted successfully",
	})
}
