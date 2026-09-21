export type PortForwardStatus = "connecting" | "active" | "failed" | "closed";

export interface PortForwardRecord {
  id: string;
  remoteSessionId: string;
  label: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: PortForwardStatus;
  error?: string;
  createdAt: number;
}

export interface PortForwardCreateRequest {
  remoteSessionId: string;
  remotePort: number;
  localPort?: number;
  label?: string;
}

export interface PortForwardRemoveRequest {
  remoteSessionId: string;
  id: string;
}

export interface PortForwardListRequest {
  remoteSessionId: string;
}

export type PortForwardEvent =
  | { type: "created"; record: PortForwardRecord }
  | { type: "status-changed"; id: string; status: PortForwardStatus; error?: string }
  | { type: "removed"; id: string };

export const PORT_FORWARD_MAX_TUNNELS_PER_SESSION = 16;
export const PORT_FORWARD_MAX_CONNECTIONS_PER_TUNNEL = 32;
export const PORT_FORWARD_LABEL_MAX_LENGTH = 64;

export function validatePortForwardCreateRequest(request: PortForwardCreateRequest): string | null {
  if (
    !Number.isInteger(request.remotePort) ||
    request.remotePort < 1 ||
    request.remotePort > 65535
  ) {
    return "remotePort must be an integer between 1 and 65535";
  }
  if (request.localPort !== undefined) {
    if (
      !Number.isInteger(request.localPort) ||
      request.localPort < 1 ||
      request.localPort > 65535
    ) {
      return "localPort must be an integer between 1 and 65535";
    }
  }
  if (request.label !== undefined && request.label.length > PORT_FORWARD_LABEL_MAX_LENGTH) {
    return `label must be at most ${PORT_FORWARD_LABEL_MAX_LENGTH} characters`;
  }
  return null;
}
