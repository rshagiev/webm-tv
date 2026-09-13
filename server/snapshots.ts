import { createHash } from "node:crypto";

export type Snapshot<T> = {
  value: T;
  body: string;
  etag: string;
  expires: number;
};
/** Cache the computed value AND its wire representation, not a per-viewer object. */
export class Snapshots {
  private items = new Map<string, Snapshot<unknown>>();
  private bytes = 0;
  builds = 0;
  hits = 0;
  constructor(
    private maxBytes = 8 * 1024 * 1024,
    private maxEntries = 128,
    private ttl = 60_000,
  ) {}
  get<T>(
    key: string,
    create: () => T,
    now = Date.now(),
    freshness?: (value: T) => number,
  ): Snapshot<T> {
    const old = this.items.get(key);
    if (old && old.expires > now) {
      this.hits++;
      this.items.delete(key);
      this.items.set(key, old);
      return old as Snapshot<T>;
    }
    this.remove(key);
    const value = create();
    const body = JSON.stringify(value);
    const item = {
      value,
      body,
      etag: '"' + createHash("sha256").update(body).digest("base64url") + '"',
      expires: now + (freshness?.(value) ?? this.ttl),
    };
    this.builds++;
    const size = Buffer.byteLength(body);
    if (size <= this.maxBytes) {
      while (
        this.items.size >= this.maxEntries ||
        this.bytes + size > this.maxBytes
      )
        this.remove(this.items.keys().next().value!);
      this.items.set(key, item);
      this.bytes += size;
    }
    return item;
  }
  private remove(key: string) {
    const old = this.items.get(key);
    if (old) {
      this.bytes -= Buffer.byteLength(old.body);
      this.items.delete(key);
    }
  }
  get size() {
    return this.items.size;
  }
  get byteSize() {
    return this.bytes;
  }
}
