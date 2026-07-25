CREATE TABLE IF NOT EXISTS borg_replay_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  replayKey VARCHAR(200) NOT NULL,
  tokTime BIGINT NOT NULL,
  borgHUID VARCHAR(100) NOT NULL,
  service VARCHAR(100),
  request VARCHAR(100),
  borgToken TEXT NOT NULL,            -- full JSON borgToken
  borgTokenSig VARCHAR(200) NOT NULL, -- j.sesSig
  signedPayload TEXT NOT NULL,        -- j.sesTok

  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_replay (replayKey),

  -- Indexes for performance
  KEY idx_borgHUID_tokTime (borgHUID, tokTime DESC),
  KEY idx_tokTime (tokTime DESC)
);
