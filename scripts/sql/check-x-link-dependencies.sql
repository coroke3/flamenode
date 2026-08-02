WITH risky_links AS (
  SELECT
    link.x_user_id,
    link.auth_user_id,
    link.link_role,
    CASE
      WHEN link.link_role = 'owner'
        AND EXISTS (
          SELECT 1
          FROM event_staff AS es
          INNER JOIN x_users AS xu ON xu.id = es.x_user_id
          WHERE es.x_user_id = link.x_user_id
            AND es.permission_preset = 'owner'
            AND xu.approval_status = 'approved'
            AND (
              SELECT COUNT(*)
              FROM x_user_account_links AS owner_link
              INNER JOIN x_users AS owner_xu ON owner_xu.id = owner_link.x_user_id
              WHERE owner_link.x_user_id = es.x_user_id
                AND owner_link.link_role = 'owner'
                AND owner_xu.approval_status = 'approved'
            ) <= 1
        ) THEN 'event_owner_inoperable_if_deleted'
      WHEN EXISTS (
        SELECT 1
        FROM videos AS v
        WHERE v.creator_x_user_id = link.x_user_id
          AND NOT EXISTS (
            SELECT 1
            FROM x_user_account_links AS alt
            INNER JOIN x_users AS alt_xu ON alt_xu.id = alt.x_user_id
            WHERE alt.auth_user_id = link.auth_user_id
              AND alt.x_user_id <> link.x_user_id
              AND alt_xu.approval_status = 'approved'
          )
      ) THEN 'creator_assets_without_alternative'
      WHEN EXISTS (
        SELECT 1
        FROM slots AS s
        WHERE s.x_user_id = link.x_user_id
          AND s.reserved_by_user_id = link.auth_user_id
          AND s.status IN ('reserved', 'submitted')
      ) THEN 'reserved_or_submitted_slot'
      WHEN EXISTS (
        SELECT 1
        FROM x_identity_requests AS req
        WHERE req.status = 'pending'
          AND req.request_type IN ('merge', 'revert_merge')
          AND (
            req.requested_by_auth_user_id = link.auth_user_id
            OR req.source_x_user_id = link.x_user_id
            OR req.target_x_user_id = link.x_user_id
          )
      ) THEN 'pending_merge_request'
      ELSE NULL
    END AS problem_type
  FROM x_user_account_links AS link
)
SELECT
  problem_type,
  x_user_id,
  auth_user_id,
  link_role
FROM risky_links
WHERE problem_type IS NOT NULL
ORDER BY problem_type, x_user_id, auth_user_id;
