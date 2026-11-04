import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PiiVaultCard } from './components/PiiVaultCard';
import {type CreditAccount, LedgerTransferCard} from './components/LedgerTransferCard';
import { apiFetch } from './api/client';

const VaultDashboard: React.FC = () => {
  const { user, isInitializing, login, register, logout } = useAuth();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ssn, setSsn] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);

  const fetchAccounts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch<{ accounts: CreditAccount[] }>('/ledger/accounts');
      setAccounts(res.accounts);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center font-mono text-sm">
        Verifying Zero-Trust HttpOnly Session...
      </div>
    );
  }

  if (!user) {
    const handleAuthSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError(null);
      try {
        if (isRegisterMode) {
          await register(email, password, ssn);
        } else {
          await login(email, password);
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Authentication failed');
      }
    };

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-7 h-7 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold text-white">VaultCore Security Portal</h1>
              <p className="text-xs text-slate-400">
                Zero-localStorage JWT • Argon2id • AES-256-GCM
              </p>
            </div>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Work Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alice@vaultcore.io"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Password (min 12 chars, upper, number, symbol)
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="StrongPassword!2026"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>

            {isRegisterMode && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  SSN (Encrypted with AES-256-GCM at rest)
                </label>
                <input
                  type="text"
                  required
                  pattern="\d{3}-\d{2}-\d{4}"
                  value={ssn}
                  onChange={(e) => setSsn(e.target.value)}
                  placeholder="123-45-6789"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition"
            >
              {isRegisterMode ? 'Register & Encrypt Vault' : 'Sign In with Zero-Trust Session'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setIsRegisterMode(!isRegisterMode);
              setAuthError(null);
            }}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-200"
          >
            {isRegisterMode
              ? 'Already have a vault account? Sign in'
              : 'Need an account? Register a new encrypted profile'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <span className="font-bold text-white">VaultCore</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-400">
              {user.role}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">{user.email}</span>
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 text-slate-300 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              Revoke Session
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <PiiVaultCard ssnLastFour={user.ssnLastFour} />
        <LedgerTransferCard accounts={accounts} onRefreshAccounts={fetchAccounts} />
      </main>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <VaultDashboard />
    </AuthProvider>
  );
}