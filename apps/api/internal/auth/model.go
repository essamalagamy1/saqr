package auth

import (
	"time"
)

// User represents the users table.
type User struct {
	ID                string    `json:"id"`
	CompanyID         string    `json:"company_id"`
	Name              string    `json:"name"`
	Email             string    `json:"email"`
	PasswordHash      string    `json:"-"`
	Role              string    `json:"role"`
	Permissions       string    `json:"permissions"`
	NotificationPrefs string    `json:"notification_prefs"`
	IsActive          bool      `json:"is_active"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// LoginRequest represents the login payload.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// RegisterRequest represents the registration payload.
type RegisterRequest struct {
	CompanyName string `json:"company_name"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	Password    string `json:"password"`
}

// TokenResponse represents the JWT token response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}
