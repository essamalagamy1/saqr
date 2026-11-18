package middleware

import (
	"github.com/gofiber/fiber/v2"
)

// Tenant is an alias for TenantMiddleware
func Tenant() fiber.Handler {
	return TenantMiddleware()
}

// TenantMiddleware extracts company_id from JWT claims and enforces multi-tenancy.
// Must be used after AuthMiddleware.
func TenantMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		companyID, ok := c.Locals("company_id").(string)
		if !ok || companyID == "" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"success": false,
				"error":   "Company context not found in token",
			})
		}

		// Store tenant context for downstream handlers
		c.Locals("tenant_id", companyID)

		return c.Next()
	}
}
