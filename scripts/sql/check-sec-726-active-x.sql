SELECT COUNT(*) AS unsafe_selected_legacy_ids
FROM "user"
WHERE active_x_user_id IS NOT NULL
  AND (
    typeof(active_x_user_id) <> 'text'
    OR instr(active_x_user_id, char(0)) > 0
    OR length(active_x_user_id) > 128
    OR length(CAST(active_x_user_id AS BLOB)) > 512
  );
