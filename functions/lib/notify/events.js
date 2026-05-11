// functions/lib/notify/events.js
// PROVISIONING_FLOW.md §2.1 — provisioning_events schema

/**
 * Insert a provisioning_events row.
 * event_data is an arbitrary JSON-serialisable object; stored as TEXT.
 */
export async function recordProvisioningEvent(db, {
  storeRef,
  eventType,
  eventData = null,
  sourceIp = null,
}) {
  const eventId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO provisioning_events
         (event_id, store_ref, event_type, event_data, source_ip)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      eventId,
      storeRef,
      eventType,
      eventData !== null ? JSON.stringify(eventData) : null,
      sourceIp,
    )
    .run();
  return eventId;
}
