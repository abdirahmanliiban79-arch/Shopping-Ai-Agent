import { EventEmitter } from "events";
import type { ProgressEvent } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var _searchBus: EventEmitter | undefined;
  // eslint-disable-next-line no-var
  var _searchEvents: Map<string, ProgressEvent[]> | undefined;
}

export const searchBus = (global._searchBus ??= new EventEmitter());
searchBus.setMaxListeners(100);

const eventLog = (global._searchEvents ??= new Map<string, ProgressEvent[]>());

// Auto-evict logs after 10 minutes to prevent memory leaks
const LOG_TTL_MS = 10 * 60 * 1000;

export function emitProgress(event: ProgressEvent) {
  const log = eventLog.get(event.searchId);
  if (log) log.push(event);
  searchBus.emit(event.searchId, event);
}

export function initLog(searchId: string) {
  eventLog.set(searchId, []);
  setTimeout(() => {
    eventLog.delete(searchId);
  }, LOG_TTL_MS);
}

export function clearLog(searchId: string) {
  eventLog.delete(searchId);
}

export function getLog(searchId: string): ProgressEvent[] {
  return eventLog.get(searchId) ?? [];
}

export function subscribe(searchId: string, listener: (e: ProgressEvent) => void) {
  searchBus.on(searchId, listener);
  return () => searchBus.off(searchId, listener);
}