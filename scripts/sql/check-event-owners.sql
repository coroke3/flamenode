WITH issues AS (
  SELECT
    'owner_missing' AS problem_type,
    e.id AS event_id,
    e.title AS event_title,
    NULL AS staff_id,
    NULL AS user_id,
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
    'subject_missing',
    e.id,
    e.title,
    es.id,
    es.user_id,
    es.x_user_id
  FROM event_staff es
  LEFT JOIN events e
    ON e.id = es.event_id
  WHERE es.user_id IS NULL
    AND es.x_user_id IS NULL

  UNION ALL

  SELECT
    'event_missing',
    es.event_id,
    NULL,
    es.id,
    es.user_id,
    es.x_user_id
  FROM event_staff es
  LEFT JOIN events e
    ON e.id = es.event_id
  WHERE e.id IS NULL

  UNION ALL

  SELECT
    'user_missing',
    es.event_id,
    e.title,
    es.id,
    es.user_id,
    es.x_user_id
  FROM event_staff es
  JOIN events e
    ON e.id = es.event_id
  LEFT JOIN "user" u
    ON u.id = es.user_id
  WHERE es.user_id IS NOT NULL
    AND u.id IS NULL

  UNION ALL

  SELECT
    'x_user_missing',
    es.event_id,
    e.title,
    es.id,
    es.user_id,
    es.x_user_id
  FROM event_staff es
  JOIN events e
    ON e.id = es.event_id
  LEFT JOIN x_users xu
    ON xu.id = es.x_user_id
  WHERE es.x_user_id IS NOT NULL
    AND xu.id IS NULL

  UNION ALL

  SELECT
    'duplicate_user',
    es.event_id,
    e.title,
    GROUP_CONCAT(es.id),
    es.user_id,
    NULL
  FROM event_staff es
  JOIN events e
    ON e.id = es.event_id
  WHERE es.user_id IS NOT NULL
  GROUP BY es.event_id, es.user_id
  HAVING COUNT(*) > 1

  UNION ALL

  SELECT
    'duplicate_x_user',
    es.event_id,
    e.title,
    GROUP_CONCAT(es.id),
    NULL,
    es.x_user_id
  FROM event_staff es
  JOIN events e
    ON e.id = es.event_id
  WHERE es.x_user_id IS NOT NULL
  GROUP BY es.event_id, es.x_user_id
  HAVING COUNT(*) > 1

  UNION ALL

  SELECT
    'role_preset_mismatch',
    es.event_id,
    e.title,
    es.id,
    es.user_id,
    es.x_user_id
  FROM event_staff es
  JOIN events e
    ON e.id = es.event_id
  WHERE (
      es.permission_preset = 'owner'
      AND es.role <> 'representative'
    )
    OR (
      es.permission_preset = 'manager'
      AND es.role <> 'editor'
    )
    OR (
      es.permission_preset NOT IN (
        'owner',
        'manager'
      )
      AND es.role <> 'staff'
    )
)
SELECT
  problem_type,
  event_id,
  event_title,
  staff_id,
  user_id,
  x_user_id
FROM issues
ORDER BY
  problem_type,
  event_id,
  staff_id;
