# SSH Port Forwarding Spec

## Scope

Desktop-only, SSH-only local TCP port forwarding. Allows users to forward a remote TCP port to a local loopback port through the existing SSH connection of a remote workspace session.

```
127.0.0.1:<localPort>  →  SSH tunnel  →  <remoteHost>:<remotePort>
```

## Product Requirements

- Support multiple forwarded ports per SSH remote workspace session
- Accept `remotePort` (required) and `localPort` (optional; system picks ephemeral if omitted)
- Each tunnel has a label, status, and local/remote endpoint
- Open URL action for HTTP/HTTPS remote ports using `http://127.0.0.1:<localPort>`
- Stop, retry, and remove individual tunnels
- Auto-close all tunnels on session disconnect, dispose, or Host shutdown
- No persistence of active tunnels in MVP (in-memory only)
- Reject non-TCP, out-of-range ports (1–65535), and invalid labels
- Bind strictly to `127.0.0.1`; never `0.0.0.0` or public interfaces
- Web/mobile remote is out of scope for MVP

## State Ownership

`PortForwardManager` in the Desktop Host process is the single owner of mutable tunnel state. It is bound to a `HostRemoteConnection` (SSH backend + remote session).

```
Renderer Ports UI
  → scoped remote service command (list/create/remove)
  → Host PortForwardManager
  → SSHBackend.forwardOut + local net.Server
  → state transition
  → typed port-forward event/result
  → Renderer projection
```

The Renderer holds no authoritative tunnel state. It reads projections from the Host via the scoped service port.

## Lifecycle

1. UI sends `create` with `remoteSessionId`, `remotePort`, optional `localPort`, and `label`
2. Host validates input (port range, label, session online)
3. Manager binds a `net.Server` on `127.0.0.1:<localPort>` (or ephemeral)
4. On incoming TCP connection, opens SSH `forwardOut` to `remoteHost:remotePort` and pipes bidirectionally
5. Manager marks tunnel `active` with resolved local port
6. All operations check session generation to prevent stale results
7. Disconnect/dispose closes server and all channels idempotently, marks `closed`
8. Reconnect does NOT auto-restore tunnels in MVP

## Failure Semantics

- Local bind conflict → `failed` with `EADDRINUSE` error, no dangling listener
- Remote port refused/closed → tunnel transitions to `failed`, Host does not crash
- Client disconnect → only that SSH channel closes
- SSH disconnect → all listeners and channels close, all tunnels → `closed`
- Double dispose → idempotent, no throw, no duplicate terminal events
- Stale reconnect result → cannot mutate tunnel of a newer session generation

## Security Boundary

- Local bind is always `127.0.0.1`
- No reverse/remote forwarding in MVP
- No dynamic SOCKS
- No public network exposure
- `ssh2` and `node:net` never leak into UI or shared domain

## Migration Boundary

- MVP does not change WSL/Docker behavior
- MVP does not add mobile/web forwarding
- Desktop-only delivery contract: forwarding commands are only valid on SSH remote sessions

## Acceptance Criteria

### Backend/Unit

- Open tunnel to remote TCP service succeeds
- Ephemeral local port selection returns actual port
- Local bind conflict shows error without dangling listener
- Remote port closed/refused → tunnel becomes `failed`, no Host crash
- Client disconnect closes only that SSH channel
- SSH disconnect closes all listeners and channels
- Double dispose is idempotent, no duplicate terminal transitions
- Stale reconnect result cannot mutate newer generation tunnel

### Desktop Integration

- Connect SSH workspace → create/list/delete port forward
- Open local HTTP server on remote → accessible via forwarded URL
- Close remote session → local port no longer listens
- Renderer reload → only shows tunnels that still exist
- Local bind listens on loopback only
- WSL/Docker behavior unchanged
- Web/mobile does not show unsupported capability

## Implemented Contract

- `IPortForwardingService` is exposed only by the Desktop Host remote workspace service collection.
- `PortForwardManager` owns all listeners and SSH channels for the lifetime of the Host connection; it supports multiple logical `remoteSessionId` values sharing one SSH transport.
- SSH-only transport uses `SSHBackend.forwardOut`; WSL, Docker, Web, and mobile connections do not expose the service.
- Renderer clients call `list`, `create`, `remove`, and subscribe to `onDynamicEvent`; the manager remains the only accepted state owner.
