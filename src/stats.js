export function createStats() {
  const startedAt = Date.now();

  const counters = {
    messagesReceived: 0,
    messagesDeleted: 0,
    messagesEdited: 0,
    commandsReceived: 0,
    commandsExecuted: 0,
    commandsFailed: 0,
    errors: 0,
    warns: 0,
    voiceJoins: 0,
    voiceLeaves: 0,
    voiceReconnects: 0,
    afkPings: 0,
    afkReplies: 0,
    presenceUpdates: 0,
  };

  function bump(key, delta = 1) {
    if (key in counters) counters[key] += delta;
  }

  function snapshot() {
    return {
      startedAt,
      uptimeMs: Date.now() - startedAt,
      ...counters,
    };
  }

  function reset() {
    for (const k of Object.keys(counters)) counters[k] = 0;
  }

  return { bump, snapshot, reset, counters };
}