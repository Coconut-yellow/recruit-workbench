import { all, get } from "./db.js";

export function isAdmin(user) {
  return user?.role === "admin";
}

export function membership(userId, jobId) {
  if (!userId || !jobId) return null;
  return get(
    "SELECT * FROM job_members WHERE user_id = ? AND job_id = ?",
    [userId, jobId]
  );
}

export function visibleJobIds(user) {
  if (!user) return [];
  if (isAdmin(user)) return null;
  return all("SELECT job_id FROM job_members WHERE user_id = ?", [user.id]).map(
    (r) => r.job_id
  );
}

export function canSeeJob(user, jobId) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return Boolean(membership(user.id, jobId));
}

export function canManageJob(user, jobId) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const m = membership(user.id, jobId);
  return Boolean(m && m.role === "owner");
}

export function canAssign(user, jobId) {
  return canManageJob(user, jobId);
}

export function canEditJobContent(user, jobId) {
  return canManageJob(user, jobId);
}

export function canMoveCandidate(user, jobId) {
  if (!user) return false;
  if (user.role === "readonly") return false;
  if (isAdmin(user)) return true;
  return Boolean(membership(user.id, jobId));
}

export function canCreateJob(user) {
  if (!user) return false;
  return user.role === "admin" || user.role === "hiring_manager";
}

export function canMutateCandidate(user, jobId) {
  return canMoveCandidate(user, jobId);
}

export function canManageUsers(user) {
  return isAdmin(user);
}

export function assert(condition, message, status = 403) {
  if (!condition) {
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}
