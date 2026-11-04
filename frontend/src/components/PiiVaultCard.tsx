import React, { useState, useEffect } from 'react';
import { ShieldAlert, Eye, EyeOff, Lock, Clock } from 'lucide-react';
import { apiFetch } from '../api/client';

interface PiiVaultCardProps {
  ssnLastFour?: string | null;
}

export const PiiVaultCard: React.FC<PiiVaultCardProps> = ({ ssnLastFour }) => {
  const [decryptedSsn, setDecryptedSsn] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [showStepUpModal, setShowStepUpModal] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Auto-mask countdown timer (wipes plaintext SSN from memory after 15 seconds)
  useEffect(() => {
    if (!decryptedSsn || secondsLeft <= 0) {
      setDecryptedSsn(null);
      return;
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setDecryptedSsn(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [decryptedSsn, secondsLeft]);

  // 2. Anti-Shoulder-Surfing: Wipe plaintext immediately if user switches browser tabs or blurs window
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setDecryptedSsn(null);
        setSecondsLeft(0);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const handleStepUpReveal = async (e: React.ChangeEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch<{
        ssn: string;
        expiresInSeconds: number
      }>('/vault/reveal-pii', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });

      setDecryptedSsn(res.ssn);
      setSecondsLeft(res.expiresInSeconds || 15);
      setPassword('');
      setShowStepUpModal(false);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Step-up verification failed');

    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">AES-256-GCM PII Vault</h2>
        </div>
        <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          FIELD-ENCRYPTED
        </span>
      </div>

      <p className="text-sm text-slate-400 mb-4">
        Your Social Security Number is encrypted at the application layer before storage. Revealing
        it requires step-up authentication and is recorded in the immutable security audit log.
      </p>

      <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg p-4">
        <div>
          <span className="text-xs uppercase tracking-wider text-slate-500 block mb-1">
            Tax Identification (SSN)
          </span>
          <span className="font-mono text-xl tracking-widest text-slate-100 select-none">
            {decryptedSsn ? decryptedSsn : `***-**-${ssnLastFour || 'XXXX'}`}
          </span>
        </div>

        {decryptedSsn ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-mono text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
              <Clock className="w-3.5 h-3.5" />
              Auto-mask in {secondsLeft}s
            </span>
            <button
              type="button"
              onClick={() => {
                setDecryptedSsn(null);
                setSecondsLeft(0);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
            >
              <EyeOff className="w-4 h-4" />
              Mask Now
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowStepUpModal(true);
              setError(null);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition"
          >
            <Eye className="w-4 h-4" />
            Step-Up Reveal
          </button>
        )}
      </div>

      {showStepUpModal && (
        <form
          onSubmit={handleStepUpReveal}
          className="mt-4 p-4 rounded-lg bg-slate-950 border border-amber-500/30 space-y-3"
        >
          <div className="flex items-center gap-2 text-amber-400 text-xs font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Step-Up Authentication Required: Confirm your password to decrypt PII</span>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2">
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Re-enter your account password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-50 transition"
            >
              {loading ? 'Decrypting...' : 'Verify & Unlock'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowStepUpModal(false);
                setPassword('');
                setError(null);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};