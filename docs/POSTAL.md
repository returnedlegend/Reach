# Postal setup retired

Postal and SMTP transports have been removed from Reach. Do not use the
configuration or endpoint instructions in older Postal materials. Current
production setup, including the preserved local preview workflow, is documented
in [Resend email setup](RESEND.md).

Existing SQLite mail history with `provider='postal'` remains inert and is not
resent. Back up the database before upgrading; the application performs its
idempotent schema migration when the mail store initializes.
