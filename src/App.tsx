// FILE: src/App.tsx
// React/TypeScript application code only.
// Do not put SQL in this file.

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  createFirm,
  isSupabaseConfigured,
  requireSupabase,
  shortDate,
  type Client,
  type Task,
} from './lib';

type Firm = {
  id: string;
  name: string;
  city?: string | null;
};

type Membership = {
  firm_id: string;
  firms: Firm | Firm[] | null;
};

type ViewName =
  | 'Dashboard'
  | 'Clients'
  | 'Compliance Tasks'
  | 'Calendar'
  | 'Review Queue'
  | 'Reports'
  | 'Settings';

const today = new Date();

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const emptyClient = {
  name: '',
  entity_type: 'Individual',
  email: '',
  phone: '',
  pan: '',
  gstin: '',
  status: 'Active',
  services: 'Income Tax',
};

const emptyTask = {
  title: '',
  client_id: '',
  category: 'Income Tax',
  period: '',
  due_date: iso(new Date()),
  internal_due_date: iso(new Date()),
  status: 'Pending',
  priority: 'Medium',
  assigned_to: '',
  reviewer: '',
};

const navItems: { label: ViewName; icon: typeof LayoutDashboard }[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Clients', icon: Users },
  { label: 'Compliance Tasks', icon: ClipboardCheck },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Review Queue', icon: ShieldCheck },
  { label: 'Reports', icon: FileText },
  { label: 'Settings', icon: Settings },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

function normalizeFirm(value: Firm | Firm[] | null): Firm | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace(/_/g, ' ');
  let style = 'bg-slate-100 text-slate-700';

  if (['active', 'completed', 'filed', 'approved', 'released'].includes(normalized)) {
    style = 'bg-emerald-50 text-emerald-700';
  } else if (['overdue', 'rejected', 'blocked'].includes(normalized)) {
    style = 'bg-rose-50 text-rose-700';
  } else if (['in progress', 'under review', 'review'].includes(normalized)) {
    style = 'bg-amber-50 text-amber-700';
  }

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${style}`}>
      {normalized}
    </span>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [firmName, setFirmName] = useState('');
  const [firmCity, setFirmCity] = useState('');
  const [firm, setFirm] = useState<Firm | null>(null);
  const [memberships, setMemberships] = useState<Firm[]>([]);
  const [view, setView] = useState<ViewName>('Dashboard');
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [searchText, setSearchText] = useState('');
  const [showClientModal, setShowClientModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [clientForm, setClientForm] = useState({ ...emptyClient });
  const [taskForm, setTaskForm] = useState({ ...emptyTask });

  const supabase = isSupabaseConfigured ? requireSupabase() : null;

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError('');
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const loadFirmData = useCallback(
    async (selectedFirm: Firm) => {
      if (!supabase) return;

      setLoading(true);
      setError('');

      try {
        const [clientsResult, tasksResult] = await Promise.all([
          supabase
            .from('clients')
            .select('*')
            .eq('firm_id', selectedFirm.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('compliance_tasks')
            .select('*, clients(name)')
            .eq('firm_id', selectedFirm.id)
            .order('due_date', { ascending: true }),
        ]);

        if (clientsResult.error) throw clientsResult.error;
        if (tasksResult.error) throw tasksResult.error;

        setClients((clientsResult.data ?? []) as Client[]);
        setTasks(
          ((tasksResult.data ?? []) as any[]).map((task) => ({
            ...task,
            client_name: Array.isArray(task.clients)
              ? task.clients[0]?.name ?? ''
              : task.clients?.name ?? '',
          })) as Task[],
        );
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [supabase],
  );

  const loadMemberships = useCallback(async () => {
    if (!supabase || !session?.user?.id) return;

    setLoading(true);
    setError('');

    try {
      const { data, error: membershipError } = await supabase
        .from('firm_members')
        .select('firm_id, firms(id, name, city)')
        .eq('user_id', session.user.id);

      if (membershipError) throw membershipError;

      const available = ((data ?? []) as Membership[])
        .map((membership) => normalizeFirm(membership.firms))
        .filter((item): item is Firm => Boolean(item));

      setMemberships(available);

      if (available.length > 0) {
        setFirm((current) => {
          const existing = available.find((item) => item.id === current?.id);
          return existing ?? available[0];
        });
        await loadFirmData(available[0]);
      } else {
        setFirm(null);
        setClients([]);
        setTasks([]);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [supabase, session?.user?.id, loadFirmData]);

  useEffect(() => {
    if (session?.user?.id) {
      void loadMemberships();
    } else {
      setFirm(null);
      setMemberships([]);
      setClients([]);
      setTasks([]);
    }
  }, [session?.user?.id, loadMemberships]);

  const selectFirm = async (nextFirm: Firm) => {
    setFirm(nextFirm);
    await loadFirmData(nextFirm);
  };

  const handleAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    setLoading(true);
    setError('');
    setNotice('');

    try {
      if (authMode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: { full_name: authName.trim() },
          },
        });

        if (signUpError) throw signUpError;

        if (!data.session) {
          setNotice('Account created. Check your email to confirm your account, then sign in.');
        } else {
          setNotice('Account created successfully.');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });

        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  };

  const handleCreateFirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      await createFirm(firmName.trim(), firmCity.trim());
      setFirmName('');
      setFirmCity('');
      setNotice('Your firm has been created.');
      await loadMemberships();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !firm || !session?.user?.id) return;

    setError('');
    setLoading(true);

    try {
      const payload = {
        firm_id: firm.id,
        created_by: session.user.id,
        name: clientForm.name.trim(),
        entity_type: clientForm.entity_type,
        email: clientForm.email.trim(),
        phone: clientForm.phone.trim(),
        pan: clientForm.pan.trim().toUpperCase(),
        gstin: clientForm.gstin.trim().toUpperCase(),
        status: clientForm.status,
        services: clientForm.services
          .split(',')
          .map((service) => service.trim())
          .filter(Boolean),
      };

      const { error: insertError } = await supabase.from('clients').insert(payload);
      if (insertError) throw insertError;

      setShowClientModal(false);
      setClientForm({ ...emptyClient });
      setNotice('Client added successfully.');
      await loadFirmData(firm);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !firm || !session?.user?.id) return;

    setError('');
    setLoading(true);

    try {
      const payload = {
        firm_id: firm.id,
        created_by: session.user.id,
        title: taskForm.title.trim(),
        client_id: taskForm.client_id,
        category: taskForm.category,
        period: taskForm.period.trim(),
        due_date: taskForm.due_date,
        internal_due_date: taskForm.internal_due_date,
        status: taskForm.status,
        priority: taskForm.priority,
        assigned_to: taskForm.assigned_to.trim(),
        reviewer: taskForm.reviewer.trim(),
      };

      const { error: insertError } = await supabase.from('compliance_tasks').insert(payload);
      if (insertError) throw insertError;

      setShowTaskModal(false);
      setTaskForm({ ...emptyTask });
      setNotice('Compliance task created successfully.');
      await loadFirmData(firm);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const updateTaskStatus = async (task: Task, status: string) => {
    if (!supabase || !firm) return;

    setError('');
    setLoading(true);

    try {
      const { error: updateError } = await supabase
        .from('compliance_tasks')
        .update({ status })
        .eq('id', task.id)
        .eq('firm_id', firm.id);

      if (updateError) throw updateError;

      setNotice(`Task marked ${status.toLowerCase()}.`);
      await loadFirmData(firm);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredClients = clients.filter((client) =>
    [client.name, client.email, client.pan, client.gstin]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(searchText.toLowerCase())),
  );

  const filteredTasks = tasks.filter((task) =>
    [task.title, task.client_name, task.category, task.status]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(searchText.toLowerCase())),
  );

  const overdueTasks = tasks.filter(
    (task) => task.status !== 'Completed' && task.status !== 'Filed' && task.due_date < iso(today),
  );
  const pendingTasks = tasks.filter(
    (task) => !['Completed', 'Filed'].includes(task.status),
  );
  const reviewTasks = tasks.filter((task) =>
    ['Under Review', 'Review'].includes(task.status),
  );
  const dueSoonTasks = tasks.filter(
    (task) =>
      !['Completed', 'Filed'].includes(task.status) &&
      task.due_date >= iso(today) &&
      task.due_date <= iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)),
  );

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
          <AlertCircle className="mb-4 text-amber-600" size={32} />
          <h1 className="text-xl font-semibold text-slate-900">Supabase is not configured</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Add your Supabase URL and publishable key to the project's <code>.env</code> file,
            then restart the Vite development server.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
{`VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY`}
          </pre>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading CA Practice…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="grid min-h-screen bg-slate-50 lg:grid-cols-2">
        <div className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-500 p-2.5">
              <Building2 size={24} />
            </div>
            <span className="text-xl font-semibold">CA Practice</span>
          </div>
          <div className="max-w-lg">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
              Practice management, simplified
            </p>
            <h1 className="text-4xl font-semibold leading-tight">
              One workspace for your clients, compliance and team.
            </h1>
            <p className="mt-5 leading-7 text-slate-300">
              Organise client records, monitor filing deadlines and manage review work from one
              secure workspace.
            </p>
          </div>
          <p className="text-xs text-slate-400">CA Practice Management System · MVP</p>
        </div>

        <div className="flex items-center justify-center p-6">
          <form onSubmit={handleAuth} className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-sm">
            <div className="mb-7 lg:hidden">
              <div className="mb-3 inline-flex rounded-xl bg-blue-600 p-3 text-white">
                <Building2 size={24} />
              </div>
              <h1 className="text-2xl font-semibold text-slate-900">CA Practice</h1>
            </div>

            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                {authMode === 'signin' ? 'Welcome back' : 'Create your account'}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {authMode === 'signin'
                  ? 'Sign in to continue to your practice workspace.'
                  : 'Start setting up your practice workspace.'}
              </p>
            </div>

            {authMode === 'signup' && (
              <Field label="Full name">
                <input
                  className={inputClass}
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  required
                  autoComplete="name"
                />
              </Field>
            )}

            <Field label="Email address">
              <input
                className={inputClass}
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </Field>

            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                required
                minLength={6}
                autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
              />
            </Field>

            {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? 'Please wait…' : authMode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            <p className="text-center text-sm text-slate-500">
              {authMode === 'signin' ? "Don't have an account?" : 'Already registered?'}{' '}
              <button
                type="button"
                className="font-semibold text-blue-600 hover:text-blue-700"
                onClick={() => {
                  setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
                  setError('');
                  setNotice('');
                }}
              >
                {authMode === 'signin' ? 'Create account' : 'Sign in'}
              </button>
            </p>
          </form>
        </div>
      </div>
    );
  }

  if (!firm) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <form onSubmit={handleCreateFirm} className="w-full max-w-lg space-y-5 rounded-2xl bg-white p-8 shadow-sm">
          <div className="inline-flex rounded-xl bg-blue-50 p-3 text-blue-700">
            <Building2 size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Set up your firm</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Create your practice workspace. You can add clients and compliance tasks after setup.
            </p>
          </div>

          <Field label="Firm or practice name">
            <input
              className={inputClass}
              value={firmName}
              onChange={(event) => setFirmName(event.target.value)}
              required
              placeholder="e.g. Sharma & Associates"
            />
          </Field>

          <Field label="City">
            <input
              className={inputClass}
              value={firmCity}
              onChange={(event) => setFirmCity(event.target.value)}
              placeholder="e.g. Bengaluru"
            />
          </Field>

          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? 'Creating firm…' : 'Create firm workspace'}
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Sign out
          </button>
        </form>
      </div>
    );
  }

  const renderDashboard = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Good to see you</h2>
        <p className="mt-1 text-sm text-slate-500">
          Here is the current picture of {firm.name}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total clients" value={String(clients.length)} detail="Client records" icon={Users} />
        <MetricCard title="Open tasks" value={String(pendingTasks.length)} detail="Still requiring action" icon={ClipboardCheck} />
        <MetricCard title="Overdue tasks" value={String(overdueTasks.length)} detail="Past their due date" icon={Clock3} alert={overdueTasks.length > 0} />
        <MetricCard title="Awaiting review" value={String(reviewTasks.length)} detail="In the review queue" icon={ShieldCheck} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="font-semibold text-slate-900">Upcoming compliance</h3>
              <p className="mt-1 text-xs text-slate-500">Due in the next seven days</p>
            </div>
            <button onClick={() => setView('Compliance Tasks')} className="text-sm font-medium text-blue-600">
              View all
            </button>
          </div>
          {dueSoonTasks.length === 0 ? (
            <EmptyState title="No upcoming deadlines" detail="Tasks due in the next seven days will appear here." />
          ) : (
            <div className="divide-y divide-slate-100">
              {dueSoonTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{task.client_name || 'Client'} · {task.category}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-slate-700">{shortDate(task.due_date)}</p>
                    <StatusPill value={task.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-900">Quick actions</h3>
            <p className="mt-1 text-xs text-slate-500">Common tasks for your practice</p>
          </div>
          <div className="space-y-3 p-5">
            <QuickAction icon={Users} label="Add a client" onClick={() => setShowClientModal(true)} />
            <QuickAction icon={ClipboardCheck} label="Create compliance task" onClick={() => setShowTaskModal(true)} />
            <QuickAction icon={CalendarDays} label="View calendar" onClick={() => setView('Calendar')} />
            <QuickAction icon={ShieldCheck} label="Open review queue" onClick={() => setView('Review Queue')} />
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Recent tasks</h3>
        </div>
        <TaskTable tasks={tasks.slice(0, 5)} onStatusChange={updateTaskStatus} />
      </section>
    </div>
  );

  const renderClients = () => (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Clients</h2>
          <p className="mt-1 text-sm text-slate-500">{clients.length} client records in this firm</p>
        </div>
        <button onClick={() => setShowClientModal(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus size={16} /> Add client
        </button>
      </div>
      <div className="border-b border-slate-100 p-4">
        <SearchInput value={searchText} onChange={setSearchText} placeholder="Search by client name, email, PAN or GSTIN" />
      </div>
      {filteredClients.length === 0 ? (
        <EmptyState title="No clients found" detail={clients.length ? 'Try another search term.' : 'Add your first client to get started.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 font-medium">Services</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <p className="font-medium text-slate-900">{client.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{client.pan || 'PAN not provided'}</p>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{client.entity_type}</td>
                  <td className="px-5 py-4">
                    <p className="text-slate-700">{client.email || '—'}</p>
                    <p className="mt-1 text-xs text-slate-500">{client.phone || '—'}</p>
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {Array.isArray(client.services) ? client.services.join(', ') : '—'}
                  </td>
                  <td className="px-5 py-4"><StatusPill value={client.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderTasks = () => (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Compliance tasks</h2>
          <p className="mt-1 text-sm text-slate-500">Track deadlines, owners and task status.</p>
        </div>
        <button onClick={() => setShowTaskModal(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus size={16} /> New task
        </button>
      </div>
      <div className="border-b border-slate-100 p-4">
        <SearchInput value={searchText} onChange={setSearchText} placeholder="Search tasks, clients or categories" />
      </div>
      <TaskTable tasks={filteredTasks} onStatusChange={updateTaskStatus} />
    </section>
  );

  const renderCalendar = () => {
    const grouped = [...tasks]
      .filter((task) => task.due_date)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .reduce<Record<string, Task[]>>((result, task) => {
        const month = task.due_date.slice(0, 7);
        result[month] = [...(result[month] ?? []), task];
        return result;
      }, {});

    return (
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-xl font-semibold text-slate-900">Compliance calendar</h2>
          <p className="mt-1 text-sm text-slate-500">Deadlines grouped by month.</p>
        </div>
        {Object.keys(grouped).length === 0 ? (
          <EmptyState title="No deadlines to display" detail="Create compliance tasks to populate your calendar." />
        ) : (
          <div className="space-y-6 p-5">
            {Object.entries(grouped).map(([month, monthTasks]) => (
              <div key={month}>
                <h3 className="mb-3 text-sm font-semibold text-slate-700">
                  {new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </h3>
                <div className="space-y-2">
                  {monthTasks.map((task) => (
                    <div key={task.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><CalendarDays size={18} /></div>
                        <div>
                          <p className="font-medium text-slate-900">{task.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{task.client_name || 'Client'} · {task.category}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600">{shortDate(task.due_date)}</span>
                        <StatusPill value={task.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderReviewQueue = () => {
    const reviewQueue = tasks.filter((task) =>
      ['Under Review', 'Review'].includes(task.status),
    );

    return (
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-xl font-semibold text-slate-900">Review queue</h2>
          <p className="mt-1 text-sm text-slate-500">Tasks currently awaiting review.</p>
        </div>
        {reviewQueue.length === 0 ? (
          <EmptyState title="Review queue is clear" detail="Tasks marked Under Review or Review will appear here." />
        ) : (
          <TaskTable tasks={reviewQueue} onStatusChange={updateTaskStatus} />
        )}
      </section>
    );
  };

  const renderReports = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Practice reports</h2>
        <p className="mt-1 text-sm text-slate-500">A simple snapshot of your current workload.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Total clients" value={String(clients.length)} detail="All client records" icon={Users} />
        <MetricCard title="Open tasks" value={String(pendingTasks.length)} detail="Not yet completed or filed" icon={Activity} />
        <MetricCard title="Overdue" value={String(overdueTasks.length)} detail="Past due date" icon={Clock3} alert={overdueTasks.length > 0} />
        <MetricCard title="Due soon" value={String(dueSoonTasks.length)} detail="Next seven days" icon={CalendarDays} />
        <MetricCard title="Completed / filed" value={String(tasks.filter((task) => ['Completed', 'Filed'].includes(task.status)).length)} detail="Closed tasks" icon={CheckCircle2} />
        <MetricCard title="Awaiting review" value={String(reviewTasks.length)} detail="Tasks in review" icon={ShieldCheck} />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">Task status summary</h3>
        <div className="mt-4 space-y-4">
          {['Pending', 'In Progress', 'Under Review', 'Completed', 'Filed'].map((status) => {
            const count = tasks.filter((task) => task.status === status).length;
            const percentage = tasks.length ? (count / tasks.length) * 100 : 0;
            return (
              <div key={status}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-slate-600">{status}</span>
                  <span className="font-medium text-slate-900">{count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><Building2 size={24} /></div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Firm settings</h2>
            <p className="mt-1 text-sm text-slate-500">Current workspace details.</p>
          </div>
        </div>
        <dl className="mt-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Firm name</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{firm.name}</dd>
          </div>
          <div className="border-b border-slate-100 pb-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">City</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{firm.city || 'Not specified'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Signed-in user</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{session.user.email}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="font-semibold text-slate-900">Switch firm</h3>
        <p className="mt-1 text-sm text-slate-500">Choose another firm workspace you belong to.</p>
        <div className="mt-4 space-y-2">
          {memberships.map((item) => (
            <button
              key={item.id}
              onClick={() => void selectFirm(item)}
              className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-sm ${
                item.id === firm.id ? 'border-blue-200 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="font-medium text-slate-800">{item.name}</span>
              {item.id === firm.id && <CheckCircle2 size={18} className="text-blue-600" />}
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const pageContent = () => {
    switch (view) {
      case 'Dashboard': return renderDashboard();
      case 'Clients': return renderClients();
      case 'Compliance Tasks': return renderTasks();
      case 'Calendar': return renderCalendar();
      case 'Review Queue': return renderReviewQueue();
      case 'Reports': return renderReports();
      case 'Settings': return renderSettings();
      default: return renderDashboard();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {mobileNavOpen && (
        <button
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-950 text-white transition-transform lg:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <div className="rounded-xl bg-blue-500 p-2.5"><Building2 size={22} /></div>
          <div>
            <p className="font-semibold">CA Practice</p>
            <p className="text-xs text-slate-400">Practice workspace</p>
          </div>
        </div>

        <div className="border-b border-white/10 px-4 py-4">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
          <div className="flex items-center gap-2 rounded-xl bg-white/5 p-3">
            <div className="rounded-lg bg-white/10 p-2"><Building2 size={16} /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{firm.name}</p>
              <p className="truncate text-xs text-slate-400">{firm.city || 'Firm workspace'}</p>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Practice management</p>
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => {
                setView(label);
                setSearchText('');
                setMobileNavOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                view === label ? 'bg-blue-600 font-medium text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === 'Review Queue' && reviewTasks.length > 0 && (
                <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-slate-950">{reviewTasks.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/20 text-sm font-semibold text-blue-200">
              {(session.user.email?.[0] ?? 'U').toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.user.email}</p>
              <p className="text-xs text-slate-400">Signed in</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-sm font-semibold text-slate-900">{view}</h1>
              <p className="hidden text-xs text-slate-500 sm:block">{firm.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden text-sm text-slate-500 md:inline">
              {today.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => setNotice('You are all caught up. Notifications will appear here when available.')} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
              <Bell size={19} />
            </button>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                {(session.user.email?.[0] ?? 'U').toUpperCase()}
              </div>
              <span className="max-w-40 truncate text-sm text-slate-700">{session.user.email}</span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6 lg:p-8">
          {(error || notice) && (
            <div className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm ${
              error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}>
              <div className="flex items-start gap-2">
                {error ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
                <p>{error || notice}</p>
              </div>
              <button onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss message"><X size={16} /></button>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              Syncing workspace…
            </div>
          )}

          {pageContent()}

          <footer className="flex flex-col gap-2 border-t border-slate-200 pt-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>CA Practice Management System · MVP</span>
            <span>Workspace: {firm.name}</span>
          </footer>
        </main>
      </div>

      {showClientModal && (
        <Modal title="Add a client" onClose={() => setShowClientModal(false)}>
          <form onSubmit={handleCreateClient} className="space-y-4">
            <Field label="Client name">
              <input className={inputClass} value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Entity type">
                <select className={inputClass} value={clientForm.entity_type} onChange={(event) => setClientForm({ ...clientForm, entity_type: event.target.value })}>
                  {['Individual', 'Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited', 'Trust', 'Other'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className={inputClass} value={clientForm.status} onChange={(event) => setClientForm({ ...clientForm, status: event.target.value })}>
                  {['Active', 'Inactive', 'Prospect'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email">
                <input className={inputClass} type="email" value={clientForm.email} onChange={(event) => setClientForm({ ...clientForm, email: event.target.value })} />
              </Field>
              <Field label="Phone">
                <input className={inputClass} value={clientForm.phone} onChange={(event) => setClientForm({ ...clientForm, phone: event.target.value })} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="PAN">
                <input className={inputClass} value={clientForm.pan} onChange={(event) => setClientForm({ ...clientForm, pan: event.target.value })} maxLength={10} />
              </Field>
              <Field label="GSTIN">
                <input className={inputClass} value={clientForm.gstin} onChange={(event) => setClientForm({ ...clientForm, gstin: event.target.value })} maxLength={15} />
              </Field>
            </div>
            <Field label="Services (comma-separated)">
              <input className={inputClass} value={clientForm.services} onChange={(event) => setClientForm({ ...clientForm, services: event.target.value })} placeholder="Income Tax, GST, Audit" />
            </Field>
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setShowClientModal(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
              <button type="submit" disabled={loading} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{loading ? 'Saving…' : 'Save client'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showTaskModal && (
        <Modal title="Create compliance task" onClose={() => setShowTaskModal(false)}>
          <form onSubmit={handleCreateTask} className="space-y-4">
            <Field label="Task title">
              <input className={inputClass} value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} required />
            </Field>
            <Field label="Client">
              <select className={inputClass} value={taskForm.client_id} onChange={(event) => setTaskForm({ ...taskForm, client_id: event.target.value })} required>
                <option value="">Select a client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <select className={inputClass} value={taskForm.category} onChange={(event) => setTaskForm({ ...taskForm, category: event.target.value })}>
                  {['Income Tax', 'GST', 'TDS', 'Audit', 'ROC', 'Accounting', 'Other'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Period">
                <input className={inputClass} value={taskForm.period} onChange={(event) => setTaskForm({ ...taskForm, period: event.target.value })} placeholder="e.g. FY 2026-27" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="External due date">
                <input className={inputClass} type="date" value={taskForm.due_date} onChange={(event) => setTaskForm({ ...taskForm, due_date: event.target.value })} required />
              </Field>
              <Field label="Internal due date">
                <input className={inputClass} type="date" value={taskForm.internal_due_date} onChange={(event) => setTaskForm({ ...taskForm, internal_due_date: event.target.value })} required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Priority">
                <select className={inputClass} value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}>
                  {['Low', 'Medium', 'High', 'Urgent'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className={inputClass} value={taskForm.status} onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value })}>
                  {['Pending', 'In Progress', 'Under Review', 'Completed', 'Filed'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assigned to (email or name)">
                <input className={inputClass} value={taskForm.assigned_to} onChange={(event) => setTaskForm({ ...taskForm, assigned_to: event.target.value })} />
              </Field>
              <Field label="Reviewer (email or name)">
                <input className={inputClass} value={taskForm.reviewer} onChange={(event) => setTaskForm({ ...taskForm, reviewer: event.target.value })} />
              </Field>
            </div>
            {clients.length === 0 && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Add a client before creating a compliance task.</p>
            )}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setShowTaskModal(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
              <button type="submit" disabled={loading || clients.length === 0} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{loading ? 'Saving…' : 'Create task'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  alert = false,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Users;
  alert?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">{title}</p>
          <p className={`mt-2 text-3xl font-semibold tracking-tight ${alert ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
        </div>
        <div className={`rounded-xl p-3 ${alert ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-700'}`}>
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-blue-200 hover:bg-blue-50/50">
      <span className="rounded-lg bg-slate-100 p-2 text-slate-600"><Icon size={17} /></span>
      <span className="flex-1 text-sm font-medium text-slate-700">{label}</span>
      <Plus size={16} className="text-slate-400" />
    </button>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative max-w-xl">
      <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className={`${inputClass} pl-9`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-2xl bg-slate-100 p-3 text-slate-500"><FileText size={24} /></div>
      <h3 className="font-medium text-slate-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function TaskTable({
  tasks,
  onStatusChange,
}: {
  tasks: Task[];
  onStatusChange: (task: Task, status: string) => void;
}) {
  if (tasks.length === 0) {
    return <EmptyState title="No tasks yet" detail="Create a compliance task to start tracking work." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3 font-medium">Task</th>
            <th className="px-5 py-3 font-medium">Client</th>
            <th className="px-5 py-3 font-medium">Due date</th>
            <th className="px-5 py-3 font-medium">Priority</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tasks.map((task) => (
            <tr key={task.id} className="hover:bg-slate-50/70">
              <td className="px-5 py-4">
                <p className="font-medium text-slate-900">{task.title}</p>
                <p className="mt-1 text-xs text-slate-500">{task.category}{task.period ? ` · ${task.period}` : ''}</p>
              </td>
              <td className="px-5 py-4 text-slate-600">{task.client_name || '—'}</td>
              <td className="px-5 py-4 text-slate-600">{task.due_date ? shortDate(task.due_date) : '—'}</td>
              <td className="px-5 py-4">
                <span className={`text-xs font-medium ${['High', 'Urgent'].includes(task.priority) ? 'text-rose-600' : 'text-slate-600'}`}>
                  {task.priority}
                </span>
              </td>
              <td className="px-5 py-4"><StatusPill value={task.status} /></td>
              <td className="px-5 py-4">
                <select
                  aria-label={`Update status for ${task.title}`}
                  value={task.status}
                  onChange={(event) => void onStatusChange(task, event.target.value)}
                  className="max-w-36 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                >
                  {['Pending', 'In Progress', 'Under Review', 'Completed', 'Filed'].map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;