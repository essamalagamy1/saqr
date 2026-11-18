package ai_service

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AIService struct {
	ID            string    `json:"id"`
	Slug          string    `json:"slug"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Category      string    `json:"category"`
	ModelVersion  string    `json:"model_version"`
	DefaultConfig string    `json:"default_config"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

// List returns all active AI services
func (h *Handler) List(c *fiber.Ctx) error {
	query := `
		SELECT id, slug, name, COALESCE(description, ''), category, model_version, 
		       default_config::text, is_active, created_at, updated_at
		FROM ai_services
		ORDER BY created_at ASC
	`
	rows, err := h.db.Query(c.Context(), query)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	defer rows.Close()

	var services []AIService
	for rows.Next() {
		var s AIService
		if err := rows.Scan(&s.ID, &s.Slug, &s.Name, &s.Description, &s.Category, &s.ModelVersion, &s.DefaultConfig, &s.IsActive, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
		}
		services = append(services, s)
	}

	return c.JSON(fiber.Map{"success": true, "data": services})
}

// ToggleStatus enables/disables an AI service
func (h *Handler) ToggleStatus(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		IsActive bool `json:"is_active"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Invalid request"})
	}

	query := `UPDATE ai_services SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active`
	var svcID string
	var isActive bool
	err := h.db.QueryRow(c.Context(), query, req.IsActive, id).Scan(&svcID, &isActive)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"id": svcID, "is_active": isActive}})
}
