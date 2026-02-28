CREATE TABLE `bingo_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`event_id` int,
	`owner_id` int,
	`approved` boolean NOT NULL DEFAULT false,
	`blob` json,
	CONSTRAINT `bingo_cards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`owner_id` int,
	`description` text,
	`grid_size` varchar(255) NOT NULL DEFAULT '3',
	`prompts` text NOT NULL,
	`blob` json,
	CONSTRAINT `events_id` PRIMARY KEY(`id`),
	CONSTRAINT `events_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `bingo_cards` ADD CONSTRAINT `bingo_cards_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bingo_cards` ADD CONSTRAINT `bingo_cards_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;