-- Queries to check the acceptance tests against the live database (Supabase SQL editor or psql).
-- Replace 123456789 with the test chat id.

-- Latest conversation, both sides, with routing (T1–T5, T9, T10, T12–T14)
SELECT m.id, m.created_at AT TIME ZONE 'Africa/Kampala' AS eat, m.direction, m.kind, m.status, m.attempts,
       m.reply_to_id, left(m.text, 80) AS text, r.route, r.confidence, r.status AS classifier, r.entities
FROM messages m
LEFT JOIN routing_history r ON r.inbound_message_id = m.id
WHERE m.chat_id = 123456789
ORDER BY m.id DESC
LIMIT 30;

-- T6 / T11: one in row, one out row, one routing row per update_id (expect 1 | 1 | 1)
SELECT i.telegram_update_id,
       count(DISTINCT i.id) AS in_rows,
       count(DISTINCT o.id) AS out_rows,
       count(DISTINCT r.id) AS routing_rows
FROM messages i
LEFT JOIN messages o ON o.reply_to_id = i.id
LEFT JOIN routing_history r ON r.inbound_message_id = i.id
WHERE i.direction = 'in'
GROUP BY i.telegram_update_id
ORDER BY i.telegram_update_id DESC
LIMIT 10;

-- No inbound message ever got two replies (expect 0 rows; the UNIQUE constraint makes it impossible)
SELECT reply_to_id, count(*) FROM messages WHERE direction = 'out' AND reply_to_id IS NOT NULL
GROUP BY reply_to_id HAVING count(*) > 1;

-- T7: error_log rows and failed messages
SELECT e.created_at AT TIME ZONE 'Africa/Kampala' AS eat, e.workflow, e.node, e.inbound_message_id, left(e.error, 120) AS error, m.status
FROM error_log e LEFT JOIN messages m ON m.id = e.inbound_message_id
ORDER BY e.id DESC LIMIT 10;

-- T8: ignored non-text / edited messages and their text-only reply
SELECT i.id, i.text, i.status, o.text AS reply, o.kind
FROM messages i LEFT JOIN messages o ON o.reply_to_id = i.id
WHERE i.status = 'ignored' ORDER BY i.id DESC LIMIT 5;

-- Sessions and daily records (T2/T3, T9/T10, T14: record_date is the Kampala date)
SELECT * FROM sessions;
SELECT chat_id, record_date, sales_ugx, expenses_ugx, profit_ugx, updated_at AT TIME ZONE 'Africa/Kampala' AS updated_eat
FROM daily_records ORDER BY updated_at DESC LIMIT 10;
SELECT (now() AT TIME ZONE 'Africa/Kampala')::date AS kampala_today, now() AS server_now;

-- Chats flagged for a human by the Care brain
SELECT chat_id, first_name, language, business_type, needs_human FROM users WHERE needs_human;

-- Evals: route mix, confidence and classifier status
SELECT route, status, count(*), round(avg(confidence), 3) AS avg_conf, round(avg(latency_ms)) AS avg_ms
FROM routing_history GROUP BY route, status ORDER BY count(*) DESC;
