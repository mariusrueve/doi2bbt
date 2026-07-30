CREATE TABLE `rate_limits` (
	`client_hash` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`client_hash`, `window_start`)
);
