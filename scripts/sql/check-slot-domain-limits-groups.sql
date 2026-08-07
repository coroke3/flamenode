SELECT reservation_group_id, event_id, COUNT(*) AS slot_count
FROM slots
WHERE reservation_group_id IS NOT NULL
GROUP BY reservation_group_id, event_id
HAVING COUNT(*) > 3;
