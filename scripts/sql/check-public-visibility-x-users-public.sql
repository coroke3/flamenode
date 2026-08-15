SELECT id, approval_status
FROM x_users
WHERE approval_status IN ('approved', 'pending', 'imported');
