"use client";

import { useState, useTransition } from "react";
import type { Profile } from "@/lib/types";
import { setRole } from "./actions";

export default function UsersAdmin({ users, selfId }: { users: Profile[]; selfId: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-4 py-2">Email</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Joined</th><th className="px-4 py-2">Role</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <td className="px-4 py-2">{u.email}</td>
              <td className="px-4 py-2">{u.display_name ?? ""}</td>
              <td className="px-4 py-2 text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
              <td className="px-4 py-2">
                <select className="input py-1" value={u.role} disabled={pending || u.id === selfId}
                  onChange={(e) => { setError(""); start(async () => { const r = await setRole(u.id, e.target.value as "member" | "admin"); if ("error" in r) setError(r.error); }); }}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td className="px-4 py-6 text-center text-muted" colSpan={4}>No one has signed in yet.</td></tr>}
        </tbody>
      </table>
      {error && <p className="px-4 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
