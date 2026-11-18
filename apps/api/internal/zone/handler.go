package zone

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Zone struct {
	ID            string    `json:"id"`
	BranchID      string    `json:"branch_id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Type          string    `json:"type"`
	PolygonCoords string    `json:"polygon_coords"`
	IsRestricted  bool      `json:"is_restricted"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type CreateZoneRequest struct {
	BranchID      string `json:"branch_id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	Type          string `json:"type"`
	PolygonCoords string `json:"polygon_coords"`
	IsRestricted  bool   `json:"is_restricted"`
}

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

// List lists zones for a branch or company
func (h *Handler) List(c *fiber.Ctx) error {
	branchID := c.Query("branch_id")
	companyID := c.Locals("company_id").(string)

	var query string
	var args []interface{}

	if branchID != "" {
		query = `
			SELECT z.id, z.branch_id, z.name, COALESCE(z.description, ''), z.type, 
			       z.polygon_coords::text, z.is_restricted, z.created_at, z.updated_at
			FROM zones z
			JOIN branches b ON z.branch_id = b.id
			WHERE z.branch_id = $1 AND b.company_id = $2
			ORDER BY z.created_at DESC
		`
		args = []interface{}{branchID, companyID}
	} else {
		query = `
			SELECT z.id, z.branch_id, z.name, COALESCE(z.description, ''), z.type, 
			       z.polygon_coords::text, z.is_restricted, z.created_at, z.updated_at
			FROM zones z
			JOIN branches b ON z.branch_id = b.id
			WHERE b.company_id = $1
			ORDER BY z.created_at DESC
		`
		args = []interface{}{companyID}
	}

	rows, err := h.db.Query(c.Context(), query, args...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	defer rows.Close()

	var zones []Zone
	for rows.Next() {
		var z Zone
		if err := rows.Scan(&z.ID, &z.BranchID, &z.Name, &z.Description, &z.Type, &z.PolygonCoords, &z.IsRestricted, &z.CreatedAt, &z.UpdatedAt); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
		}
		zones = append(zones, z)
	}

	return c.JSON(fiber.Map{"success": true, "data": zones})
}

// Create creates a zone
func (h *Handler) Create(c *fiber.Ctx) error {
	var req CreateZoneRequest
	if err := c.BodyParser(&req); err != nil || req.Name == "" || req.BranchID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Name and branch_id are required"})
	}

	if req.PolygonCoords == "" {
		req.PolygonCoords = "[]"
	}
	if req.Type == "" {
		req.Type = "general"
	}

	var z Zone
	query := `
		INSERT INTO zones (branch_id, name, description, type, polygon_coords, is_restricted)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6)
		RETURNING id, branch_id, name, COALESCE(description, ''), type, polygon_coords::text, is_restricted, created_at, updated_at
	`
	err := h.db.QueryRow(c.Context(), query, req.BranchID, req.Name, req.Description, req.Type, req.PolygonCoords, req.IsRestricted).Scan(
		&z.ID, &z.BranchID, &z.Name, &z.Description, &z.Type, &z.PolygonCoords, &z.IsRestricted, &z.CreatedAt, &z.UpdatedAt,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": z})
}

// Delete deletes a zone
func (h *Handler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	query := `DELETE FROM zones WHERE id = $1`
	_, err := h.db.Exec(c.Context(), query, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "message": "Zone deleted"})
}
