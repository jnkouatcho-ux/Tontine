import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { formatDate, isExpired } from '../lib/utils';
import type { TontineInvitation, Tontine } from '../types/database';
import { Bell, Check, X, Clock, Users } from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface InvitationWithTontine extends TontineInvitation {
  tontine?: Tontine;
}

export default function InvitationsPage() {
  const { user, session } = useAuth();
  const [invitations, setInvitations] = useState<InvitationWithTontine[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!user || !session) return;
    setLoading(true);
    try {
      const res = await fetch(`${EF_URL}?action=my-invitations`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();
      if (data.invitations) {
        setInvitations(data.invitations as InvitationWithTontine[]);
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, [user, session]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const expireInvitations = invitations.filter(
      (inv) => inv.status === 'pending' && isExpired(inv.expires_at)
    );
    if (expireInvitations.length > 0) {
      // Mark as expired locally - the edge function handles this on next load
      setInvitations((prev) =>
        prev.map((inv) =>
          inv.status === 'pending' && isExpired(inv.expires_at)
            ? { ...inv, status: 'expired' as const }
            : inv
        )
      );
    }
  }, [invitations]);

  const handleAccept = async (invitation: InvitationWithTontine) => {
    if (!user || !session) return;
    setProcessingId(invitation.id);
    setError('');

    try {
      const res = await fetch(`${EF_URL}?action=accept-invitation&invitation_id=${invitation.id}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Erreur lors de l\'acceptation');
      }
    } catch {
      setError('Erreur de connexion');
    }

    setProcessingId(null);
    loadData();
  };

  const handleReject = async (invitation: InvitationWithTontine) => {
    if (!user || !session) return;
    setProcessingId(invitation.id);
    setError('');

    try {
      await fetch(`${EF_URL}?action=reject-invitation&invitation_id=${invitation.id}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
    } catch {
      setError('Erreur de connexion');
    }

    setProcessingId(null);
    loadData();
  };

  const pendingInvitations = invitations.filter((i) => i.status === 'pending' && !isExpired(i.expires_at));
  const pastInvitations = invitations.filter((i) => i.status !== 'pending' || isExpired(i.expires_at));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Invitations</h1>
        <p className="text-slate-500 mt-1">Demandes de rejoindre des tontines</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
          {error}
        </div>
      )}

      {pendingInvitations.length === 0 && pastInvitations.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Bell className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Aucune invitation pour le moment</p>
        </div>
      )}

      {pendingInvitations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">En attente</h2>
          {pendingInvitations.map((inv) => (
            <div key={inv.id} className="bg-white rounded-2xl border-2 border-emerald-200 p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Users className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900">{inv.tontine?.name || 'Tontine'}</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Vous avez ete invite a rejoindre cette tontine
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-amber-600">
                    <Clock className="w-3.5 h-3.5" />
                    Expire le {formatDate(inv.expires_at)}
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={() => handleAccept(inv)}
                      disabled={processingId === inv.id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
                    >
                      <Check className="w-4 h-4" />
                      {processingId === inv.id ? 'Acceptation...' : 'Accepter'}
                    </button>
                    <button
                      onClick={() => handleReject(inv)}
                      disabled={processingId === inv.id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium rounded-xl transition-all"
                    >
                      <X className="w-4 h-4" />
                      Refuser
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pastInvitations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Historique</h2>
          {pastInvitations.map((inv) => (
            <div key={inv.id} className="bg-white rounded-2xl border border-slate-200 p-4 opacity-70">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">{inv.tontine?.name || 'Tontine'}</p>
                  <p className="text-xs text-slate-500">{formatDate(inv.created_at)}</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  inv.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                  inv.status === 'rejected' ? 'bg-red-100 text-red-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {inv.status === 'accepted' ? 'Acceptee' :
                   inv.status === 'rejected' ? 'Refusee' : 'Expiree'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
