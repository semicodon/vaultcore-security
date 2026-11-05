import React, { useState } from 'react';
import { ArrowRightLeft, CheckCircle2, RefreshCw, PlusCircle } from 'lucide-react';
import { apiFetch } from '../api/client';

export interface CreditAccount {
  id: string;
  accountLastFour: string;
  creditLimitCents: number;
  balanceCents: number;
  isFrozen: boolean;
}

interface LedgerTransferCardProps {
  accounts: CreditAccount[];
  onRefreshAccounts: () => Promise<void>;
}

export const LedgerTransferCard: React.FC<LedgerTransferCardProps> = ({   accounts, onRefreshAccounts,
                                                                      }) => {
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  const [description, setDescription] = useState('');

  // Form-scoped Idempotency Key persists across retries of the exact same transfer intent
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [initialBalanceDollars, setInitialBalanceDollars] = useState('1000');
  const [creditLimitDollars, setCreditLimitDollars] = useState('5000');

  // Rotate the Idempotency Key whenever the user modifies the transfer parameters
  const rotateKeyOnInputChange = () => {
    setIdempotencyKey(crypto.randomUUID());
    setStatusMessage(null);
  };
  const handleCreateAccount = async () => {
    setError(null);

    const parsedBalance = Number(initialBalanceDollars);
    const parsedLimit = Number(creditLimitDollars);

    if (!Number.isFinite(parsedBalance) || parsedBalance < 0) {
      setError('Enter a valid non-negative initial balance');
      return;
    }
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      setError('Enter a valid positive credit limit');
      return;
    }

    // Convert dollars to integer cents to prevent floating-point issues
    const initialBalanceCents = Math.round(parsedBalance * 100);
    const creditLimitCents = Math.round(parsedLimit * 100);

    if (initialBalanceCents > creditLimitCents) {
      setError('Initial balance cannot exceed the credit limit');
      return;
    }

    setCreatingAccount(true);
    try {
      const randomAccountNum = Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 10)
      ).join('');

      await apiFetch('/accounts', {
        method: 'POST',
        body: JSON.stringify({
          accountNumber: randomAccountNum,
          creditLimitCents,
          initialBalanceCents, // Send initial balance to backend
        }),
      });
      await onRefreshAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open credit account');
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);

    const parsedDollars = Number(amountDollars);
    if (!Number.isFinite(parsedDollars) || parsedDollars <= 0) {
      setError('Enter a valid positive dollar amount');
      return;
    }

    // Convert dollars to exact integer cents to prevent IEEE-754 floating-point vulnerabilities
    const amountCents = Math.round(parsedDollars * 100);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ status?: string; message?: string }>(
        '/accounts/transfer', // 👈 Matches app.use('/api/v1/accounts', accountRouter) + .post('/transfer')
        {
          method: 'POST',
          idempotencyKey,
          body: JSON.stringify({
            fromAccountId,
            toAccountId,
            amountCents,
            description: description.trim() || 'VaultCore Ledger Transfer',
            idempotencyKey, // 👈 Required by transferSchema in accounts.routes.ts!
          }),
        }
      );

      if (res.status === 'idempotent_replay') {
        setStatusMessage('Idempotent replay detected: Transfer was already safely processed.');
      } else {
        setStatusMessage(`Transferred $${(amountCents / 100).toFixed(2)} inside Serializable ACID transaction.`);
      }

      // Reset form and mint a brand-new Idempotency Key for the next transfer
      setAmountDollars('');
      setDescription('');
      setIdempotencyKey(crypto.randomUUID());
      await onRefreshAccounts();
    } catch (err) {
      // Notice we DO NOT rotate idempotencyKey on error—allowing safe network retries!
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">Transactional Credit Ledger</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1">
            <span className="text-xs text-slate-400">Start Bal ($):</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={initialBalanceDollars}
              onChange={(e) => setInitialBalanceDollars(e.target.value)}
              className="w-20 bg-transparent text-xs text-white focus:outline-none"
              placeholder="1000"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1">
            <span className="text-xs text-slate-400">Limit ($):</span>
            <input
              type="number"
              min="1"
              step="0.01"
              value={creditLimitDollars}
              onChange={(e) => setCreditLimitDollars(e.target.value)}
              className="w-20 bg-transparent text-xs text-white focus:outline-none"
              placeholder="5000"
            />
          </div>

          <button
            type="button"
            onClick={handleCreateAccount}
            disabled={creatingAccount}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition"
          >
            <PlusCircle className="w-4 h-4" />
            {creatingAccount ? 'Provisioning...' : 'New Credit Account'}
          </button>
        </div>
      </div><div className="flex flex-wrap items-center justify-between gap-3">
    </div>

      {/* Account Balances Grid */}
      {accounts.length === 0 ? (
        <div className="text-sm text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-4">
          No credit accounts yet. Click <strong>New Credit Account</strong> twice to test atomic transfers between two accounts!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between"
            >
              <div>
                <span className="text-xs font-mono text-slate-400 block">
                  ACCT •••• {acc.accountLastFour}
                </span>
                <span className="text-lg font-semibold text-white">
                  ${(acc.balanceCents / 100).toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    / ${(acc.creditLimitCents / 100).toFixed(2)} limit
                  </span>
                </span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                ID: {acc.id.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Idempotent Transfer Form */}
      <form onSubmit={handleTransferSubmit} className="space-y-4 pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Active Idempotency-Key Header:</span>
          <code className="font-mono text-indigo-300 bg-indigo-950/50 px-2 py-0.5 rounded border border-indigo-500/20">
            {idempotencyKey}
          </code>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {error}
          </div>
        )}

        {statusMessage && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Source Account (Debit)</label>
            <select
              required
              value={fromAccountId}
              onChange={(e) => {
                setFromAccountId(e.target.value);
                rotateKeyOnInputChange();
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Select source account...</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  •••• {acc.accountLastFour} (Bal: ${(acc.balanceCents / 100).toFixed(2)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Destination Account (Credit)</label>
            <select
              required
              value={toAccountId}
              onChange={(e) => {
                setToAccountId(e.target.value);
                rotateKeyOnInputChange();
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Select destination account...</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  •••• {acc.accountLastFour} (Bal: ${(acc.balanceCents / 100).toFixed(2)})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Amount ($ USD)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="125.50"
              value={amountDollars}
              onChange={(e) => {
                setAmountDollars(e.target.value);
                rotateKeyOnInputChange();
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Audit Memo</label>
            <input
              type="text"
              required
              maxLength={120}
              placeholder="Credit line settlement"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                rotateKeyOnInputChange();
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || accounts.length < 2}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white disabled:opacity-50 transition"
        >
          <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
          {submitting ? 'Executing Serializable Transaction...' : 'Execute Idempotent Transfer'}
        </button>
      </form>
    </div>
  );
};