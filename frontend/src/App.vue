<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchOverview } from "./api/client";
import { APP_CODE, APP_NAME } from "./constants/app";
import { REQUEST_MESSAGES } from "./constants/messages";
import { createFallbackOverview } from "./state/dashboard";
import type { OverviewResponse } from "./types";
import FeatureStrip from "./components/FeatureStrip.vue";
import MetricGrid from "./components/MetricGrid.vue";
import OperationsTable from "./components/OperationsTable.vue";
import BookingView from "./views/BookingView.vue";

const overview = ref<OverviewResponse>(createFallbackOverview());
const notice = ref(REQUEST_MESSAGES.overviewFallback);
const currentView = ref<"overview" | "booking">("booking");

function goHealth() {
  window.location.href = REQUEST_MESSAGES.healthPath;
}

onMounted(async () => {
  try {
    overview.value = await fetchOverview();
    notice.value = "后端服务已联通，当前展示实时接口数据。";
  } catch {
    notice.value = REQUEST_MESSAGES.overviewFallback;
  }
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <span class="brand-code">{{ APP_CODE }}</span>
        <h1 class="brand-title">{{ APP_NAME }}</h1>
      </div>
      <div class="topbar-actions">
        <el-radio-group v-model="currentView">
          <el-radio-button value="overview">运营总览</el-radio-button>
          <el-radio-button value="booking">包厢预约</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="goHealth">API Health</el-button>
      </div>
    </header>
    <section v-if="currentView === 'overview'" class="workspace">
      <div class="lead-grid">
        <article class="hero-panel">
          <span class="pill">{{ notice }}</span>
          <h2>{{ overview.appName }}</h2>
          <p>{{ overview.description }}</p>
        </article>
        <MetricGrid :items="overview.kpis" />
      </div>
      <FeatureStrip :items="overview.features" />
      <section class="work-panel">
        <h2>运营任务流</h2>
        <OperationsTable :records="overview.records" />
      </section>
    </section>
    <section v-else class="workspace">
      <BookingView />
    </section>
  </main>
</template>

<style scoped>
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
</style>
