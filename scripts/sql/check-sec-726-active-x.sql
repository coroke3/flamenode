SELECT COUNT(*) AS unsafe_selected_legacy_ids
FROM "user"
WHERE active_x_user_id IS NOT NULL
  AND CASE
    WHEN typeof(active_x_user_id) <> 'text'
      OR instr(active_x_user_id, char(0)) > 0
      OR length(active_x_user_id) > 128
      OR length(CAST(active_x_user_id AS BLOB)) > 512
    THEN 1
    ELSE (
      /* SQLite length(TEXT) can undercount malformed UTF-8. Count the codepoints
         D1's replacement decoder returns, only after the storage checks above.
         A valid but incomplete prefix emits one replacement. Its first invalid
         continuation byte is processed again on the next step. Keep BOMs. */
      WITH RECURSIVE
        raw(bytes, byte_length) AS MATERIALIZED (
          SELECT CAST(active_x_user_id AS BLOB),
                 length(CAST(active_x_user_id AS BLOB))
        ),
        decoded(byte_index, codepoints) AS (
          SELECT 1, 0
          UNION ALL
          SELECT byte_index + CASE
            WHEN substr(bytes, byte_index, 1) BETWEEN X'C2' AND X'DF'
              AND substr(bytes, byte_index + 1, 1) BETWEEN X'80' AND X'BF'
            THEN 2
            WHEN substr(bytes, byte_index, 1) BETWEEN X'E0' AND X'EF'
              AND CASE substr(bytes, byte_index, 1)
                WHEN X'E0' THEN substr(bytes, byte_index + 1, 1) BETWEEN X'A0' AND X'BF'
                WHEN X'ED' THEN substr(bytes, byte_index + 1, 1) BETWEEN X'80' AND X'9F'
                ELSE substr(bytes, byte_index + 1, 1) BETWEEN X'80' AND X'BF'
              END
            THEN CASE
              WHEN substr(bytes, byte_index + 2, 1) BETWEEN X'80' AND X'BF' THEN 3
              ELSE 2
            END
            WHEN substr(bytes, byte_index, 1) BETWEEN X'F0' AND X'F4'
              AND CASE substr(bytes, byte_index, 1)
                WHEN X'F0' THEN substr(bytes, byte_index + 1, 1) BETWEEN X'90' AND X'BF'
                WHEN X'F4' THEN substr(bytes, byte_index + 1, 1) BETWEEN X'80' AND X'8F'
                ELSE substr(bytes, byte_index + 1, 1) BETWEEN X'80' AND X'BF'
              END
            THEN CASE
              WHEN substr(bytes, byte_index + 2, 1) NOT BETWEEN X'80' AND X'BF' THEN 2
              WHEN substr(bytes, byte_index + 3, 1) BETWEEN X'80' AND X'BF' THEN 4
              ELSE 3
            END
            ELSE 1
          END,
          codepoints + 1
          FROM decoded, raw
          WHERE byte_index <= byte_length AND codepoints < 129
        )
      SELECT MAX(codepoints) > 128 FROM decoded
    )
  END;
