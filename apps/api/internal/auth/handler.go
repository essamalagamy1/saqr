package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rased/api/pkg/config"
)

// Handler handles authentication HTTP requests.
type Handler struct {
	service *Service
}

// NewHandler creates a new auth handler.
func NewHandler(db *pgxpool.Pool, cfg *config.Config) *Handler {
	return &Handler{
		service: NewService(db, cfg.JWTSecret, cfg.JWTExpiry),
	}
}

// Login handles POST /api/v1/auth/login
func (h *Handler) Login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Invalid request body",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Email and password are required",
		})
	}

	user, tokens, err := h.service.Login(c.Context(), &req)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error":   err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"user":   user,
			"tokens": tokens,
		},
	})
}

// Register handles POST /api/v1/auth/register
func (h *Handler) Register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Invalid request body",
		})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" || req.CompanyName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "All fields are required",
		})
	}

	user, tokens, err := h.service.Register(c.Context(), &req)
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"success": false,
			"error":   err.Error(),
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"user":   user,
			"tokens": tokens,
		},
	})
}

// RefreshToken handles POST /api/v1/auth/refresh
func (h *Handler) RefreshToken(c *fiber.Ctx) error {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&body); err != nil || body.RefreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Refresh token is required",
		})
	}

	claims, err := h.service.ValidateRefreshToken(body.RefreshToken)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error":   err.Error(),
		})
	}

	user, err := h.service.GetUserByID(c.Context(), claims.UserID)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"error":   "User not found",
		})
	}

	tokens, err := h.service.GenerateTokens(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error":   "Failed to generate tokens",
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"tokens": tokens,
		},
	})
}

// Logout handles POST /api/v1/auth/logout
func (h *Handler) Logout(c *fiber.Ctx) error {
	// In a stateless JWT setup, logout is handled client-side.
	// For a more robust solution, implement token blacklisting with Redis.
	return c.JSON(fiber.Map{
		"success": true,
		"message": "Logged out successfully",
	})
}
