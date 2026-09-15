/**
 * Domain types for the namespace feature, mirroring `Namespace` in
 * `src-tauri/src/models.rs` field-for-field (serde camelCase). Write payloads
 * follow the plan §3 patch semantics: a missing field leaves the stored value
 * unchanged, an explicit `null` clears it.
 */

/** Namespace lifecycle state (`namespaces.status`); archived namespaces are restorable. */
export type NamespaceStatus = "active" | "archived";

export interface Namespace {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  status: NamespaceStatus;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NewNamespace {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}

export interface UpdateNamespace {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}
