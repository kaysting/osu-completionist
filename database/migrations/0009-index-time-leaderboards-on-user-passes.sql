CREATE INDEX idx_user_passes_covering 
ON user_passes(time_passed DESC, user_id, map_id, mode);