import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { Emitter } from "@zcode/rpc";
import type {
  PortForwardCreateRequest,
  PortForwardEvent,
  PortForwardRecord,
  PortForwardStatus,
} from "@zcode/shared";
import {
  PORT_FORWARD_LABEL_MAX_LENGTH,
  PORT_FORWARD_MAX_CONNECTIONS_PER_TUNNEL,
  PORT_FORWARD_MAX_TUNNELS_PER_SESSION,
  validatePortForwardCreateRequest,
} from "@zcode/shared";
import type { IRemoteBackend } from "@zcode/server/remote/backend.js";

interface ManagedForward {
  record: PortForwardRecord;
  server: Server;
  channels: Set<Duplex>;
}

export class PortForwardManager {
  private readonly forwards = new Map<string, ManagedForward>();
  private readonly eventEmitters = new Map<string, Emitter<PortForwardEvent>>();
  private disposed = false;
  private readonly disconnectSubscription?: { dispose(): void };

  constructor(private readonly backend: IRemoteBackend) {
    this.disconnectSubscription = backend.onDidDisconnect?.(() => {
      void this.closeAll("closed");
    });
  }

  onDynamicEvent(remoteSessionId: string) {
    let emitter = this.eventEmitters.get(remoteSessionId);
    if (!emitter) {
      emitter = new Emitter<PortForwardEvent>();
      this.eventEmitters.set(remoteSessionId, emitter);
    }
    return emitter.event;
  }

  async list(request: { remoteSessionId: string }): Promise<PortForwardRecord[]> {
    return [...this.forwards.values()]
      .filter(({ record }) => record.remoteSessionId === request.remoteSessionId)
      .map(({ record }) => ({ ...record }));
  }

  async create(request: PortForwardCreateRequest): Promise<PortForwardRecord> {
    if (this.disposed) throw new Error("Port forwarding manager is disposed");
    const validationError = validatePortForwardCreateRequest(request);
    if (validationError) throw new Error(validationError);
    const sessionCount = [...this.forwards.values()].filter(
      ({ record }) => record.remoteSessionId === request.remoteSessionId,
    ).length;
    if (sessionCount >= PORT_FORWARD_MAX_TUNNELS_PER_SESSION) {
      throw new Error(`At most ${PORT_FORWARD_MAX_TUNNELS_PER_SESSION} port forwards are allowed`);
    }
    const label = request.label?.trim() || `127.0.0.1:${request.remotePort}`;
    if (label.length > PORT_FORWARD_LABEL_MAX_LENGTH) {
      throw new Error(`label must be at most ${PORT_FORWARD_LABEL_MAX_LENGTH} characters`);
    }
    if (!this.backend.forwardOut) {
      throw new Error("SSH port forwarding is only available for SSH remote sessions");
    }

    let managed!: ManagedForward;
    const server = createServer((socket) => {
      void this.acceptConnection(managed, socket);
    });
    const record: PortForwardRecord = {
      id: randomUUID(),
      remoteSessionId: request.remoteSessionId,
      label,
      localPort: request.localPort ?? 0,
      remoteHost: "127.0.0.1",
      remotePort: request.remotePort,
      status: "connecting",
      createdAt: Date.now(),
    };
    managed = { record, server, channels: new Set() };
    this.forwards.set(record.id, managed);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Unable to resolve local forwarding port"));
            return;
          }
          record.localPort = address.port;
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(request.localPort ?? 0, "127.0.0.1");
      });
      this.transition(managed, "active");
      this.emit(request.remoteSessionId, { type: "created", record: { ...record } });
      return { ...record };
    } catch (error) {
      this.forwards.delete(record.id);
      if (server.listening) {
        server.close();
      }
      this.transitionRecord(
        record,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
  async remove(request: { remoteSessionId: string; id: string }): Promise<void> {
    const managed = this.forwards.get(request.id);
    if (!managed || managed.record.remoteSessionId !== request.remoteSessionId) return;
    this.forwards.delete(request.id);
    await this.closeManaged(managed);
    this.emit(request.remoteSessionId, { type: "removed", id: request.id });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnectSubscription?.dispose();
    await this.closeAll("closed");
    for (const emitter of this.eventEmitters.values()) emitter.dispose();
    this.eventEmitters.clear();
  }

  private async closeAll(status: Extract<PortForwardStatus, "closed">): Promise<void> {
    const entries = [...this.forwards.values()];
    this.forwards.clear();
    await Promise.all(
      entries.map(async (managed) => {
        this.transition(managed, status);
        await this.closeManaged(managed);
      }),
    );
  }

  private async closeManaged(managed: ManagedForward): Promise<void> {
    for (const channel of managed.channels) channel.destroy();
    managed.channels.clear();
    if (managed.server.listening) {
      await new Promise<void>((resolve) => managed.server.close(() => resolve()));
    }
  }

  private async acceptConnection(managed: ManagedForward, socket: Socket): Promise<void> {
    if (managed.channels.size >= PORT_FORWARD_MAX_CONNECTIONS_PER_TUNNEL || this.disposed) {
      socket.destroy();
      return;
    }
    try {
      const channel = await this.backend.forwardOut!("127.0.0.1", managed.record.remotePort);
      managed.channels.add(channel);
      socket.once("close", () => {
        managed.channels.delete(channel);
        channel.destroy();
      });
      channel.once("close", () => {
        managed.channels.delete(channel);
        socket.destroy();
      });
      socket.pipe(channel).pipe(socket);
    } catch (error) {
      socket.destroy();
      this.transition(managed, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  private transition(managed: ManagedForward, status: PortForwardStatus, error?: string): void {
    this.transitionRecord(managed.record, status, error);
    this.emit(managed.record.remoteSessionId, {
      type: "status-changed",
      id: managed.record.id,
      status,
      ...(error ? { error } : {}),
    });
  }

  private transitionRecord(
    record: PortForwardRecord,
    status: PortForwardStatus,
    error?: string,
  ): void {
    record.status = status;
    if (error) record.error = error;
    else delete record.error;
  }

  private emit(remoteSessionId: string, event: PortForwardEvent): void {
    this.eventEmitters.get(remoteSessionId)?.fire(event);
  }
}
