<template>
  <div
    class="apps-page"
    :class="{ 'apps-page--background-loading': backgroundLoading }"
    :aria-busy="initialPageLoading || backgroundLoading ? 'true' : 'false'"
  >
    <template v-if="initialPageLoading">
      <AppsPageSkeleton />
    </template>

    <template v-else>
      <AppFilters
        v-model:search-query="searchQuery"
        v-model:filter-type="filterType"
        v-model:show-system-apps="showSystemApps"
        :total-count="visibleApps.length"
        :configured-count="configuredCount"
        :loading="false"
      />

      <AppList :apps="filteredApps" :empty-text="emptyText" :loading="false" @select="openConfig" />
    </template>

    <AppConfigDialog
      v-if="configDialogVisible"
      v-model="configDialogVisible"
      :app="currentApp"
      @saved="handleConfigSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import AppFilters from '../components/apps/AppFilters.vue'
import AppList from '../components/apps/AppList.vue'
import AppsPageSkeleton from '../components/apps/AppsPageSkeleton.vue'
import { useAppsStore } from '../stores/apps'
import { useConfigStore } from '../stores/config'
import { useSettingsStore } from '../stores/settings'
import { useI18n } from '../utils/i18n'
import { normalizePackageName } from '../utils/package'
import type { InstalledApp } from '../types'

type FilterType = 'all' | 'configured'

const AppConfigDialog = defineAsyncComponent(() => import('../components/apps/AppConfigDialog.vue'))

const configStore = useConfigStore()
const appsStore = useAppsStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

const searchQuery = ref('')
const filterType = ref<FilterType>('all')
const configDialogVisible = ref(false)
const currentApp = ref<InstalledApp | null>(null)
const showSystemApps = computed({
  get: () => settingsStore.showSystemApps,
  set: (value: boolean) => settingsStore.setShowSystemApps(value),
})

// 首次进入页面时先保留骨架，等第一批可展示列表准备好再收起
const isInitializing = ref(!appsStore.hasLoadedUserApps && !appsStore.loading)
const installedApps = computed(() => appsStore.installedApps)

const configuredPackageNames = computed(() => {
  const packages = new Set<string>()

  for (const appConfig of configStore.getApps()) {
    packages.add(appConfig.package)
  }

  for (const template of Object.values(configStore.getTemplates())) {
    if (!template.packages) continue
    for (const pkg of template.packages) {
      packages.add(pkg)
    }
  }

  return Array.from(packages)
})

const configuredApps = computed<InstalledApp[]>(() => {
  const map = new Map<string, InstalledApp>()

  for (const appConfig of configStore.getApps()) {
    if (map.has(appConfig.package)) continue

    map.set(appConfig.package, {
      packageName: appConfig.package,
      appName: appConfig.package,
    })
  }

  const templates = configStore.getTemplates()
  for (const template of Object.values(templates)) {
    if (!template.packages) continue
    for (const pkg of template.packages) {
      if (map.has(pkg)) continue

      map.set(pkg, {
        packageName: pkg,
        appName: pkg,
      })
    }
  }

  return Array.from(map.values())
})

const allApps = computed<InstalledApp[]>(() => {
  const result: InstalledApp[] = []
  const packageIndex = new Map<string, number>()
  const normalizedIndex = new Map<string, number>()

  // 保留已安装应用的原始顺序
  for (const app of installedApps.value) {
    const normalized = normalizePackageName(app.packageName)
    if (packageIndex.has(app.packageName)) continue

    const entry = {
      ...app,
      installed: app.installed ?? true,
    }

    const idx = result.length
    result.push(entry)
    packageIndex.set(app.packageName, idx)
    if (!normalizedIndex.has(normalized)) {
      normalizedIndex.set(normalized, idx)
    }
  }

  // 合并配置项：如果包名不同（即使归一化后相同），也应显示为不同应用
  for (const app of configuredApps.value) {
    if (packageIndex.has(app.packageName)) continue

    // 查找具有相同归一化包名的已存在应用，复用其展示信息
    const normalized = normalizePackageName(app.packageName)
    const existingIdx = normalizedIndex.get(normalized)

    const entry = {
      // 如果有相同归一化包名的应用，复用其展示信息，否则使用默认信息
      ...(existingIdx !== undefined ? result[existingIdx] : {}),
      packageName: app.packageName,
      appName: existingIdx !== undefined ? result[existingIdx].appName : app.packageName,
      installed: existingIdx !== undefined ? result[existingIdx].installed : app.installed,
      isSystem: existingIdx !== undefined ? result[existingIdx].isSystem : app.isSystem,
    }

    const idx = result.length
    result.push(entry)
    packageIndex.set(app.packageName, idx)
  }

  return result
})

const visibleApps = computed(() =>
  allApps.value.filter(
    (app) =>
      showSystemApps.value ||
      app.isSystem !== true ||
      configStore.isPackageConfigured(app.packageName)
  )
)

const hasRenderableApps = computed(() => visibleApps.value.length > 0)
const initialPageLoading = computed(
  () => !hasRenderableApps.value && (isInitializing.value || appsStore.loading)
)
const backgroundLoading = computed(() => appsStore.loading && !initialPageLoading.value)

const configuredCount = computed(
  () => visibleApps.value.filter((app) => configStore.isPackageConfigured(app.packageName)).length
)

const filteredApps = computed(() => {
  let apps = visibleApps.value

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    apps = apps.filter(
      (app) => app.packageName.toLowerCase().includes(q) || app.appName.toLowerCase().includes(q)
    )
  }

  if (filterType.value === 'configured') {
    apps = apps.filter((app) => configStore.isPackageConfigured(app.packageName))
  }

  return apps.slice().sort((a, b) => {
    const aInstalled = a.installed !== false
    const bInstalled = b.installed !== false

    if (aInstalled === bInstalled) return 0
    return aInstalled ? -1 : 1
  })
})

const emptyText = computed(() => {
  if (searchQuery.value) return t('apps.empty.search')
  if (filterType.value === 'configured') return t('apps.empty.configured')
  return t('apps.empty.all')
})

function openConfig(app: InstalledApp) {
  currentApp.value = app
  configDialogVisible.value = true
}

function handleConfigSaved() {
  // 预留钩子，未来可在保存后刷新列表或提示
}

async function loadApps(includeSystem: boolean) {
  await appsStore.loadInstalledApps({
    includeSystem,
    resolvePackages: configuredPackageNames.value,
  })
  isInitializing.value = false
}

onMounted(async () => {
  if (!appsStore.hasLoadedUserApps && !appsStore.loading) {
    requestAnimationFrame(() => {
      void loadApps(showSystemApps.value)
    })
  } else {
    isInitializing.value = false
    await appsStore.resolvePackagesInfo(configuredPackageNames.value)
    if (showSystemApps.value) {
      await appsStore.loadInstalledApps({ includeSystem: true })
    }
  }
})

watch(showSystemApps, (enabled, previous) => {
  if (enabled && enabled !== previous) {
    void appsStore.loadInstalledApps({
      includeSystem: true,
      resolvePackages: configuredPackageNames.value,
    })
  }
})

watch(
  configuredPackageNames,
  (packages) => {
    if (!packages.length) return
    void appsStore.resolvePackagesInfo(packages)
  },
  { deep: false }
)
</script>

<style scoped>
.apps-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
