import { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Lock,
  Unlock,
  RefreshCw,
  FileSearch,
  Fingerprint,
  AlertTriangle,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { secureFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface AdminAccount {
  id: string;
  accountLastFour: string;
  creditLimitCents: number;
  balanceCents: number;
  isFrozen: boolean;
  createdAt: string;
  user: {
    id: string;
    email: string;
    role: string;
    ssnLastFour: string | null;
  };
}

interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  resourceId: string | null;
  ipAddress: string;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  integrityHash: string;
  actor: {
    id: string;
    email: string;
    role: string;
  } | null;
}

export function SecurityAdminDashboard() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [actionFilter, setActionFilter] = useState<string>('');
  const [freezeReasons, setFreezeReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const isSecurityAdmin = user?.role === 'SECURITY_ADMIN';

  const fetchSocData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : '';
      const [accountsRes, logsRes] = await Promise.all([
        secureFetch('/admin/accounts'),
        secureFetch(`/admin/audit-logs${query}`),
      ]);

      if (!accountsRes.ok || !logsRes.ok) {
        throw new Error('Failed to load Security Operations Center telemetry');
      }

      const accountsData = await accountsRes.json();
      const logsData = await logsRes.json();

      setAccounts(accountsData.accounts || []);
      setLogs(logsData.logs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch SOC data');
    } finally {
      setLoading(false);
    }
  }, [actionFilter]);

  useEffect(() => {
    void fetchSocData();
  }, [fetchSocData]);

  const handleToggleFreeze = async (account: AdminAccount) => {
    const reason = (freezeReasons[account.id] || '').trim();
    if (reason.length < 5) {
      setError('Compliance Requirement: Enter an incident reason (min 5 chars) before freezing or unfreezing.');
      return;
    }

    setSubmittingId(account.id);
    setError(null);
    setStatusBanner(null);

    try {
      const nextState = !account.isFrozen;
      const res = await secureFetch(`/admin/accounts/${account.id}/freeze`, {
        method: 'PATCH',
        body: JSON.stringify({
          isFrozen: nextState,
          reason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update account freeze state');
      }

      setFreezeReasons((prev) => ({ ...prev, [account.id]: '' }));
      setStatusBanner(
        `Account •••• ${account.accountLastFour} (${account.user.email}) is now ${
          nextState ? 'FROZEN' : 'ACTIVE'
        }. Audit event recorded.`
      );
      await fetchSocData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incident action failed');
    } finally {
      setSubmittingId(null);
    }
  };

  const getSeverityBadge = (action: string) => {
    if (
      action.includes('FAILED') ||
      action.includes('UNAUTHORIZED') ||
      action.includes('REUSE_DETECTED') ||
      action === 'ACCOUNT_FROZEN'
    ) {
      return 'bg-red-950/80 text-red-300 border-red-700/70';
    }
    if (action.includes('SSN') || action.includes('PII') || action.includes('ROLE')) {
      return 'bg-amber-950/80 text-amber-300 border-amber-700/70';
    }
    return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/70';
  };

  return (
    <div className="mt-8 space-y-6 border-t border-slate-800 pt-8">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-amber-500/30 bg-slate-900/90 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2.5 text-amber-400">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">
                Security Operations Center (SOC) & Audit Console
              </h2>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                {user?.role}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Least-Privilege Oversight • Tamper-Evident SHA-256 Log Fingerprinting • Circuit-Breaker Account Freezing
            </p>
          </div>
        </div>

        <button
          onClick={() => void fetchSocData()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Telemetry
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/50 p-3 text-xs text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {statusBanner && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/50 p-3 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{statusBanner}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">
              1. Credit Account Circuit Breaker (Freeze / Unfreeze)
            </h3>
            <p className="text-xs text-slate-400">
              Full account numbers and SSNs remain encrypted at rest. Freezing immediately blocks all ledger transfers.
            </p>
          </div>
          <span className="text-xs text-slate-400">{accounts.length} Total Accounts</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
            <tr>
              <th className="pb-2.5 pr-4">Customer</th>
              <th className="pb-2.5 px-4">Masked Account</th>
              <th className="pb-2.5 px-4">Balance / Limit</th>
              <th className="pb-2.5 px-4">Status</th>
              <th className="pb-2.5 pl-4">Incident Response Action</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
            {accounts.map((acc) => (
              <tr key={acc.id} className="hover:bg-slate-800/30">
                <td className="py-3 pr-4">
                  <div className="font-medium text-white">{acc.user.email}</div>
                  <div className="text-[11px] text-slate-500">
                    SSN: •••-••-{acc.user.ssnLastFour || 'XXXX'}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-slate-200">
                  •••• •••• •••• {acc.accountLastFour}
                </td>
                <td className="px-4 py-3 font-mono">
                  <span className="text-white">${(acc.balanceCents / 100).toFixed(2)}</span>
                  <span className="text-slate-500">
                      {' '}
                    / ${(acc.creditLimitCents / 100).toFixed(2)}
                    </span>
                </td>
                <td className="px-4 py-3">
                  {acc.isFrozen ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-red-300">
                        <Lock className="h-3 w-3" /> FROZEN
                      </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                        <Unlock className="h-3 w-3" /> ACTIVE
                      </span>
                  )}
                </td>
                <td className="py-3 pl-4">
                  {isSecurityAdmin ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Audit reason (e.g. Suspected ATO)"
                        value={freezeReasons[acc.id] || ''}
                        onChange={(e) =>
                          setFreezeReasons((prev) => ({ ...prev, [acc.id]: e.target.value }))
                        }
                        className="w-48 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        onClick={() => void handleToggleFreeze(acc)}
                        disabled={submittingId === acc.id}
                        className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition ${
                          acc.isFrozen
                            ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                            : 'bg-red-600 text-white hover:bg-red-500'
                        } disabled:opacity-50`}
                      >
                        {acc.isFrozen ? (
                          <>
                            <Unlock className="h-3 w-3" /> Unfreeze
                          </>
                        ) : (
                          <>
                            <Lock className="h-3 w-3" /> Freeze
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] italic text-slate-500">
                        Requires SECURITY_ADMIN clearance
                      </span>
                  )}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  No credit accounts provisioned yet.
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                2. Tamper-Evident Security Audit Log Stream
              </h3>
              <p className="text-xs text-slate-400">
                PII and credentials are automatically scrubbed via recursive key redaction before database insert.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="">All Security Events</option>
              <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
              <option value="LOGIN_FAILED_BAD_PASSWORD">LOGIN_FAILED_BAD_PASSWORD</option>
              <option value="VIEW_FULL_SSN">VIEW_FULL_SSN</option>
              <option value="ACCOUNT_FROZEN">ACCOUNT_FROZEN</option>
              <option value="ACCOUNT_UNFROZEN">ACCOUNT_UNFROZEN</option>
              <option value="CREDIT_TRANSFER_COMPLETED">CREDIT_TRANSFER_COMPLETED</option>
              <option value="UNAUTHORIZED_ROLE_ACCESS_ATTEMPT">
                UNAUTHORIZED_ROLE_ACCESS_ATTEMPT
              </option>
            </select>
          </div>
        </div>

        <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-lg border border-slate-800/90 bg-slate-950/70 p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${getSeverityBadge(
                      log.action
                    )}`}
                  >
                    {log.action}
                  </span>
                  <span className="font-medium text-slate-200">
                    {log.actor ? `${log.actor.email} (${log.actor.role})` : 'Unauthenticated Actor'}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="font-mono">IP: {log.ipAddress}</span>
                  <span
                    title="SHA-256 Canonical Row Fingerprint"
                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 font-mono text-emerald-400"
                  >
                    <Fingerprint className="h-3 w-3" />
                    {log.integrityHash}
                  </span>
                  <span>{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              </div>

              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded bg-slate-900/90 p-2 font-mono text-[11px] text-slate-300">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}