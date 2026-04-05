import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

// --- Deletion tombstones helpers ---
const TOMBSTONE_KEY = 'deletedMemoIds'

export function addDeletedMemoTombstone(id) {
  try {
    if (id == null) return
    // FIX: tombstone id 统一为字符串，避免与 D1 返回的字符串 id 比较时 Set.has() 失效
    const sid = String(id)
    const raw = localStorage.getItem(TOMBSTONE_KEY)
    const list = raw ? JSON.parse(raw) : []
    const now = new Date().toISOString()
    const exists = Array.isArray(list) ? list.find((t) => t && String(t.id) === sid) : null
    if (exists) {
      exists.deletedAt = now
    } else {
      list.push({ id: sid, deletedAt: now })
    }
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(list))
    try { window.dispatchEvent(new CustomEvent('app:dataChanged', { detail: { part: 'memo.delete', id: sid } })) } catch {}
  } catch {}
}

export function getDeletedMemoTombstones() {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function removeDeletedMemoTombstones(ids) {
  try {
    if (!ids || !ids.length) return
    // FIX: 统一字符串化后再做 Set 比较
    const set = new Set(ids.map(String))
    const list = getDeletedMemoTombstones()
    const next = list.filter((t) => !set.has(String(t.id)))
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(next))
  } catch {}
}

export function clearAllDeletedMemoTombstones() {
  try { localStorage.removeItem(TOMBSTONE_KEY) } catch {}
}
