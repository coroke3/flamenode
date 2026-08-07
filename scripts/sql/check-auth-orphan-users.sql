SELECT
  u.id,
  u.name,
  u.email,
  u.discord_id,
  u.created_at
FROM "user" AS u
LEFT JOIN account AS a
  ON a.userId = u.id
 AND a.provider = 'discord'
WHERE a.userId IS NULL
ORDER BY u.created_at DESC;
