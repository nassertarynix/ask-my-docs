// The few Cloudflare Workers types the relay uses. (Declared here so the project needs no extra type package.)
interface WebSocket {
  accept(): void;
}
interface ResponseInit {
  webSocket?: WebSocket;
}
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
interface DurableObjectId {
  toString(): string;
}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectState {
  readonly id: DurableObjectId;
}
