import type { FoData } from './finops/store';

export type Role = 'partner' | 'accountant' | 'client';

export type StatusKey =
  | 'scheduled' | 'documents_requested' | 'in_progress' | 'prepared' | 'under_review'
  | 'changes_requested' | 'approved' | 'ready_to_file' | 'filed' | 'evidence_pending' | 'completed';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type EvidenceState = 'not_due' | 'awaiting_upload' | 'uploaded' | 'under_verification' | 'verified';
export type ClientStatus = 'active' | 'onboarding' | 'inactive';
export type DocStatus = 'requested' | 'missing' | 'awaiting_review' | 'rejected' | 'received';
export type Channel = 'email' | 'whatsapp' | 'in_app';
export type MsgStatus = 'logged' | 'scheduled' | 'queued' | 'draft';
export type NoticeStatus = 'new' | 'drafting' | 'response_filed' | 'closed';
export type InvoiceStatus = 'draft' | 'unpaid' | 'paid';
export type RuleKind = 'generate' | 'docs' | 'remind' | 'escalate' | 'review' | 'evidence';
export type Risk = 'High' | 'Medium' | 'Low';

export interface Firm { id: string; name: string; city: string }
export interface Membership { firm_id: string; role: string; firm: Firm }

export interface TeamMember {
  id: string; firm_id: string; user_id: string | null; name: string; role: string;
  email: string; capacity: number; active: boolean; invited_at: string | null;
}

export interface Client {
  id: string; firm_id: string; name: string; entity_type: string; email: string; phone: string;
  pan: string; gstin: string; tan: string; state_code: string; contact_person: string;
  partner_id: string | null; package: string; status: ClientStatus; services: string[];
  client_since: string; created_at: string;
}

export interface ChecklistItem { t: string; done: boolean }

export interface Filing {
  method: 'Assisted' | 'Integrated'; ack: string; submitted_on: string; evidence: EvidenceState;
  evidence_path: string; evidence_name: string; ev_rejected: string;
}

export interface Task {
  id: string; task_no: number; firm_id: string; client_id: string; title: string; form: string;
  category: string; period: string; fy: string; template_key: string | null;
  due_date: string | null; internal_due_date: string | null; status: StatusKey; priority: Priority;
  preparer_id: string | null; reviewer_id: string | null; blocked: string;
  checklist: ChecklistItem[]; required_docs: string[]; filing: Filing; created_at: string;
}

export interface Doc {
  id: string; firm_id: string; client_id: string; task_id: string | null; name: string; fy: string;
  status: DocStatus; requested_on: string | null; uploaded_on: string | null; comment: string;
  file_path: string; file_name: string; reviewed_by: string; created_at: string;
}

export interface Message {
  id: string; firm_id: string; client_id: string | null; task_id: string | null; channel: Channel;
  recipient: string; to_addr: string; purpose: string; template: string; scheduled_at: string | null;
  status: MsgStatus; read: boolean; body: string; recipient_member_id: string | null; created_at: string;
}

export interface Notice {
  id: string; firm_id: string; client_id: string; authority: string; ref: string; subject: string;
  demand: number; received_on: string | null; response_due: string | null; status: NoticeStatus;
  owner_id: string | null; doc_ref: string; created_at: string;
}

export interface Invoice {
  id: string; firm_id: string; client_id: string; invoice_no: string; period: string; amount: number;
  issued_on: string | null; due_on: string | null; status: InvoiceStatus; paid_note: string; created_at: string;
}

export interface AutoRule {
  id: string; firm_id: string; rule_key: string; name: string; trig: string; action: string;
  scope: string; enabled: boolean; days: number; kind: RuleKind; last_run: string;
}

export interface RuleHistory { v: string; at: string; by: string; note: string }
export interface RuleProposal { field: 'due_rule' | 'applicability' | 'frequency'; from: string; to: string; reason: string; ref: string; eff: string; by: string; at: string }
export interface CRule {
  id: string; firm_id: string; rule_key: string; authority: string; form: string; applicability: string;
  frequency: string; due_rule: string; effective: string | null; source: string; verified_on: string | null;
  verified_by: string; version: string; status: 'approved' | 'proposed' | 'draft';
  history: RuleHistory[]; proposal: RuleProposal | null;
}

export interface MsgTemplate { name: string; channel: 'Email' | 'WhatsApp'; body: string }
export interface Escalation { remind: number; escalate: number; partner: number; critical: boolean }
export interface Settings {
  firm_id: string; short_code: string; templates: Record<string, MsgTemplate>;
  notif: Record<string, boolean>; escalation: Escalation;
}

export interface Activity { id: string; firm_id: string; task_id: string; actor_name: string; text: string; created_at: string }
export interface Comment { id: string; firm_id: string; task_id: string; author_name: string; body: string; created_at: string }
export interface ClientUser {
  id: string; firm_id: string; client_id: string; email: string; user_id: string | null;
  invited_by: string; accepted_at: string | null; created_at: string;
}

export interface FirmData {
  team: TeamMember[]; clients: Client[]; tasks: Task[]; docs: Doc[]; msgs: Message[];
  notices: Notice[]; invoices: Invoice[]; rules: AutoRule[]; crules: CRule[];
  settings: Settings | null; activity: Activity[]; comments: Comment[]; clientUsers: ClientUser[];
  /** Financial Operations add-on (empty when it is switched off or not installed). */
  fo: FoData;
}
