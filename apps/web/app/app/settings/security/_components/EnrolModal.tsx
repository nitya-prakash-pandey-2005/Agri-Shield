"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Btn, Modal } from "@/components/workspace/ui";
import { QrCode } from "@/app/auth/two-factor/_components/QrCode";
import { CodeInput } from "@/app/auth/two-factor/_components/CodeInput";
import { RecoveryCodes } from "@/app/auth/two-factor/_components/RecoveryCodes";
import { errMsg } from "./shared";

/** Enrol an authenticator app from Settings: QR → confirm code → recovery codes. */
export function EnrolModal({ open, onClose, account, onDone }: { open: boolean; onClose: () => void; account: string; onDone: () => void }) {
  const start = trpc.developer.security.startEnrolment.useMutation();
  const confirm = trpc.developer.security.confirmEnrolment.useMutation();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setError(null);
      setCodes(null);
      setSaved(false);
      start.mutate(undefined, { onError: (e) => setError(errMsg(e)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const d = start.data;
  const submit = async () => {
    if (!d) return;
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your app");
    setError(null);
    try {
      const r = await confirm.mutateAsync({ token: d.token, code });
      setCodes(r.recoveryCodes);
      onDone();
      toast.success("2-step verification is on");
    } catch (e) {
      setError(errMsg(e));
      setCode("");
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => (codes && !saved ? toast.message("Save your recovery codes before closing") : onClose())}
      title={codes ? "Save your recovery codes" : "Set up an authenticator app"}
      wide
      footer={
        codes ? (
          <Btn disabled={!saved} onClick={onClose}>
            Done
          </Btn>
        ) : (
          <>
            <Btn variant="outline" onClick={onClose}>
              Cancel
            </Btn>
            <Btn onClick={submit} disabled={!d || confirm.isPending}>
              {confirm.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Verify &amp; turn on
            </Btn>
          </>
        )
      }
    >
      {codes ? (
        <RecoveryCodes codes={codes} account={account} onConfirmed={setSaved} />
      ) : !d ? (
        error ? <p className="text-sm text-rose-300">{error}</p> : <div className="skeleton h-52 rounded-xl" />
      ) : (
        <div className="grid gap-5 sm:grid-cols-[auto,1fr]">
          <div className="flex justify-center">
            <QrCode path={d.qr.path} viewBox={d.qr.viewBox} label="QR code for your authenticator app" size={184} />
          </div>
          <div className="min-w-0 space-y-3 text-[13px] text-slate-300">
            <p>
              <b className="text-white">1.</b> Open Google Authenticator, Microsoft Authenticator, 1Password, Authy or any TOTP app and scan the code.
            </p>
            <div>
              <span className="text-[12px] text-slate-400">No camera? Add this key manually (time-based, SHA-1, 6 digits, 30 s):</span>
              <div className="telemetry mt-1 select-all break-all rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-2 text-[13px] text-white">{d.manualKey}</div>
            </div>
            <div>
              <p className="mb-2">
                <b className="text-white">2.</b> Enter the 6-digit code the app shows:
              </p>
              <CodeInput value={code} onChange={setCode} invalid={!!error} autoFocus />
              {error && <p className="mt-2 text-[12px] text-rose-300">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
