WITH issues AS (
  SELECT
    'owner_missing' AS problem_type,
    e.id AS event_id,
    e.title AS event_title,
    NULL AS staff_id,
    NULL AS x_user_id
  FROM events e
  WHERE NOT EXISTS (
    SELECT 1
    FROM event_staff es
    WHERE es.event_id = e.id
      AND es.permission_preset = 'owner'
  )

  UNION ALL

  SELECT
    'event_missing',
    es.event_id,
    NULL,
    es.id,
    es.x_user_id
  FROM event_staff es
  LEFT JOIN events e ON e.id = es.event_id
  WHERE e.id IS NULL

  UNION ALL

  SELECT
    'x_user_missing',
    es.event_id,
    e.title,
    es.id,
    es.x_user_id
  FROM event_staff es
  JOIN events e ON e.id = es.event_id
  LEFT JOIN x_users xu ON xu.id = es.x_user_id
  WHERE xu.id IS NULL

  UNION ALL

  SELECT
    'duplicate_x_user',
    es.event_id,
    e.title,
    GROUP_CONCAT(es.id),
    es.x_user_id
  FROM event_staff es
  JOIN events e ON e.id = es.event_id
  GROUP BY es.event_id, es.x_user_id
  HAVING COUNT(*) > 1
)
SELECT
  problem_type,
  event_id,
  event_title,
  staff_id,
  x_user_id
FROM issues
ORDER BY problem_type, event_id, staff_id;
