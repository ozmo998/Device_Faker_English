import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { InstalledApp } from '../types'
import { getAppsInfo, getInstalledApps } from '../utils/ksu'
import { normalizePackageName } from '../utils/package'

interface LoadInstalledAppsOptions {
  includeSystem?: boolean
  resolvePackages?: string[]
}

export const useAppsStore = defineStore('apps', () => {
  const installedApps = ref<InstalledApp[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')
  const hasLoadedUserApps = ref(false)
  const hasLoadedSystemApps = ref(false)
  const resolvedPackages = new Set<string>()

  function mergeInstalledApp(
    existing: InstalledApp | undefined,
    incoming: InstalledApp
  ): InstalledApp {
    return {
      packageName: incoming.packageName,
      appName: incoming.appName || existing?.appName || incoming.packageName,
      icon: incoming.icon || existing?.icon || '',
      versionName: incoming.versionName || existing?.versionName || '',
      versionCode: incoming.versionCode ?? existing?.versionCode ?? 0,
      installed: incoming.installed ?? existing?.installed,
      isSystem: incoming.isSystem ?? existing?.isSystem,
    }
  }

  function upsertInstalledApps(apps: InstalledApp[]) {
    if (apps.length === 0) return

    const appMap = new Map(installedApps.value.map((app) => [app.packageName, app]))
    for (const app of apps) {
      appMap.set(app.packageName, mergeInstalledApp(appMap.get(app.packageName), app))
      resolvedPackages.add(normalizePackageName(app.packageName))
    }

    installedApps.value = Array.from(appMap.values())
  }

  async function resolvePackagesInfo(packageNames: string[]) {
    const unresolved = Array.from(
      new Set(
        packageNames
          .map((pkg) => pkg.trim())
          .filter(Boolean)
          .filter((pkg) => !resolvedPackages.has(normalizePackageName(pkg)))
      )
    )

    if (unresolved.length === 0) {
      return
    }

    const apps = await getAppsInfo(unresolved)
    for (const packageName of unresolved) {
      resolvedPackages.add(normalizePackageName(packageName))
    }
    upsertInstalledApps(apps.filter((app) => app.installed === true))
  }

  // 加载已安装应用列表
  async function loadInstalledApps(options: LoadInstalledAppsOptions = {}) {
    const { includeSystem = false, resolvePackages = [] } = options

    if (
      hasLoadedUserApps.value &&
      (!includeSystem || hasLoadedSystemApps.value) &&
      resolvePackages.every((pkg) => resolvedPackages.has(normalizePackageName(pkg)))
    ) {
      return
    }

    loading.value = true
    error.value = null
    try {
      if (!hasLoadedUserApps.value) {
        upsertInstalledApps(
          (await getInstalledApps({ packageType: 'user' })).map((app) => ({
            ...app,
            installed: app.installed ?? true,
            isSystem: app.isSystem ?? false,
          }))
        )
        hasLoadedUserApps.value = true
      }

      if (includeSystem && !hasLoadedSystemApps.value) {
        upsertInstalledApps(
          (await getInstalledApps({ packageType: 'system' })).map((app) => ({
            ...app,
            installed: app.installed ?? true,
            isSystem: app.isSystem ?? true,
          }))
        )
        hasLoadedSystemApps.value = true
      }

      await resolvePackagesInfo(resolvePackages)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  // 搜索应用
  function searchApps(query: string) {
    searchQuery.value = query
  }

  // 获取过滤后的应用列表
  function getFilteredApps(): InstalledApp[] {
    if (!searchQuery.value) {
      return installedApps.value
    }
    const q = searchQuery.value.toLowerCase()
    return installedApps.value.filter(
      (app: InstalledApp) =>
        app.packageName.toLowerCase().includes(q) || app.appName.toLowerCase().includes(q)
    )
  }

  return {
    installedApps,
    loading,
    error,
    searchQuery,
    hasLoadedUserApps,
    hasLoadedSystemApps,
    loadInstalledApps,
    resolvePackagesInfo,
    searchApps,
    getFilteredApps,
  }
})
