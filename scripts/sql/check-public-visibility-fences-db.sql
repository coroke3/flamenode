SELECT entity_type, entity_id, fence_token, state, blocked_at, updated_at
FROM public_visibility_fences
WHERE entity_type = 'video';
