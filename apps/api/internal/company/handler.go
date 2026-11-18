package company

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Company struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	LogoURL   string    `json:"logo_url,omitempty"`
	Industry  string    `json:"industry"`
	Settings  string    `json:"settings"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

// GetCurrentCompany returns the current company details based on context (from JWT)
func (h *Handler) GetCurrent(c *fiber.Ctx) error {
	companyID, ok := c.Locals("company_id").(string)
	if !ok || companyID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error":   "Unauthorized",
		})
	}

	var comp Company
	query := `SELECT id, name, slug, COALESCE(logo_url, ''), industry, settings::text, created_at, updated_at FROM companies WHERE id = $1`
	err := h.db.QueryRow(c.Context(), query, companyID).Scan(
		&comp.ID, &comp.Name, &comp.Slug, &comp.LogoURL, &comp.Industry, &comp.Settings, &comp.CreatedAt, &comp.UpdatedAt,
	)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error":   "Company not found",
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    comp,
	})
}

// UpdateCurrent updates company settings
func (h *Handler) UpdateCurrent(c *fiber.Ctx) error {
	companyID, ok := c.Locals("company_id").(string)
	if !ok || companyID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error":   "Unauthorized",
		})
	}

	var req struct {
		Name     string `json:"name"`
		Industry string `json:"industry"`
		LogoURL  string `json:"logo_url"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Invalid body",
		})
	}

	query := `
		UPDATE companies 
		SET name = COALESCE(NULLIF($1, ''), name),
		    industry = COALESCE(NULLIF($2, ''), industry),
		    logo_url = COALESCE(NULLIF($3, ''), logo_url),
		    updated_at = NOW()
		WHERE id = $4
		RETURNING id, name, slug, COALESCE(logo_url, ''), industry, settings::text, created_at, updated_at
	`
	var comp Company
	err := h.db.QueryRow(context.Background(), query, req.Name, req.Industry, req.LogoURL, companyID).Scan(
		&comp.ID, &comp.Name, &comp.Slug, &comp.LogoURL, &comp.Industry, &comp.Settings, &comp.CreatedAt, &comp.UpdatedAt,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error":   err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    comp,
	})
}
