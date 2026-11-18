package branch

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Branch struct {
	ID        string    `json:"id"`
	CompanyID string    `json:"company_id"`
	Name      string    `json:"name"`
	Address   string    `json:"address"`
	City      string    `json:"city"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Timezone  string    `json:"timezone"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CreateBranchRequest struct {
	Name     string  `json:"name"`
	Address  string  `json:"address"`
	City     string  `json:"city"`
	Latitude float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Timezone string  `json:"timezone"`
}

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

// List lists all branches for the company
func (h *Handler) List(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	query := `
		SELECT id, company_id, name, COALESCE(address, ''), COALESCE(city, ''), 
		       COALESCE(latitude, 0), COALESCE(longitude, 0), timezone, is_active, created_at, updated_at
		FROM branches 
		WHERE company_id = $1 
		ORDER BY created_at DESC
	`
	rows, err := h.db.Query(c.Context(), query, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	defer rows.Close()

	var branches []Branch
	for rows.Next() {
		var b Branch
		if err := rows.Scan(&b.ID, &b.CompanyID, &b.Name, &b.Address, &b.City, &b.Latitude, &b.Longitude, &b.Timezone, &b.IsActive, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
		}
		branches = append(branches, b)
	}

	return c.JSON(fiber.Map{"success": true, "data": branches})
}

// Create creates a new branch
func (h *Handler) Create(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	var req CreateBranchRequest
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Branch name is required"})
	}

	if req.Timezone == "" {
		req.Timezone = "Africa/Cairo"
	}

	var b Branch
	query := `
		INSERT INTO branches (company_id, name, address, city, latitude, longitude, timezone)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, company_id, name, COALESCE(address, ''), COALESCE(city, ''), latitude, longitude, timezone, is_active, created_at, updated_at
	`
	err := h.db.QueryRow(c.Context(), query, companyID, req.Name, req.Address, req.City, req.Latitude, req.Longitude, req.Timezone).Scan(
		&b.ID, &b.CompanyID, &b.Name, &b.Address, &b.City, &b.Latitude, &b.Longitude, &b.Timezone, &b.IsActive, &b.CreatedAt, &b.UpdatedAt,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": b})
}

// Delete removes a branch
func (h *Handler) Delete(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)
	branchID := c.Params("id")

	query := `DELETE FROM branches WHERE id = $1 AND company_id = $2`
	res, err := h.db.Exec(c.Context(), query, branchID, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	if res.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "error": "Branch not found"})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Branch deleted"})
}
