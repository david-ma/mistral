CREATE TABLE `image_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`album_key` varchar(255),
	`image_key` varchar(255) NOT NULL,
	`note` text NOT NULL,
	CONSTRAINT `image_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `albums` ADD `album_key` varchar(255);--> statement-breakpoint
ALTER TABLE `albums` ADD `url_name` varchar(255);--> statement-breakpoint
ALTER TABLE `albums` ADD `uri` varchar(255);--> statement-breakpoint
ALTER TABLE `albums` ADD `web_uri` varchar(255);--> statement-breakpoint
ALTER TABLE `albums` ADD `date_added` varchar(255);--> statement-breakpoint
ALTER TABLE `albums` ADD `date_modified` varchar(255);--> statement-breakpoint
ALTER TABLE `images` ADD `album_key` varchar(255);