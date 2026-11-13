// Membership/invitation IDs combine a generation, operation and account UUID.
// A membership ID is about140 characters; the journal and push handoff must
// agree on a bounded size rather than accepting an event that cannot drain.
export const MAX_REALTIME_EVENT_ID_LENGTH = 256;
