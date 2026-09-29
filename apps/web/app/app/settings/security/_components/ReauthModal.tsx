"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Btn, Field, Modal, inputCls } from "@/components/workspace/ui";
import { CodeInput } from "@/app/auth/two-factor/_components/CodeInput";

/** Re-authentication (password + current code) for sensitive 2FA changes. */
export function ReauthModal({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  hasPassword,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  hasPassword: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (v: { password?: string; code: string }) => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (open) {
      setPassword("");
      setCode("");
      setRecovery(false);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant={danger ? "danger" : "primary"} disabled={busy || code.length < 6 || (hasPassword && password.length < 4)} onClick={() => onSubmit({ password: hasPassword ? password : undefined, code })}>
            {busy && <Loader2 size={14} className="animate-spin" />} {confirmLabel}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-slate-300">{description}</p>
      <div className="mt-3 space-y-3">
        {hasPassword && (
          <Field label="Current password">
            <input type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <div>
          <span className="mb-1.5 block text-[13px] text-slate-300">{recovery ? "Recovery code" : "Code from your authenticator app"}</span>
          <CodeInput value={code} onChange={setCode} recovery={recovery} invalid={!!error} />
          <button type="button" className="mt-1.5 text-[12px] text-cyan-300 hover:underline" onClick={() => (setRecovery((r) => !r), setCode(""))}>
            {recovery ? "Use the authenticator app" : "Use a recovery code instead"}
          </button>
        </div>
        {error && <p className="text-[12px] text-rose-300">{error}</p>}
      </div>
    </Modal>
  );
}
