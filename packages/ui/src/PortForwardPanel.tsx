import { useCallback, useEffect, useState } from "react";
import type { PortForwardRecord } from "@zcode/shared";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";

export function PortForwardPanel({
  workspacePath,
  remoteSessionId,
  workspaceIdentity,
}: {
  workspacePath: string;
  remoteSessionId?: string;
  workspaceIdentity?: string;
}) {
  const services = useWorkspaceServices(workspacePath, remoteSessionId, workspaceIdentity);
  const service = services.portForwardingService;
  const [records, setRecords] = useState<PortForwardRecord[]>([]);
  const [remotePort, setRemotePort] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!service || !remoteSessionId) return;
    setRecords(await service.list({ remoteSessionId }));
  }, [remoteSessionId, service]);

  useEffect(() => {
    if (!service || !remoteSessionId) return;
    void refresh();
    const subscription = service.onDynamicEvent(remoteSessionId)(() => {
      void refresh();
    });
    return () => subscription.dispose();
  }, [refresh, remoteSessionId, service]);

  if (!service || !remoteSessionId) return null;

  const create = async () => {
    setError(null);
    const parsedRemotePort = Number(remotePort);
    const parsedLocalPort = localPort ? Number(localPort) : undefined;
    try {
      await service.create({
        remoteSessionId,
        remotePort: parsedRemotePort,
        ...(parsedLocalPort === undefined ? {} : { localPort: parsedLocalPort }),
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setRemotePort("");
      setLocalPort("");
      setLabel("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section
      className="mx-2 mb-2 rounded-lg border border-border bg-surface p-2"
      aria-label="Ports"
    >
      <div className="mb-2 text-ui-sm font-medium text-foreground">Forwarded Ports</div>
      <div className="grid grid-cols-[1fr_1fr] gap-1">
        <Input
          value={remotePort}
          onChange={(event) => setRemotePort(event.target.value)}
          placeholder="Remote port"
          inputMode="numeric"
        />
        <Input
          value={localPort}
          onChange={(event) => setLocalPort(event.target.value)}
          placeholder="Local port"
          inputMode="numeric"
        />
      </div>
      <div className="mt-1 flex gap-1">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label (optional)"
        />
        <Button type="button" size="sm" onClick={() => void create()}>
          Forward
        </Button>
      </div>
      {error ? <div className="mt-1 text-ui-xs text-danger">{error}</div> : null}
      <div className="mt-2 space-y-1">
        {records.map((record) => (
          <div key={record.id} className="flex items-center gap-1 text-ui-xs">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
              onClick={() =>
                window.open(`http://127.0.0.1:${record.localPort}`, "_blank", "noopener,noreferrer")
              }
            >
              {record.label} · {record.localPort} → {record.remotePort} ({record.status})
            </button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void service.remove({ remoteSessionId, id: record.id })}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
