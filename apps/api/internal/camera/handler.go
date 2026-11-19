package camera

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Camera struct {
	ID          string     `json:"id"`
	BranchID    string     `json:"branch_id"`
	ZoneID      *string    `json:"zone_id,omitempty"`
	BranchName  string     `json:"branch_name,omitempty"`
	ZoneName    string     `json:"zone_name,omitempty"`
	Name        string     `json:"name"`
	RtspURL     string     `json:"rtsp_url,omitempty"`
	DvrIP       string     `json:"dvr_ip"`
	DvrChannel  string     `json:"dvr_channel"`
	Protocol    string     `json:"protocol"`
	Resolution  string     `json:"resolution"`
	FPS         int        `json:"fps"`
	Status      string     `json:"status"` // active, pause, disconnected
	LastSeenAt  *time.Time `json:"last_seen_at,omitempty"`
	Config      string     `json:"config"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type CreateCameraRequest struct {
	BranchID   string  `json:"branch_id"`
	ZoneID     *string `json:"zone_id,omitempty"`
	Name       string  `json:"name"`
	RtspURL    string  `json:"rtsp_url"`
	DvrIP      string  `json:"dvr_ip"`
	DvrChannel string  `json:"dvr_channel"`
	Protocol   string  `json:"protocol"`
	Resolution string  `json:"resolution"`
	FPS        int     `json:"fps"`
}

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

// List lists cameras for the company
func (h *Handler) List(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)
	branchID := c.Query("branch_id")

	query := `
		SELECT c.id, c.branch_id, c.zone_id, b.name as branch_name, COALESCE(z.name, '') as zone_name,
		       c.name, COALESCE(c.rtsp_url_encrypted, '') as rtsp_url, COALESCE(c.dvr_ip, ''), COALESCE(c.dvr_channel, ''), c.protocol, 
		       c.resolution, c.fps, c.status, c.last_seen_at, c.config::text, c.created_at, c.updated_at
		FROM cameras c
		JOIN branches b ON c.branch_id = b.id
		LEFT JOIN zones z ON c.zone_id = z.id
		WHERE b.company_id = $1
	`
	var args []interface{}
	args = append(args, companyID)

	if branchID != "" {
		query += ` AND c.branch_id = $2`
		args = append(args, branchID)
	}
	query += ` ORDER BY c.created_at DESC`

	rows, err := h.db.Query(c.Context(), query, args...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	defer rows.Close()

	cameras := []Camera{}
	for rows.Next() {
		var cam Camera
		if err := rows.Scan(
			&cam.ID, &cam.BranchID, &cam.ZoneID, &cam.BranchName, &cam.ZoneName,
			&cam.Name, &cam.RtspURL, &cam.DvrIP, &cam.DvrChannel, &cam.Protocol,
			&cam.Resolution, &cam.FPS, &cam.Status, &cam.LastSeenAt, &cam.Config, &cam.CreatedAt, &cam.UpdatedAt,
		); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
		}
		cameras = append(cameras, cam)
	}

	return c.JSON(fiber.Map{"success": true, "data": cameras})
}

// Create creates a new camera or updates existing one to prevent duplicates
func (h *Handler) Create(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	var req CreateCameraRequest
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Camera name is required"})
	}

	// Auto-resolve branch_id if omitted
	if req.BranchID == "" {
		_ = h.db.QueryRow(c.Context(), `SELECT id FROM branches WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1`, companyID).Scan(&req.BranchID)
		if req.BranchID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "No branch found for this company"})
		}
	}

	if req.Protocol == "" {
		req.Protocol = "rtsp"
	}
	if req.Resolution == "" {
		req.Resolution = "1080p"
	}
	if req.FPS <= 0 {
		req.FPS = 25
	}

	// Check for existing camera in this company to prevent duplicates
	// For NVR/DVR systems, multiple cameras share the same dvr_ip across different channels (CH1..CH8)
	var existingID string
	errCheck := h.db.QueryRow(c.Context(), `
		SELECT c.id FROM cameras c
		JOIN branches b ON c.branch_id = b.id
		WHERE b.company_id = $1 AND (
			(c.dvr_ip != '' AND c.dvr_ip = $2 AND c.dvr_channel != '' AND c.dvr_channel = $3) OR
			($4 != '' AND c.rtsp_url_encrypted = $4) OR
			(c.name = $5)
		) LIMIT 1
	`, companyID, req.DvrIP, req.DvrChannel, req.RtspURL, req.Name).Scan(&existingID)

	var cam Camera
	if errCheck == nil && existingID != "" {
		// Update existing camera rather than duplicating
		updateQuery := `
			UPDATE cameras
			SET name = $1,
			    rtsp_url_encrypted = COALESCE(NULLIF($2, ''), rtsp_url_encrypted),
			    dvr_ip = COALESCE(NULLIF($3, ''), dvr_ip),
			    dvr_channel = COALESCE(NULLIF($4, ''), dvr_channel),
			    status = 'active',
			    updated_at = NOW()
			WHERE id = $5
			RETURNING id, branch_id, zone_id, name, COALESCE(rtsp_url_encrypted, ''), COALESCE(dvr_ip, ''), COALESCE(dvr_channel, ''), protocol, resolution, fps, status, created_at, updated_at
		`
		err := h.db.QueryRow(c.Context(), updateQuery, req.Name, req.RtspURL, req.DvrIP, req.DvrChannel, existingID).Scan(
			&cam.ID, &cam.BranchID, &cam.ZoneID, &cam.Name, &cam.RtspURL, &cam.DvrIP, &cam.DvrChannel, &cam.Protocol, &cam.Resolution, &cam.FPS, &cam.Status, &cam.CreatedAt, &cam.UpdatedAt,
		)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"success": true, "data": cam, "updated": true})
	}

	query := `
		INSERT INTO cameras (branch_id, zone_id, name, rtsp_url_encrypted, dvr_ip, dvr_channel, protocol, resolution, fps, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
		RETURNING id, branch_id, zone_id, name, COALESCE(rtsp_url_encrypted, ''), COALESCE(dvr_ip, ''), COALESCE(dvr_channel, ''), protocol, resolution, fps, status, created_at, updated_at
	`
	err := h.db.QueryRow(c.Context(), query, req.BranchID, req.ZoneID, req.Name, req.RtspURL, req.DvrIP, req.DvrChannel, req.Protocol, req.Resolution, req.FPS).Scan(
		&cam.ID, &cam.BranchID, &cam.ZoneID, &cam.Name, &cam.RtspURL, &cam.DvrIP, &cam.DvrChannel, &cam.Protocol, &cam.Resolution, &cam.FPS, &cam.Status, &cam.CreatedAt, &cam.UpdatedAt,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": cam})
}

// UpdateStatus toggles camera status (active/pause/disconnected)
func (h *Handler) UpdateStatus(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		Status string `json:"status"`
	}
	if err := c.BodyParser(&req); err != nil || req.Status == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Status is required"})
	}

	query := `UPDATE cameras SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`
	var camID, status string
	err := h.db.QueryRow(c.Context(), query, req.Status, id).Scan(&camID, &status)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"id": camID, "status": status}})
}

// Delete deletes a camera
func (h *Handler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	query := `DELETE FROM cameras WHERE id = $1`
	_, err := h.db.Exec(c.Context(), query, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "message": "Camera deleted"})
}
