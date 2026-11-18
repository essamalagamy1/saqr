package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rased/api/pkg/middleware"
	"golang.org/x/crypto/bcrypt"
)

// Service handles authentication business logic.
type Service struct {
	db        *pgxpool.Pool
	jwtSecret string
	jwtExpiry time.Duration
}

// NewService creates a new auth service.
func NewService(db *pgxpool.Pool, jwtSecret string, jwtExpiry time.Duration) *Service {
	return &Service{
		db:        db,
		jwtSecret: jwtSecret,
		jwtExpiry: jwtExpiry,
	}
}

// HashPassword hashes a plaintext password using bcrypt.
func (s *Service) HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// CheckPassword compares a plaintext password against a hash.
func (s *Service) CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// GenerateTokens creates a new access + refresh token pair.
func (s *Service) GenerateTokens(user *User) (*TokenResponse, error) {
	now := time.Now()
	expiresAt := now.Add(s.jwtExpiry)

	claims := &middleware.JWTClaims{
		UserID:    user.ID,
		CompanyID: user.CompanyID,
		Email:     user.Email,
		Role:      user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "rased-api",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	accessToken, err := token.SignedString([]byte(s.jwtSecret))
	if err != nil {
		return nil, fmt.Errorf("failed to sign access token: %w", err)
	}

	// Refresh token with longer expiry (7 days)
	refreshClaims := &middleware.JWTClaims{
		UserID:    user.ID,
		CompanyID: user.CompanyID,
		Email:     user.Email,
		Role:      user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "rased-api-refresh",
		},
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenStr, err := refreshToken.SignedString([]byte(s.jwtSecret))
	if err != nil {
		return nil, fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return &TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshTokenStr,
		ExpiresIn:    int64(s.jwtExpiry.Seconds()),
		TokenType:    "Bearer",
	}, nil
}

// ValidateRefreshToken parses and validates a refresh token.
func (s *Service) ValidateRefreshToken(tokenStr string) (*middleware.JWTClaims, error) {
	claims := &middleware.JWTClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(s.jwtSecret), nil
	})

	if err != nil || !token.Valid {
		return nil, errors.New("invalid or expired refresh token")
	}

	if claims.Issuer != "rased-api-refresh" {
		return nil, errors.New("not a refresh token")
	}

	return claims, nil
}

// Login authenticates a user by email and password.
func (s *Service) Login(ctx context.Context, req *LoginRequest) (*User, *TokenResponse, error) {
	var user User
	err := s.db.QueryRow(ctx,
		`SELECT id, company_id, name, email, password_hash, role, permissions, notification_prefs, is_active
		 FROM users WHERE email = $1`,
		req.Email,
	).Scan(
		&user.ID, &user.CompanyID, &user.Name, &user.Email, &user.PasswordHash,
		&user.Role, &user.Permissions, &user.NotificationPrefs, &user.IsActive,
	)
	if err != nil {
		return nil, nil, errors.New("invalid email or password")
	}

	if !user.IsActive {
		return nil, nil, errors.New("account is deactivated")
	}

	if !s.CheckPassword(req.Password, user.PasswordHash) {
		return nil, nil, errors.New("invalid email or password")
	}

	tokens, err := s.GenerateTokens(&user)
	if err != nil {
		return nil, nil, err
	}

	return &user, tokens, nil
}

// Register creates a new company and admin user.
func (s *Service) Register(ctx context.Context, req *RegisterRequest) (*User, *TokenResponse, error) {
	hash, err := s.HashPassword(req.Password)
	if err != nil {
		return nil, nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Create company
	var companyID string
	err = tx.QueryRow(ctx,
		`INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
		req.CompanyName, generateSlug(req.CompanyName),
	).Scan(&companyID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create company: %w", err)
	}

	// Create admin user
	var user User
	err = tx.QueryRow(ctx,
		`INSERT INTO users (company_id, name, email, password_hash, role)
		 VALUES ($1, $2, $3, $4, 'admin')
		 RETURNING id, company_id, name, email, role, is_active`,
		companyID, req.Name, req.Email, hash,
	).Scan(&user.ID, &user.CompanyID, &user.Name, &user.Email, &user.Role, &user.IsActive)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create user: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	tokens, err := s.GenerateTokens(&user)
	if err != nil {
		return nil, nil, err
	}

	return &user, tokens, nil
}

// GetUserByID fetches a user by ID.
func (s *Service) GetUserByID(ctx context.Context, userID string) (*User, error) {
	var user User
	err := s.db.QueryRow(ctx,
		`SELECT id, company_id, name, email, password_hash, role, permissions, notification_prefs, is_active, created_at, updated_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(
		&user.ID, &user.CompanyID, &user.Name, &user.Email, &user.PasswordHash,
		&user.Role, &user.Permissions, &user.NotificationPrefs, &user.IsActive,
		&user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, errors.New("user not found")
	}
	return &user, nil
}

// generateSlug creates a URL-safe slug from a string.
func generateSlug(name string) string {
	slug := ""
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			slug += string(r)
		} else if r >= 'A' && r <= 'Z' {
			slug += string(r + 32)
		} else if r == ' ' || r == '-' {
			slug += "-"
		}
	}
	return slug
}
