package task

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Task struct {
	ID          string     `json:"id"`
	CompanyID   string     `json:"company_id"`
	BranchID    string     `json:"branch_id"`
	BranchName  string     `json:"branch_name,omitempty"`
	DetectionID *string    `json:"detection_id,omitempty"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Priority    string     `json:"priority"`
	Status      string     `json:"status"`
	AssignedTo  string     `json:"assigned_to"`
	DueDate     *time.Time `json:"due_date,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type CreateTaskRequest struct {
	BranchID    string  `json:"branch_id"`
	DetectionID *string `json:"detection_id,omitempty"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Priority    string  `json:"priority"`
	AssignedTo  string  `json:"assigned_to"`
}

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

func (h *Handler) List(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	rows, err := h.db.Query(c.Context(), `
		SELECT t.id, t.company_id, t.branch_id, b.name as branch_name,
		       t.detection_id, t.title, COALESCE(t.description, ''),
		       t.priority, t.status, COALESCE(t.assigned_to, ''), t.due_date,
		       t.created_at, t.updated_at
		FROM tasks t
		JOIN branches b ON t.branch_id = b.id
		WHERE t.company_id = $1
		ORDER BY t.created_at DESC
	`, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		if err := rows.Scan(
			&t.ID, &t.CompanyID, &t.BranchID, &t.BranchName,
			&t.DetectionID, &t.Title, &t.Description,
			&t.Priority, &t.Status, &t.AssignedTo, &t.DueDate,
			&t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
		}
		tasks = append(tasks, t)
	}

	return c.JSON(fiber.Map{"success": true, "data": tasks})
}

func (h *Handler) Create(c *fiber.Ctx) error {
	companyID := c.Locals("company_id").(string)

	var req CreateTaskRequest
	if err := c.BodyParser(&req); err != nil || req.Title == "" || req.BranchID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Title and BranchID are required"})
	}

	if req.Priority == "" {
		req.Priority = "medium"
	}

	var id string
	err := h.db.QueryRow(c.Context(), `
		INSERT INTO tasks (company_id, branch_id, detection_id, title, description, priority, assigned_to)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, companyID, req.BranchID, req.DetectionID, req.Title, req.Description, req.Priority, req.AssignedTo).Scan(&id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": fiber.Map{"id": id}})
}

func (h *Handler) UpdateStatus(c *fiber.Ctx) error {
	id := c.Params("id")
	companyID := c.Locals("company_id").(string)

	var body struct {
		Status string `json:"status"`
	}
	if err := c.BodyParser(&body); err != nil || body.Status == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "error": "Status is required"})
	}

	_, err := h.db.Exec(c.Context(), `
		UPDATE tasks SET status = $1, updated_at = NOW()
		WHERE id = $2 AND company_id = $3
	`, body.Status, id, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Task status updated"})
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	companyID := c.Locals("company_id").(string)

	_, err := h.db.Exec(c.Context(), `
		DELETE FROM tasks WHERE id = $1 AND company_id = $2
	`, id, companyID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Task deleted"})
}
