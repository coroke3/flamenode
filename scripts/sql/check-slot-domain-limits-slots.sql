SELECT id, event_id, reservation_group_id, reserved_by_user_id,
       x_user_id, display_name, status, video_id
FROM slots
WHERE reservation_group_id IS NOT NULL
   OR status IN ('reserved', 'submitted');
