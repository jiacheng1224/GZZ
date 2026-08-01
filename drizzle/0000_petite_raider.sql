CREATE TABLE `game_rooms` (
	`room_id` text PRIMARY KEY NOT NULL,
	`invite_code` text NOT NULL,
	`state_json` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_rooms_invite_code_unique` ON `game_rooms` (`invite_code`);--> statement-breakpoint
CREATE INDEX `game_rooms_status_idx` ON `game_rooms` (`status`);--> statement-breakpoint
CREATE INDEX `game_rooms_expires_at_idx` ON `game_rooms` (`expires_at`);