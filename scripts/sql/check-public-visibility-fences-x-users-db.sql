SELECT entity_type, entity_id, fence_token, state, reason, blocked_at, updated_at
FROM public_visibility_fences
WHERE entity_type = 'x_user';
