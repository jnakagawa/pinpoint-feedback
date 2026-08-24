DROP INDEX `idx_comments_status_created_at`;--> statement-breakpoint
ALTER TABLE `comments` ADD `page_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `page_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `zero_user_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_comments_page_status_created_at` ON `comments` (`page_url`,`status`,`created_at`);