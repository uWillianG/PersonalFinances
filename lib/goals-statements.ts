// Each mutation checks current membership inside the SQL statement. Balance
// checks and insertion share one serialized SQLite statement, avoiding a
// read-then-write withdrawal race. A UUID identifies one immutable movement.
export const GOAL_ACCESS_SQL = `((g.scope = 'personal' AND g.owner_id = (SELECT user_id FROM actor)) OR
  (g.scope = 'couple' AND EXISTS (SELECT 1 FROM couple_members viewer WHERE viewer.user_id = (SELECT user_id FROM actor) AND viewer.couple_id = g.couple_id)))`;

export const CREATE_GOAL_SQL = `WITH input AS (SELECT ? AS id, ? AS user_id, ? AS couple_id, ? AS scope, ? AS name, ? AS target_cents, ? AS target_date, ? AS archived)
INSERT INTO savings_goals (id, owner_id, couple_id, scope, name, target_cents, target_date, archived)
SELECT id, user_id, couple_id, scope, name, target_cents, target_date, archived FROM input
WHERE (scope = 'personal' AND couple_id IS NULL) OR (scope = 'couple' AND EXISTS (
  SELECT 1 FROM couple_members member WHERE member.user_id = input.user_id AND member.couple_id = input.couple_id))
RETURNING id`;

export const ADD_GOAL_MOVEMENT_SQL = `WITH actor AS (SELECT ? AS user_id),
input AS (SELECT ? AS id, ? AS goal_id, ? AS kind, ? AS amount_cents, ? AS date, ? AS note, ? AS created_at),
eligible AS (SELECT g.id, COALESCE((SELECT SUM(CASE WHEN m.kind = 'deposit' THEN m.amount_cents ELSE -m.amount_cents END) FROM goal_movements m WHERE m.goal_id = g.id), 0) AS balance
FROM savings_goals g, input i WHERE g.id = i.goal_id AND ${GOAL_ACCESS_SQL} AND (g.archived = 0 OR i.kind = 'withdrawal'))
INSERT INTO goal_movements (id, goal_id, owner_id, kind, amount_cents, date, note, created_at)
SELECT i.id, e.id, (SELECT user_id FROM actor), i.kind, i.amount_cents, i.date, i.note, i.created_at
FROM eligible e, input i WHERE e.balance + CASE WHEN i.kind = 'deposit' THEN i.amount_cents ELSE -i.amount_cents END BETWEEN 0 AND 1000000000000
ON CONFLICT(id) DO NOTHING
RETURNING id`;

export const DELETE_EMPTY_GOAL_SQL = `WITH actor AS (SELECT ? AS user_id)
DELETE FROM savings_goals AS g WHERE g.id = ? AND ${GOAL_ACCESS_SQL}
AND NOT EXISTS (SELECT 1 FROM goal_movements m WHERE m.goal_id = g.id)
RETURNING id`;
