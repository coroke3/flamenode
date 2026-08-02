WITH owner_issues AS (
  SELECT
    es.event_id,
    es.id AS staff_id,
    es.x_user_id,
    e.title AS event_title
  FROM event_staff AS es
  JOIN events AS e ON e.id = es.event_id
  LEFT JOIN x_users AS xu ON xu.id = es.x_user_id
  WHERE es.permission_preset = 'owner'
    AND (
      xu.id IS NULL
      OR xu.approval_status <> 'approved'
      OR NOT EXISTS (
        SELECT 1
        FROM x_user_account_links AS link
        INNER JOIN x_users AS link_xu ON link_xu.id = link.x_user_id
        WHERE link.x_user_id = es.x_user_id
          AND link.link_role = 'owner'
          AND link_xu.approval_status = 'approved'
      )
    )
)
SELECT
  'owner_inoperable' AS problem_type,
  event_id,
  event_title,
  staff_id,
  x_user_id
FROM owner_issues
ORDER BY event_id, staff_id;
