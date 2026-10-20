CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`actor_label` text NOT NULL,
	`source` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`params` text,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_started_at_idx` ON `audit_log` (`started_at`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_log_status_idx` ON `audit_log` (`status`);