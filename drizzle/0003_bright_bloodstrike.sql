CREATE TABLE `page_access` (
	`page_url` text PRIMARY KEY NOT NULL,
	`allowed_domain` text NOT NULL,
	`owner_zero_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
