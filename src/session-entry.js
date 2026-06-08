'use strict';

function createEntryId() {
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeEntry(event, previousEntryId) {
  const entryId = event.entryId || event.id || createEntryId();
  return Object.assign({}, event, {
    entryId,
    parentEntryId:
      event.parentEntryId !== undefined
        ? event.parentEntryId
        : previousEntryId || null,
    leaf: event.leaf !== undefined ? Boolean(event.leaf) : true,
  });
}

function normalizeEntries(events) {
  let previousEntryId = null;
  return (events || []).map((event) => {
    const normalized = normalizeEntry(event, previousEntryId);
    previousEntryId = normalized.entryId;
    return normalized;
  });
}

function latestEntryId(events) {
  const items = events || [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].entryId) return items[index].entryId;
  }
  return null;
}

function entriesUntil(events, entryId) {
  if (!entryId) return (events || []).slice();
  const items = events || [];
  const index = items.findIndex((event) => event.entryId === entryId || event.id === entryId);
  if (index < 0) throw new Error(`Session entry not found: ${entryId}`);
  return items.slice(0, index + 1);
}

module.exports = {
  createEntryId,
  entriesUntil,
  latestEntryId,
  normalizeEntries,
};
