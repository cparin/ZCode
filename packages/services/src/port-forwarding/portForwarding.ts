import type { Event } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import type {
  PortForwardCreateRequest,
  PortForwardEvent,
  PortForwardListRequest,
  PortForwardRecord,
  PortForwardRemoveRequest,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IPortForwardingService {
  list(request: PortForwardListRequest): Promise<PortForwardRecord[]>;
  create(request: PortForwardCreateRequest): Promise<PortForwardRecord>;
  remove(request: PortForwardRemoveRequest): Promise<void>;
  onDynamicEvent(remoteSessionId: string): Event<PortForwardEvent>;
}

export const IPortForwardingService = createServiceDescriptor<IPortForwardingService>(
  ServiceChannels.PortForwarding,
);
