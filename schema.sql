-- Schema for Personal Telegram Drive using MariaDB/MySQL

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(36) PRIMARY KEY,
  `username` VARCHAR(50) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `telegram_chat_id` BIGINT UNIQUE DEFAULT NULL,
  `telegram_link_token` VARCHAR(255) UNIQUE DEFAULT NULL,
  `telegram_link_expires` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `files` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `extension` VARCHAR(50) DEFAULT NULL,
  `mime_type` VARCHAR(100) DEFAULT NULL,
  `size` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `telegram_file_id` VARCHAR(255) NOT NULL,
  `telegram_unique_id` VARCHAR(255) NOT NULL,
  `telegram_message_id` INTEGER DEFAULT NULL,
  `telegram_chat_id` BIGINT DEFAULT NULL,
  `source` VARCHAR(20) NOT NULL, -- 'web', 'telegram', 'api', 'import'
  `folder` VARCHAR(255) NOT NULL DEFAULT '/',
  `tags` JSON DEFAULT NULL, -- stores JSON array: e.g. ["Work", "Invoice"]
  `is_trashed` BOOLEAN NOT NULL DEFAULT FALSE,
  `user_id` VARCHAR(36) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_files_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS `idx_files_user` ON `files` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_files_folder` ON `files` (`user_id`, `folder`);
CREATE INDEX IF NOT EXISTS `idx_files_telegram` ON `files` (`telegram_file_id`);
CREATE INDEX IF NOT EXISTS `idx_files_sha256` ON `files` (`sha256`);
