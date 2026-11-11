import type { EventType, RealtimeEvent } from "../../schemas/events";
import { logger } from "../../utils/logger";

export type EventHandler = (event: RealtimeEvent) => void | Promise<void>;

export class DomainEventEmitter {
  private handlers = new Map<EventType | "*", Set<EventHandler>>();
  private recentEvents: RealtimeEvent[] = [];
  private maxHistory = 500;

  public on(type: EventType | "*", handler: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  public async emit(
    type: EventType,
    data: Record<string, any>,
    meta?: {
      channelId?: string;
      messageId?: string;
      senderId?: string;
      sequence?: number;
    },
  ): Promise<RealtimeEvent> {
    const event: RealtimeEvent = {
      type,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      channelId: meta?.channelId,
      messageId: meta?.messageId,
      senderId: meta?.senderId,
      sequence: meta?.sequence,
      data,
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxHistory) {
      this.recentEvents.shift();
    }

    logger.debug(`DomainEvent: ${type}`, { eventId: event.eventId, channel: event.channelId });

    const specificHandlers = this.handlers.get(type);
    const wildcardHandlers = this.handlers.get("*");

    const promises: Promise<void>[] = [];
    if (specificHandlers) {
      for (const h of specificHandlers) {
        try {
          const res = h(event);
          if (res instanceof Promise) promises.push(res);
        } catch (err: any) {
          logger.error(`Error in event handler for ${type}: ${err.message}`);
        }
      }
    }
    if (wildcardHandlers) {
      for (const h of wildcardHandlers) {
        try {
          const res = h(event);
          if (res instanceof Promise) promises.push(res);
        } catch (err: any) {
          logger.error(`Error in wildcard event handler: ${err.message}`);
        }
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }

    return event;
  }

  public getEventsSince(sinceTimestamp: string, channelId?: string): RealtimeEvent[] {
    const sinceTime = Date.parse(sinceTimestamp) || 0;
    return this.recentEvents.filter((e) => {
      const eTime = Date.parse(e.timestamp) || 0;
      if (eTime <= sinceTime) return false;
      if (channelId && e.channelId && e.channelId !== channelId) return false;
      return true;
    });
  }
}

export const domainEvents = new DomainEventEmitter();
