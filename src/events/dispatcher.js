const crypto = require("node:crypto");
const { Event } = require("../models");
const { isMongoReady } = require("../db");

class EventDispatcher {
  constructor() {
    this.listeners = new Set();
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish({ type, sessionId, data, eventId = `evt_${crypto.randomUUID()}` }) {
    const event = { eventId, type, sessionId, timestamp: new Date().toISOString(), data };
    if (isMongoReady()) {
      try { await Event.create({ eventId, sessionId, type, payload: event }); } catch (error) { if (error.code !== 11000) throw error; }
    }
    await Promise.allSettled([...this.listeners].map((listener) => listener(event)));
    return event;
  }
}

module.exports = { EventDispatcher, eventDispatcher: new EventDispatcher() };
