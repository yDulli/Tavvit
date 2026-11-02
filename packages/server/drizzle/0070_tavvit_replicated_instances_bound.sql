-- A list of other instances that the route could never have stored (not JSON, not a list, more
-- than its 20 entries or larger than 20 entries of the longest fields) goes back to empty. A list
-- the app wrote stays as it is; what it carries beyond a name and an origin is dropped when read.
UPDATE `users` SET `replicated_instances` = '[]'
WHERE `replicated_instances` IS NOT NULL AND `replicated_instances` != '[]' AND (CASE
  WHEN length(`replicated_instances`) > 32768 THEN 1
  WHEN json_valid(`replicated_instances`) = 0 THEN 1
  WHEN json_type(`replicated_instances`) != 'array' THEN 1
  WHEN json_array_length(`replicated_instances`) > 20 THEN 1
  ELSE 0
END) = 1;
