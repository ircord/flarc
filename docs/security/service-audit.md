# Service audit delivery

Service mutation audit records use immutable authenticated actor IDs when available, a fixed action name, a hashed resource target, and an explicit allowed, denied, or error outcome. Auditing is disabled by default and is enabled with `AUDIT_LOG_ENABLED=true`; command arguments, passwords, credential tokens, channel keys, and message contents are not recorded.

Audit writes are best effort. The service operation and its audit record cross Durable Objects and are not a transaction: an audit write can fail after an operation succeeds, and a multi-channel HistServ forget can partly apply before a later channel operation fails. An error record describes that failure when the separate audit write succeeds; it does not imply rollback or guarantee a record during provider failure.
