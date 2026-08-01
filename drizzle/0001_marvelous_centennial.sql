CREATE TABLE `room_rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `room_rate_limits_expires_at_idx` ON `room_rate_limits` (`expires_at`);