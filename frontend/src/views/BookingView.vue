<script setup lang="ts">
import { onMounted, ref } from "vue";
import { bookingState, refreshBookingData } from "../state/booking";
import RoomPanel from "../components/booking/RoomPanel.vue";
import MemberPanel from "../components/booking/MemberPanel.vue";
import ReservePanel from "../components/booking/ReservePanel.vue";
import BookingList from "../components/booking/BookingList.vue";

const activeTab = ref("reserve");

onMounted(() => {
  void refreshBookingData();
});
</script>

<template>
  <section class="work-panel booking-panel" v-loading="bookingState.loading">
    <el-alert
      v-if="bookingState.loadError"
      type="error"
      :title="`无法连接后端服务：${bookingState.loadError}`"
      description="请确认后端已启动（默认端口 29512），刷新后重试。"
      :closable="false"
      class="load-error"
    />
    <template v-else>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="时段预约" name="reserve">
          <ReservePanel />
        </el-tab-pane>
        <el-tab-pane label="预约记录" name="bookings">
          <BookingList />
        </el-tab-pane>
        <el-tab-pane label="包厢管理" name="rooms">
          <RoomPanel />
        </el-tab-pane>
        <el-tab-pane label="会员储值" name="members">
          <MemberPanel />
        </el-tab-pane>
      </el-tabs>
    </template>
  </section>
</template>

<style scoped>
.booking-panel {
  margin-top: 26px;
}

.load-error {
  margin-bottom: 12px;
}
</style>
