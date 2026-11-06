CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,           -- secret token kept in the player's browser
  name        TEXT NOT NULL,
  max_level   INTEGER NOT NULL DEFAULT 0, -- highest level cleared
  total_score INTEGER NOT NULL DEFAULT 0, -- sum of best score per level
  total_stars INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_rank ON players (max_level DESC, total_score DESC);

CREATE TABLE IF NOT EXISTS level_scores (
  player_id      TEXT NOT NULL,
  level          INTEGER NOT NULL,
  best_score     INTEGER NOT NULL,
  best_stars     INTEGER NOT NULL,
  best_time_left INTEGER NOT NULL,
  clears         INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (player_id, level)
);
