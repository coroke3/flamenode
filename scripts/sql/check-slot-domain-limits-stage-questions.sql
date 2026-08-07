SELECT event_id, COUNT(*) AS question_count
FROM event_custom_questions
WHERE question_key = 'stage_permission'
   OR question_key LIKE 'stage_permission_%'
GROUP BY event_id
HAVING COUNT(*) > 4;
